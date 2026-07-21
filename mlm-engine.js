const db = require('./db');

class NLMMatchingEngine {
    constructor() {
        this.MATCHING_PERCENTAGE = 0.10; // 10% on weaker leg volume
        this.DEFAULT_DAILY_CAP = 1000;    // 1,000 NCH max payout per day per wallet
    }

    normalizeAddress(address) {
        if (!address) return null;
        return address.trim().toLowerCase();
    }

    /**
     * Register a wallet node in the Binary Tree
     */
    async registerNode(walletAddress, sponsorAddress = null, preferredLeg = 'L') {
        const wallet = this.normalizeAddress(walletAddress);
        const sponsor = this.normalizeAddress(sponsorAddress);
        const position = (preferredLeg || 'L').toUpperCase() === 'R' ? 'R' : 'L';

        if (!wallet) throw new Error('Invalid wallet address');

        // Check if node already exists
        const existing = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (existing) {
            return { success: true, isNew: false, node: existing, message: 'Node already registered in Binary Tree' };
        }

        // Genesis / Root check
        const totalNodes = await db.get('SELECT COUNT(*) as count FROM binary_tree');
        if (totalNodes.count === 0 || !sponsor) {
            await db.run(
                `INSERT INTO binary_tree (walletAddress, sponsorAddress, uplineAddress, position, leftVolume, rightVolume, leftCarryover, rightCarryover, totalEarned, rank, joinedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [wallet, null, null, null, 0, 0, 0, 0, 0, 'Genesis', Date.now()]
            );
            const genesisNode = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
            return { success: true, isNew: true, node: genesisNode, placementType: 'Genesis' };
        }

        // Verify Sponsor exists
        const sponsorNode = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [sponsor]);
        if (!sponsorNode) {
            // If sponsor address not found, fallback to Genesis Node
            const genesisNode = await db.get('SELECT walletAddress FROM binary_tree ORDER BY joinedAt ASC LIMIT 1');
            if (genesisNode) {
                return await this.registerNode(wallet, genesisNode.walletAddress, position);
            }
            throw new Error(`Sponsor address ${sponsorAddress} does not exist in Binary Tree`);
        }

        // Determine placement using Extreme Spillover Search
        let currentUpline = sponsorNode.walletAddress;
        while (true) {
            const childNode = await db.get(
                'SELECT * FROM binary_tree WHERE LOWER(uplineAddress) = ? AND position = ?',
                [currentUpline.toLowerCase(), position]
            );
            if (!childNode) break;
            currentUpline = childNode.walletAddress;
        }

        await db.run(
            `INSERT INTO binary_tree (walletAddress, sponsorAddress, uplineAddress, position, leftVolume, rightVolume, leftCarryover, rightCarryover, totalEarned, rank, joinedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [wallet, sponsorNode.walletAddress, currentUpline, position, 0, 0, 0, 0, 0, 'Member', Date.now()]
        );

        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        console.log(`🌲 New Node Placed: ${wallet} under Upline: ${currentUpline} (${position} Leg)`);
        return { success: true, isNew: true, node, placementType: currentUpline === sponsorNode.walletAddress ? 'Direct' : 'Spillover' };
    }

    /**
     * Add volume to node (Bubbles up)
     */
    async addVolume(walletAddress, volumeAmount) {
        const wallet = this.normalizeAddress(walletAddress);
        const amount = parseFloat(volumeAmount) || 0;
        if (!wallet || amount <= 0) return { success: false, error: 'Invalid volume parameters' };

        let currentNode = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!currentNode) return { success: false, error: 'Node not found' };

        let childPosition = currentNode.position;
        let parentAddress = currentNode.uplineAddress;
        let depth = 0;

        while (parentAddress && depth < 100) {
            const parentLower = parentAddress.toLowerCase();
            if (childPosition === 'L') {
                await db.run(
                    `UPDATE binary_tree 
                     SET leftVolume = leftVolume + ?, leftCarryover = leftCarryover + ? 
                     WHERE LOWER(walletAddress) = ?`,
                    [amount, amount, parentLower]
                );
            } else if (childPosition === 'R') {
                await db.run(
                    `UPDATE binary_tree 
                     SET rightVolume = rightVolume + ?, rightCarryover = rightCarryover + ? 
                     WHERE LOWER(walletAddress) = ?`,
                    [amount, amount, parentLower]
                );
            }

            // Check rank advancement for parent
            await this.checkRankAdvancement(parentLower);
            // Check 15% One-Time Binary Activation bonus for parent
            await this.checkOneTimeBinaryBonus(parentLower);
            // Check Pairing Matching bonus for parent
            await this.calculateMatchingBonus(parentLower);

            // Move up
            const parentNode = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [parentLower]);
            if (!parentNode) break;
            childPosition = parentNode.position;
            parentAddress = parentNode.uplineAddress;
            depth++;
        }

        console.log(`📈 Added ${amount} BV volume for ${wallet} (Bubbled up ${depth} levels)`);
        return { success: true, bubbledLevels: depth, amount };
    }

