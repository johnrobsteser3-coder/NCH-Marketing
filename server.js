const express = require('express');
const cors = require('cors');
const path = require('path');
const mlmEngine = require('./mlm-engine');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== HEALTH ENDPOINT ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NCH-Marketing Sovereign Server',
        timestamp: Date.now(),
        version: '1.0.0'
    });
});

// ==================== MLM API ROUTES ====================

// 1. Register wallet node in Binary Tree
app.post('/api/mlm/register', async (req, res) => {
    try {
        const { walletAddress, sponsorAddress, preferredLeg } = req.body;
        if (!walletAddress) {
            return res.status(400).json({ success: false, error: 'walletAddress is required' });
        }

        const result = await mlmEngine.registerNode(walletAddress, sponsorAddress, preferredLeg);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('❌ Registration API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Add volume to node (Bubbles up)
app.post('/api/mlm/volume', async (req, res) => {
    try {
        const { walletAddress, amount } = req.body;
        if (!walletAddress || !amount) {
            return res.status(400).json({ success: false, error: 'walletAddress and amount are required' });
        }

        const result = await mlmEngine.addVolume(walletAddress, amount);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('❌ Volume API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Process Binary Pair Matching
app.post('/api/mlm/process-matching', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        if (walletAddress) {
            const result = await mlmEngine.calculateMatchingBonus(walletAddress);
            return res.json({ success: true, result });
        }

        const allResults = await mlmEngine.processAllMatching();
        res.json({ success: true, ...allResults });
    } catch (error) {
        console.error('❌ Matching API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Fetch Tree Structure for UI Visualizer
app.get('/api/mlm/tree/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const depth = parseInt(req.query.depth) || 3;
        const tree = await mlmEngine.getTreeStructure(address, depth);

        if (!tree) {
            return res.status(404).json({ success: false, error: 'Wallet not found in Binary Tree' });
        }

        res.json({ success: true, tree });
    } catch (error) {
        console.error('❌ Tree API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Fetch Wallet Stats Summary
app.get('/api/mlm/stats/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const stats = await mlmEngine.getStats(address);

        if (!stats) {
            return res.status(404).json({ success: false, error: 'Wallet not registered in Binary Tree' });
        }

        res.json({ success: true, stats });
    } catch (error) {
        console.error('❌ Stats API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Resolve referral code/prefix to full wallet address
app.get('/api/mlm/resolve-ref/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const walletAddress = await mlmEngine.resolveReferralCode(code);
        if (!walletAddress) {
            return res.status(404).json({ success: false, error: 'Referral code not found' });
        }
        res.json({ success: true, walletAddress });
    } catch (error) {
        console.error('❌ Resolve API Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve frontend SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 NCH-Marketing Sovereign Server running on port ${PORT}`);
});

