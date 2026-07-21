const express = require('express');
const cors = require('cors');
const path = require('path');
const mlmEngine = require('./mlm-engine');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Get setting value
async function getSetting(key, fallback = '') {
    const row = await db.get("SELECT value FROM system_settings WHERE key = ?", [key]);
    return row ? row.value : fallback;
}

// ==================== HEALTH ENDPOINT ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Tier Leverage Server',
        timestamp: Date.now(),
        version: '1.1.0'
    });
});

// ==================== SYSTEM SETTINGS ====================
app.get('/api/system/settings', async (req, res) => {
    try {
        const rows = await db.all("SELECT * FROM system_settings");
        const settings = {};
        for (const r of rows) settings[r.key] = r.value;
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper: Verify if wallet address has Admin permissions
async function isAdminAddress(address) {
    if (!address) return false;
    const norm = address.trim().toLowerCase();
    const masterAddress = (await getSetting('platform_master_address', '0x3801490C9f806c917b8CbA710Db9135FA3B116ae')).toLowerCase();
    if (norm === masterAddress) return true;

    // Genesis root node check
    const genesisNode = await db.get('SELECT walletAddress FROM binary_tree ORDER BY joinedAt ASC LIMIT 1');
    if (genesisNode && genesisNode.walletAddress.toLowerCase() === norm) return true;

    // DB user isAdmin flag check
    const u = await db.get('SELECT isAdmin FROM users WHERE LOWER(walletAddress) = ?', [norm]);
    return u && u.isAdmin === 1;
}

// Middleware: Enforce admin authentication
async function requireAdmin(req, res, next) {
    const callerAddress = req.headers['x-wallet-address'] || req.body?.walletAddress || req.query?.address;
    if (!callerAddress || !(await isAdminAddress(callerAddress))) {
        return res.status(403).json({ success: false, error: 'Forbidden: Admin authorization required' });
    }
    next();
}

// ==================== WEB3 WALLET AUTH & REGISTRATION ====================

// 1. Check if wallet is registered
app.get('/api/auth/wallet/:address', async (req, res) => {
    try {
        const address = req.params.address.trim().toLowerCase();
        const user = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [address]);
        const isAdmin = await isAdminAddress(address);
        if (user) {
            res.json({ success: true, registered: true, user: { ...user, isAdmin } });
        } else {
            res.json({ success: true, registered: false, isAdmin });
        }
    } catch (error) {
        console.error('❌ Check Wallet Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Register new Web3 wallet profile
app.post('/api/auth/register', async (req, res) => {
    try {
        const { walletAddress, username, sponsorUsername, position } = req.body;
        if (!walletAddress || !username) {
            return res.status(400).json({ success: false, error: 'walletAddress and username are required' });
        }

        const normWallet = walletAddress.trim().toLowerCase();
        const cleanedUsername = username.trim().replace(/[^a-zA-Z0-9_]/g, '');

        if (cleanedUsername.length < 3 || cleanedUsername.length > 20) {
            return res.status(400).json({ success: false, error: 'Username must be between 3 and 20 alphanumeric characters' });
        }

        // Check if username is already taken
        const existUsername = await db.get("SELECT * FROM users WHERE LOWER(username) = ?", [cleanedUsername.toLowerCase()]);
        if (existUsername) {
            return res.status(400).json({ success: false, error: 'Username already taken' });
        }

        // Check if wallet is already registered
        const existWallet = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [normWallet]);
        if (existWallet) {
            return res.status(400).json({ success: false, error: 'Wallet address already registered' });
        }

        // Resolve sponsor wallet address
        let sponsorWallet = null;
        let referrer = null;
        if (sponsorUsername && sponsorUsername.trim()) {
            const resolvedSponsor = await mlmEngine.resolveReferralCode(sponsorUsername);
            if (resolvedSponsor) {
                sponsorWallet = resolvedSponsor.toLowerCase();
                const sponsorUser = await db.get("SELECT username FROM users WHERE LOWER(walletAddress) = ?", [sponsorWallet]);
                if (sponsorUser) referrer = sponsorUser.username;
            } else {
                return res.status(400).json({ success: false, error: 'Referrer/Sponsor code not found on network' });
            }
        }

        const leg = (position === 'R') ? 'R' : 'L';

        // 1. Insert into users database
        await db.run(
            `INSERT INTO users (walletAddress, username, referrerUsername, legPreference, isActive, packageUsdt, withdrawableUsdt, joinedAt)
             VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
            [normWallet, cleanedUsername, referrer, leg, Date.now()]
        );

        // 2. Register node in binary tree matching hierarchy
        const result = await mlmEngine.registerNode(normWallet, sponsorWallet, leg);

        const newUser = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [normWallet]);
        res.json({ success: true, user: newUser, tree: result });
    } catch (error) {
        console.error('❌ Register API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PROFILE ENDPOINTS ====================

// 1. Update user profile username
app.post('/api/user/update-username', async (req, res) => {
    try {
        const { walletAddress, username } = req.body;
        if (!walletAddress || !username) return res.status(400).json({ success: false, error: 'walletAddress and username are required' });

        const normWallet = walletAddress.trim().toLowerCase();
        const cleanedUsername = username.trim().replace(/[^a-zA-Z0-9_]/g, '');

        if (cleanedUsername.length < 3 || cleanedUsername.length > 20) {
            return res.status(400).json({ success: false, error: 'Username must be between 3 and 20 alphanumeric characters' });
        }

        const existing = await db.get("SELECT * FROM users WHERE LOWER(username) = ?", [cleanedUsername.toLowerCase()]);
        if (existing && existing.walletAddress.toLowerCase() !== normWallet) {
            return res.status(400).json({ success: false, error: 'Username already taken' });
        }

        await db.run("UPDATE users SET username = ? WHERE LOWER(walletAddress) = ?", [cleanedUsername, normWallet]);
        res.json({ success: true, username: cleanedUsername });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Get profile and stats summary
app.get('/api/user/profile/:address', async (req, res) => {
    try {
        const address = req.params.address.trim().toLowerCase();
        const user = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [address]);
        if (!user) return res.status(404).json({ success: false, error: 'Member profile not found' });

        const isAdmin = await isAdminAddress(address);
        const stats = await mlmEngine.getStats(address);
        res.json({ success: true, user: { ...user, isAdmin }, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== TIER PACKAGES & PAYMENT AUDIT ====================

app.post('/api/packages/activate', async (req, res) => {
    try {
        const { walletAddress, packageUsdt, txHash } = req.body;
        if (!walletAddress || !packageUsdt || !txHash) {
            return res.status(400).json({ success: false, error: 'walletAddress, packageUsdt, and txHash are required' });
        }

        const normWallet = walletAddress.trim().toLowerCase();
        const user = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [normWallet]);
        if (!user) return res.status(404).json({ success: false, error: 'User profile not found' });

        const nchPrice = parseFloat(await getSetting('nch_usdt_price', '0.02'));
        const masterAddress = await getSetting('platform_master_address', '0x3801490C9f806c917b8CbA710Db9135FA3B116ae');
        const requiredNch = packageUsdt / nchPrice;

        // Perform Cheese Blockchain native transaction RPC check (no mock fallbacks)
        let txVerified = false;
        try {
            const rpcRes = await fetch("https://cheeseblockchain.com/api/rpc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "eth_getTransactionByHash",
                    params: [txHash],
                    id: 1
                })
            });
            const rpcData = await rpcRes.json();
            if (rpcData.result) {
                const tx = rpcData.result;
                const txTo = (tx.to || "").toLowerCase();
                const txValueNch = parseInt(tx.value, 16) / 1e18; // 18 decimals

                if (txTo === masterAddress.toLowerCase() && txValueNch >= requiredNch * 0.99) {
                    txVerified = true;
                }
            }
        } catch (rpcErr) {
            console.warn("RPC verification failed:", rpcErr.message);
        }

        if (!txVerified) {
            return res.status(400).json({ success: false, error: `Transaction verification failed. Must transfer ${requiredNch} NCH to ${masterAddress}.` });
        }

        // Set user as active (updating tier safely without downgrading higher active tier)
        await db.run("UPDATE users SET isActive = 1, packageUsdt = MAX(packageUsdt, ?), packageActivatedAt = ? WHERE LOWER(walletAddress) = ?", [packageUsdt, Date.now(), normWallet]);

        // 1. Direct Referral Bonus (10%)
        let sponsorWallet = null;
        if (user.referrerUsername) {
            const sponsor = await db.get("SELECT walletAddress FROM users WHERE LOWER(username) = ?", [user.referrerUsername.toLowerCase()]);
            if (sponsor) sponsorWallet = sponsor.walletAddress.toLowerCase();
        }
        if (!sponsorWallet) {
            const treeNode = await db.get("SELECT sponsorAddress FROM binary_tree WHERE LOWER(walletAddress) = ?", [normWallet]);
            if (treeNode && treeNode.sponsorAddress) sponsorWallet = treeNode.sponsorAddress.toLowerCase();
        }

        if (sponsorWallet) {
            const directBonus = packageUsdt * 0.10;
            await db.run("UPDATE users SET withdrawableUsdt = withdrawableUsdt + ? WHERE LOWER(walletAddress) = ?", [directBonus, sponsorWallet]);

            const commId = `comm-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
            await db.run(
                `INSERT INTO mlm_commissions (id, walletAddress, type, amount, weakLegVolume, timestamp, status)
                 VALUES (?, ?, ?, ?, 0, ?, 'PAID')`,
                [commId, sponsorWallet, 'DIRECT_REFERRAL', directBonus, Date.now()]
            );
        }

        // 2. Add volume to upline tree (bubbles up + triggers 15% binary activation & pairing bonuses)
        await mlmEngine.addVolume(normWallet, packageUsdt);

        const updatedUser = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [normWallet]);
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error('❌ Package Activation Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== WITHDRAWAL ENDPOINTS ====================

// 1. Request withdrawal
app.post('/api/withdraw/request', async (req, res) => {
    try {
        const { walletAddress, amountUsdt } = req.body;
        if (!walletAddress || !amountUsdt) return res.status(400).json({ success: false, error: 'walletAddress and amountUsdt are required' });

        const normWallet = walletAddress.trim().toLowerCase();
        const user = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [normWallet]);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const amt = parseFloat(amountUsdt);
        if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, error: 'Invalid withdrawal amount' });

        if (user.isActive !== 1) {
            return res.status(400).json({ success: false, error: 'Commission withdraw is locked. Please activate a package tier first.' });
        }

        const balance = parseFloat(user.withdrawableUsdt) || 0;
        if (balance < amt) {
            return res.status(400).json({ success: false, error: 'Insufficient withdrawable balance' });
        }

        // Deduct balance and insert request
        await db.run("UPDATE users SET withdrawableUsdt = withdrawableUsdt - ? WHERE LOWER(walletAddress) = ?", [amt, normWallet]);

        const withdrawId = `wdraw-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
        await db.run(
            "INSERT INTO withdrawals (id, walletAddress, amountUsdt, status, timestamp) VALUES (?, ?, ?, 'PENDING', ?)",
            [withdrawId, normWallet, amt, Date.now()]
        );

        res.json({ success: true, withdrawId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Fetch withdrawal history
app.get('/api/withdraw/history/:address', async (req, res) => {
    try {
        const address = req.params.address.trim().toLowerCase();
        const rows = await db.all("SELECT * FROM withdrawals WHERE LOWER(walletAddress) = ? ORDER BY timestamp DESC", [address]);
        res.json({ success: true, history: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ADMIN / UTILITY OVERRIDES ====================

// 1. Update NCH price exchange rate setting
app.post('/api/admin/settings/price', requireAdmin, async (req, res) => {
    try {
        const { price } = req.body;
        if (!price || isNaN(parseFloat(price))) return res.status(400).json({ success: false, error: 'Valid price is required' });

        await db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('nch_usdt_price', ?)", [price.toString()]);
        res.json({ success: true, message: 'NCH price updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Manual Yield Calculation trigger
app.post('/api/admin/process-yields', requireAdmin, async (req, res) => {
    try {
        const results = await mlmEngine.processDailyYields();
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Manual Matching Calculation trigger
app.post('/api/admin/process-matching', requireAdmin, async (req, res) => {
    try {
        const results = await mlmEngine.processAllMatching();
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Get all withdrawal requests
app.get('/api/admin/withdrawals', requireAdmin, async (req, res) => {
    try {
        const rows = await db.all("SELECT * FROM withdrawals ORDER BY timestamp DESC");
        res.json({ success: true, withdrawals: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Approve withdrawal request (mark paid)
app.post('/api/admin/withdrawals/pay', requireAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Withdrawal request ID is required' });

        const reqRow = await db.get("SELECT * FROM withdrawals WHERE id = ?", [id]);
        if (!reqRow) return res.status(404).json({ success: false, error: 'Withdrawal request not found' });
        if (reqRow.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Withdrawal already paid or canceled' });

        await db.run("UPDATE withdrawals SET status = 'PAID' WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Reject withdrawal request (refund user withdrawableUsdt balance)
app.post('/api/admin/withdrawals/reject', requireAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'Withdrawal request ID is required' });

        const reqRow = await db.get("SELECT * FROM withdrawals WHERE id = ?", [id]);
        if (!reqRow) return res.status(404).json({ success: false, error: 'Withdrawal request not found' });
        if (reqRow.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Withdrawal already processed' });

        await db.run("UPDATE users SET withdrawableUsdt = withdrawableUsdt + ? WHERE LOWER(walletAddress) = ?", [reqRow.amountUsdt, reqRow.walletAddress.toLowerCase()]);
        await db.run("UPDATE withdrawals SET status = 'REJECTED' WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== VISUAL TREE & TESTING ENDPOINTS ====================

app.post('/api/mlm/register', async (req, res) => {
    try {
        const { walletAddress, sponsorAddress, preferredLeg } = req.body;
        const normWallet = walletAddress.toLowerCase();

        // Ensure user row exists for automated tests
        let user = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [normWallet]);
        if (!user) {
            let baseUsername = 'user_' + normWallet.slice(2, 8);
            await db.run(
                `INSERT INTO users (walletAddress, username, referrerUsername, legPreference, isActive, packageUsdt, withdrawableUsdt, joinedAt)
                 VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
                [normWallet, baseUsername, null, preferredLeg || 'L', Date.now()]
            );
        }

        const result = await mlmEngine.registerNode(walletAddress, sponsorAddress, preferredLeg);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/mlm/volume', async (req, res) => {
    try {
        const { walletAddress, amount } = req.body;
        const result = await mlmEngine.addVolume(walletAddress, amount);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/mlm/tree/:address', async (req, res) => {
    try {
        const tree = await mlmEngine.getTreeStructure(req.params.address, parseInt(req.query.depth) || 3);
        res.json({ success: true, tree });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/mlm/stats/:address', async (req, res) => {
    try {
        const stats = await mlmEngine.getStats(req.params.address);
        if (!stats) return res.status(404).json({ success: false, error: 'Member not found' });
        res.json({ success: true, ...stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/mlm/resolve-ref/:code', async (req, res) => {
    try {
        const walletAddress = await mlmEngine.resolveReferralCode(req.params.code);
        if (!walletAddress) return res.status(404).json({ success: false, error: 'Referral code not resolved' });
        res.json({ success: true, walletAddress });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Serve frontend SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function seedInitialNodes() {
    try {
        const genesisAddress = '0x0e6ec6713e7b5b7c11d969da848813d08223598e';
        const masterAddress = '0x3801490c9f806c917b8cba710db9135fa3b116ae';

        // Check if Genesis Node is in binary_tree
        const treeRoot = await db.get("SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?", [genesisAddress]);
        if (!treeRoot) {
            await mlmEngine.registerNode(genesisAddress, null, 'L');
        }

        // Ensure genesis user exists in users table
        const genUser = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [genesisAddress]);
        if (!genUser) {
            await db.run(
                `INSERT OR IGNORE INTO users (walletAddress, username, referrerUsername, legPreference, isActive, packageUsdt, withdrawableUsdt, rank, joinedAt, isAdmin)
                 VALUES (?, 'GenesisRoot', null, 'L', 1, 5000, 0, 'Triple Diamond', ?, 1)`,
                [genesisAddress, Date.now()]
            );
        }

        // Ensure master vault user exists in users table
        const masterUser = await db.get("SELECT * FROM users WHERE LOWER(walletAddress) = ?", [masterAddress]);
        if (!masterUser) {
            await db.run(
                `INSERT OR IGNORE INTO users (walletAddress, username, referrerUsername, legPreference, isActive, packageUsdt, withdrawableUsdt, rank, joinedAt, isAdmin)
                 VALUES (?, 'MasterVault', 'GenesisRoot', 'L', 1, 5000, 0, 'Triple Diamond', ?, 1)`,
                [masterAddress, Date.now()]
            );
        }
    } catch (e) {
        console.warn('⚠️ Seeding initial nodes notice:', e.message);
    }
}

app.listen(PORT, async () => {
    await seedInitialNodes();
    console.log(`🚀 Tier Leverage Server running on port ${PORT}`);
});