    isTimestampInCurrentMonth(ts) {
        if (!ts) return false;
        const d = new Date(ts);
        const now = new Date();
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }

    async countActiveDownlinesInCurrentMonth(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const children = await db.all('SELECT walletAddress FROM binary_tree WHERE LOWER(uplineAddress) = ?', [wallet]);
        let count = 0;
        for (const c of children) {
            const user = await db.get("SELECT isActive, packageActivatedAt FROM users WHERE LOWER(walletAddress) = ?", [c.walletAddress.toLowerCase()]);
            if (user && user.isActive === 1 && this.isTimestampInCurrentMonth(user.packageActivatedAt)) {
                count += 1;
            }
            count += await this.countActiveDownlinesInCurrentMonth(c.walletAddress);
        }
        return count;
    }

    /**
     * Rank Advancement Evaluation
     */
    async checkRankAdvancement(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!node) return;

        // "A member is 'active for ranking' only if they hold a qualifying activation package purchased within the current calendar month."
        const user = await db.get('SELECT isActive, packageActivatedAt FROM users WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!user || user.isActive === 0 || !this.isTimestampInCurrentMonth(user.packageActivatedAt)) {
            // Node itself is not active for ranking this month!
            return;
        }

        // Count recursive active downline members in current month
        const activeDownlineCount = await this.countActiveDownlinesInCurrentMonth(wallet);

        let targetRank = 'Member';
        let bonus = 0;

        if (activeDownlineCount >= 3000) {
            targetRank = 'Triple Diamond';
            bonus = 30000;
        } else if (activeDownlineCount >= 1000) {
            targetRank = 'Double Diamond';
            bonus = 10000;
        } else if (activeDownlineCount >= 300) {
            targetRank = 'Diamond';
            bonus = 3000;
        } else if (activeDownlineCount >= 100) {
            targetRank = 'Gold';
            bonus = 1000;
        } else if (activeDownlineCount >= 30) {
            targetRank = 'Silver';
            bonus = 300;
        } else if (activeDownlineCount >= 10) {
            targetRank = 'Bronze';
            bonus = 100;
        }

