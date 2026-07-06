const db = require('./db');

class NLMMatchingEngine {
    constructor() {
        this.MATCHING_PERCENTAGE = 0.10; // 10% on weaker leg volume
        this.DEFAULT_DAILY_CAP = 1000;    // 1,000 NCH max payout per day per wallet
    }

    /**
     * Normalize Ethereum/NCH wallet address
     */
    normalizeAddress(address) {
        if (!address) return null;
        return address.trim().toLowerCase();
    }

    /**
     * Register a new wallet node in the Binary Tree with extreme spillover placement
     */
    async registerNode(walletAddress, sponsorAddress = null, preferredLeg = 'L') {
        const wallet = this.normalizeAddress(walletAddress);
        const sponsor = this.normalizeAddress(sponsorAddress);
        const position = (preferredLeg || 'L').toUpperCase() === 'R' ? 'R' : 'L';

        if (!wallet) throw new Error('Invalid wallet address');

        // 1. Check if node already exists
        const existing = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (existing) {
            return { success: true, isNew: false, node: existing, message: 'Node already registered in Binary Tree' };
        }

        // 2. Genesis / Root check
        const totalNodes = await db.get('SELECT COUNT(*) as count FROM binary_tree');
        if (totalNodes.count === 0 || !sponsor) {
            const genesisNode = {
                walletAddress: wallet,
                sponsorAddress: null,
                uplineAddress: null,
                position: null,
                leftVolume: 0,
                rightVolume: 0,
                leftCarryover: 0,
                rightCarryover: 0,
                totalEarned: 0,
                rank: 'Genesis',
                joinedAt: Date.now()
            };

            await db.run(
                `INSERT INTO binary_tree (walletAddress, sponsorAddress, uplineAddress, position, leftVolume, rightVolume, leftCarryover, rightCarryover, totalEarned, rank, joinedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [wallet, null, null, null, 0, 0, 0, 0, 0, 'Genesis', Date.now()]
            );

            console.log(`🌟 Genesis Node Registered: ${wallet}`);
            return { success: true, isNew: true, node: genesisNode, placementType: 'Genesis' };
        }

        // 3. Verify Sponsor exists
        const sponsorNode = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [sponsor]);
        if (!sponsorNode) {
            throw new Error(`Sponsor address ${sponsorAddress} does not exist in Binary Tree`);
        }

        // 4. Determine placement using Extreme Spillover Search
        let currentUpline = sponsorNode.walletAddress;
        while (true) {
            const childNode = await db.get(
                'SELECT * FROM binary_tree WHERE LOWER(uplineAddress) = ? AND position = ?',
                [currentUpline.toLowerCase(), position]
            );

            if (!childNode) {
                // Found an open slot!
                break;
            }
            // Occupied! Spillover down the chosen extreme branch
            currentUpline = childNode.walletAddress;
        }

        const newNode = {
            walletAddress: wallet,
            sponsorAddress: sponsorNode.walletAddress,
            uplineAddress: currentUpline,
            position: position,
            leftVolume: 0,
            rightVolume: 0,
            leftCarryover: 0,
            rightCarryover: 0,
            totalEarned: 0,
            rank: 'Member',
            joinedAt: Date.now()
        };

        await db.run(
            `INSERT INTO binary_tree (walletAddress, sponsorAddress, uplineAddress, position, leftVolume, rightVolume, leftCarryover, rightCarryover, totalEarned, rank, joinedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [wallet, sponsorNode.walletAddress, currentUpline, position, 0, 0, 0, 0, 0, 'Member', Date.now()]
        );

        console.log(`🌲 New Node Placed: ${wallet} under Upline: ${currentUpline} (${position} Leg)`);
        return { success: true, isNew: true, node: newNode, placementType: currentUpline === sponsorNode.walletAddress ? 'Direct' : 'Spillover' };
    }

    /**
     * Add volume to a wallet node and recursively bubble it up to uplines
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

            // Move up to the next parent
            const parentNode = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [parentLower]);
            if (!parentNode) break;

            childPosition = parentNode.position;
            parentAddress = parentNode.uplineAddress;
            depth++;
        }

        console.log(`📈 Added ${amount} BV volume for ${wallet} (Bubbled up ${depth} levels)`);
        return { success: true, bubbledLevels: depth, amount };
    }

    /**
     * Calculate binary pair matching bonus for a specific node
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

        // Calculate 10% matching bonus
        const rawBonus = weakLegVolume * this.MATCHING_PERCENTAGE;

        // Today's Date String YYYY-MM-DD
        const dateStr = new Date().toISOString().split('T')[0];

        // Fetch today's earnings to enforce daily cap
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

        // Deduct matched volume from carryovers
        const newLeftCarry = leftCarry - weakLegVolume;
        const newRightCarry = rightCarry - weakLegVolume;

        // Update Node Database
        await db.run(
            `UPDATE binary_tree 
             SET leftCarryover = ?, rightCarryover = ?, totalEarned = totalEarned + ? 
             WHERE LOWER(walletAddress) = ?`,
            [newLeftCarry, newRightCarry, actualBonus, wallet]
        );

        // Update Daily Earnings
        await db.run(
            `INSERT INTO daily_earnings (walletAddress, dateStr, amount) VALUES (?, ?, ?)
             ON CONFLICT(walletAddress, dateStr) DO UPDATE SET amount = amount + ?`,
            [wallet, dateStr, actualBonus, actualBonus]
        );

        // Log Payout Commission
        const commId = `comm-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
        await db.run(
            `INSERT INTO mlm_commissions (id, walletAddress, type, amount, weakLegVolume, timestamp, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [commId, wallet, 'MATCHING', actualBonus, weakLegVolume, Date.now(), 'PAID']
        );

        console.log(`💰 Binary Bonus Paid to ${wallet}: ${actualBonus} NCH (Matched Vol: ${weakLegVolume})`);
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
     * Process binary matching calculations for all nodes in the tree
     */
    async processAllMatching() {
        const nodes = await db.all('SELECT walletAddress FROM binary_tree');
        const results = [];
        for (const n of nodes) {
            const res = await this.calculateMatchingBonus(n.walletAddress);
            if (res.paid > 0) {
                results.push({ walletAddress: n.walletAddress, ...res });
            }
        }
        return { processedCount: nodes.length, payouts: results };
    }

    /**
     * Fetch hierarchical tree structure up to depth maxDepth for frontend UI
     */
    async getTreeStructure(walletAddress, depth = 3) {
        const wallet = this.normalizeAddress(walletAddress);
        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!node) return null;

        const treeObj = {
            walletAddress: node.walletAddress,
            rank: node.rank,
            position: node.position,
            leftVolume: node.leftVolume,
            rightVolume: node.rightVolume,
            leftCarryover: node.leftCarryover,
            rightCarryover: node.rightCarryover,
            totalEarned: node.totalEarned,
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

    /**
     * Fetch user stats summary for wallet
     */
    async getStats(walletAddress) {
        const wallet = this.normalizeAddress(walletAddress);
        const node = await db.get('SELECT * FROM binary_tree WHERE LOWER(walletAddress) = ?', [wallet]);
        if (!node) return null;

        const directRefs = await db.all('SELECT walletAddress, joinedAt FROM binary_tree WHERE LOWER(sponsorAddress) = ?', [wallet]);
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

    /**
     * Resolve a referral code or wallet address prefix to a full wallet address
     */
    async resolveReferralCode(code) {
        if (!code) return null;
        
        let cleaned = code.trim().toLowerCase();
        
        // If it starts with CHEESE-, extract the suffix
        if (cleaned.startsWith('cheese-')) {
            cleaned = cleaned.substring(7);
        }
        
        // If it starts with 0x, remove the prefix
        if (cleaned.startsWith('0x')) {
            cleaned = cleaned.substring(2);
        }
        
        if (cleaned.length < 4) return null;
        
        const row = await db.get(
            `SELECT walletAddress FROM binary_tree WHERE LOWER(walletAddress) LIKE ? LIMIT 1`,
            [`0x${cleaned}%`]
        );
        
        return row ? row.walletAddress : null;
    }
}

module.exports = new NLMMatchingEngine();