        if (targetRank !== 'Member') {
            // Check if already paid this specific rank bonus this month
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            const alreadyPaid = await db.get(
                "SELECT COUNT(*) as count FROM mlm_commissions WHERE LOWER(walletAddress) = ? AND type = ? AND timestamp >= ?",
                [wallet, `RANK_BONUS_${targetRank}`, monthStart]
            );

            if (alreadyPaid.count === 0) {
                // Perform rank update
                await db.run('UPDATE binary_tree SET rank = ? WHERE LOWER(walletAddress) = ?', [targetRank, wallet]);
                await db.run('UPDATE users SET rank = ? WHERE LOWER(walletAddress) = ?', [targetRank, wallet]);
                await db.run('UPDATE users SET withdrawableUsdt = withdrawableUsdt + ? WHERE LOWER(walletAddress) = ?', [bonus, wallet]);

                // Log payout
                const commId = `comm-${Date.now()}-\${Math.random().toString(36).substr(2, 7)}`;
                await db.run(
                    `INSERT INTO mlm_commissions (id, walletAddress, type, amount, weakLegVolume, timestamp, status)
                     VALUES (?, ?, ?, ?, 0, ?, 'PAID')`,
                    [commId, wallet, `RANK_BONUS_${targetRank}`, bonus, Date.now()]
                );
                console.log(`🏆 Rank Advanced: ${wallet} promoted to ${targetRank} (+ ${bonus} USDT)`);
            }
        }
    }

    /**
     * Standard 10% Binary Matching Bonus calculation
     */
    async calculateMatchingBonus(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!node) return { paid: 0, reason: 'Node not found' };

        const leftCarry = parseFloat(node.leftCarryover) || 0;
        const rightCarry = parseFloat(node.rightCarryover) || 0;

        const weakLegVolume = Math.min(leftCarry, rightCarry);
        if (weakLegVolume <= 0) {
            return { paid: 0, weakLegVolume: 0, leftCarryover: leftCarry, rightCarryover: rightCarry, reason: 'No matching weak leg volume' };
        }

        const rawBonus = weakLegVolume * this.MATCHING_PERCENTAGE;
        const dateStr = new Date().toISOString().split('T')[0];

        const dailyRecord = await db.get(
            'SELECT amount FROM daily_earnings WHERE LOWER(walletAddress) = ? AND dateStr = ?',
            [wallet, dateStr]
        );
        const todayEarned = dailyRecord ? parseFloat(dailyRecord.amount) : 0;
        const availableCap = Math.max(0, this.DEFAULT_DAILY_CAP - todayEarned);

        const actualBonus = Math.min(rawBonus, availableCap);
        if (actualBonus <= 0) {
            return { paid: 0, rawBonus, weakLegVolume, reason: 'Daily capping limit reached' };
        }

        const newLeftCarry = leftCarry - weakLegVolume;
        const newRightCarry = rightCarry - weakLegVolume;

        await db.run(
            `UPDATE binary_tree 
             SET leftCarryover = ?, rightCarryover = ?, totalEarned = totalEarned + ? 
             WHERE LOWER(walletAddress) = ?`,
            [newLeftCarry, newRightCarry, actualBonus, wallet]
        );

        // Add matching bonus to user withdrawable balance
        await db.run('UPDATE users SET withdrawableUsdt = withdrawableUsdt + ? WHERE LOWER(walletAddress) = ?', [actualBonus, wallet]);

        await db.run(
            `INSERT INTO daily_earnings (walletAddress, dateStr, amount) VALUES (?, ?, ?)
             ON CONFLICT(walletAddress, dateStr) DO UPDATE SET amount = amount + ?`,
            [wallet, dateStr, actualBonus, actualBonus]
        );

        const commId = `comm-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
        await db.run(
            `INSERT INTO mlm_commissions (id, walletAddress, type, amount, weakLegVolume, timestamp, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [commId, wallet, 'BINARY_MATCHING', actualBonus, weakLegVolume, Date.now(), 'PAID']
        );

        return {
            paid: actualBonus,
            rawBonus,
            weakLegVolume,
            leftCarryover: newLeftCarry,
            rightCarryover: newRightCarry,
            capped: actualBonus < rawBonus
        };
    }

    /**
     * Check and process the one-time 15% Binary Activation Bonus
     */
    async checkOneTimeBinaryBonus(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const user = await db.get('SELECT * FROM users WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!user || user.isActive === 0 || user.packageUsdt <= 0) return;

        // Check if already paid
        const alreadyPaid = await db.get(
            "SELECT COUNT(*) as count FROM mlm_commissions WHERE LOWER(walletAddress) = ? AND type = 'BINARY_ONE_TIME'",
            [wallet]
        );
        if (alreadyPaid.count > 0) return;

        // Check if has at least one active member in Left leg AND Right leg downline
        // Walk left branch
        const leftChild = await db.get('SELECT walletAddress FROM binary_tree WHERE LOWER(uplineAddress) = ? AND position = "L"', [wallet]);
        const rightChild = await db.get('SELECT walletAddress FROM binary_tree WHERE LOWER(uplineAddress) = ? AND position = "R"', [wallet]);

        if (!leftChild || !rightChild) return;

        // Verify active status of at least 1 downline in each leg
        const leftActive = await this.hasActiveDownline(leftChild.walletAddress);
        const rightActive = await this.hasActiveDownline(rightChild.walletAddress);

        if (leftActive && rightActive) {
            const bonusAmount = user.packageUsdt * 0.15; // 15% binary bonus
            await db.run('UPDATE users SET withdrawableUsdt = withdrawableUsdt + ? WHERE LOWER(walletAddress) = ?', [bonusAmount, wallet]);

            const commId = `comm-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
            await db.run(
                `INSERT INTO mlm_commissions (id, walletAddress, type, amount, weakLegVolume, timestamp, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [commId, wallet, 'BINARY_ONE_TIME', bonusAmount, 0, Date.now(), 'PAID']
            );
            console.log(`🎉 15% One-Time Binary Payout to ${wallet}: ${bonusAmount} USDT`);
        }
    }

    async hasActiveDownline(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const user = await db.get('SELECT isActive FROM users WHERE LOWER(walletAddress) = ?', [wallet]);
        if (user && user.isActive === 1) return true;

        const children = await db.all('SELECT walletAddress FROM binary_tree WHERE LOWER(uplineAddress) = ?', [wallet]);
        for (const child of children) {
            const active = await this.hasActiveDownline(child.walletAddress);
            if (active) return true;
        }
        return false;
    }

    /**
     * Process Daily Yields (called once daily or via admin manual trigger)
     */
    async processDailyYields() {
        const activeUsers = await db.all('SELECT * FROM users WHERE isActive = 1');
        const results = [];

        for (const user of activeUsers) {
            if (!user.walletAddress || user.packageUsdt <= 0) continue;

            // Yield rate ranges between 0.1% and 5% based on package tiers
            let rate = 0.001; // default 0.1%
            const pkg = parseFloat(user.packageUsdt);
            if (pkg >= 5000) rate = 0.05;      // 5.0%
            else if (pkg >= 3000) rate = 0.03;   // 3.0%
            else if (pkg >= 1000) rate = 0.01;   // 1.0%
            else if (pkg >= 500) rate = 0.005;   // 0.5%
            else if (pkg >= 300) rate = 0.003;   // 0.3%

            const yieldAmount = pkg * rate;

            // Credit yield
            await db.run('UPDATE users SET withdrawableUsdt = withdrawableUsdt + ? WHERE LOWER(walletAddress) = ?', [yieldAmount, user.walletAddress.toLowerCase()]);

            // Log commission
            const commId = `comm-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
            await db.run(
                `INSERT INTO mlm_commissions (id, walletAddress, type, amount, weakLegVolume, timestamp, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [commId, user.walletAddress.toLowerCase(), 'DAILY_YIELD', yieldAmount, 0, Date.now(), 'PAID']
            );

            results.push({ wallet: user.walletAddress, amount: yieldAmount });
        }
        return results;
    }

    async processAllMatching() {
        const nodes = await db.all('SELECT walletAddress FROM binary_tree');
        const results = [];
        for (const n of nodes) {
            await this.checkOneTimeBinaryBonus(n.walletAddress);
            const res = await this.calculateMatchingBonus(n.walletAddress);
            if (res.paid > 0) {
                results.push({ walletAddress: n.walletAddress, ...res });
            }
        }
        return { processedCount: nodes.length, payouts: results };
    }

    async getTreeStructure(walletAddress, depth = 3) {
        const wallet = this.normalizeAddress(walletAddress);
        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!node) return null;

        // Fetch active status from users table
        const user = await db.get('SELECT isActive, packageUsdt FROM users WHERE LOWER(walletAddress) = ?', [wallet]);

        const treeObj = {
            walletAddress: node.walletAddress,
            rank: node.rank,
            position: node.position,
            leftVolume: node.leftVolume,
            rightVolume: node.rightVolume,
            leftCarryover: node.leftCarryover,
            rightCarryover: node.rightCarryover,
            totalEarned: node.totalEarned,
            isActive: user ? user.isActive : 0,
            packageUsdt: user ? user.packageUsdt : 0,
            leftChild: null,
            rightChild: null
        };

        if (depth > 0) {
            const leftChild = await db.get('SELECT walletAddress FROM binary_tree WHERE LOWER(uplineAddress) = ? AND position = "L"', [wallet]);
            if (leftChild) {
                treeObj.leftChild = await this.getTreeStructure(leftChild.walletAddress, depth - 1);
            }
            const rightChild = await db.get('SELECT walletAddress FROM binary_tree WHERE LOWER(uplineAddress) = ? AND position = "R"', [wallet]);
            if (rightChild) {
                treeObj.rightChild = await this.getTreeStructure(rightChild.walletAddress, depth - 1);
            }
        }
        return treeObj;
    }

    async getStats(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!node) return null;

        const directRefs = await db.all(
            'SELECT b.walletAddress, b.joinedAt, u.isActive, u.packageUsdt FROM binary_tree b JOIN users u ON LOWER(b.walletAddress) = LOWER(u.walletAddress) WHERE LOWER(b.sponsorAddress) = ?',
            [wallet]
        );
        const commissions = await db.all('SELECT * FROM mlm_commissions WHERE LOWER(walletAddress) = ? ORDER BY timestamp DESC LIMIT 20', [wallet]);

        return {
            walletAddress: node.walletAddress,
            sponsorAddress: node.sponsorAddress,
            uplineAddress: node.uplineAddress,
            position: node.position,
            leftVolume: node.leftVolume,
            rightVolume: node.rightVolume,
            leftCarryover: node.leftCarryover,
            rightCarryover: node.rightCarryover,
            totalEarned: node.totalEarned,
            rank: node.rank,
            joinedAt: node.joinedAt,
            directReferralCount: directRefs.length,
            directReferrals: directRefs,
            recentCommissions: commissions
        };
    }

    async resolveReferralCode(code) {
        if (!code) return null;
        let cleaned = code.trim().toLowerCase();
        
        // Lookup from users table first
        const user = await db.get('SELECT walletAddress FROM users WHERE LOWER(username) = ? LIMIT 1', [cleaned]);
        if (user && user.walletAddress) return user.walletAddress;

        // Prefix resolution fallback
        if (cleaned.startsWith('tier-')) cleaned = cleaned.substring(5);
        if (cleaned.startsWith('0x')) cleaned = cleaned.substring(2);
        if (cleaned.length < 4) return null;
        
        const row = await db.get(
            `SELECT walletAddress FROM binary_tree WHERE LOWER(walletAddress) LIKE ? LIMIT 1`,
            [`0x${cleaned}%`]
        );
        return row ? row.walletAddress : null;
    }
}

module.exports = new NLMMatchingEngine();
