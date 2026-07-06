const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use isolated test DB
const testDbPath = path.join(__dirname, 'test-mlm.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
process.env.DB_PATH = testDbPath;

const mlmEngine = require('../mlm-engine');

async function runTests() {
    console.log('🧪 Starting NCH Binary MLM Automated Verification Test Suite...\n');

    const rootWallet = '0x0e6ec6713e7b5b7c11d969da848813d08223598e';
    const leftChild1 = '0x1111111111111111111111111111111111111111';
    const leftChild2 = '0x2222222222222222222222222222222222222222';
    const rightChild1 = '0x3333333333333333333333333333333333333333';

    // 1. Register Genesis Root Node
    console.log('1️⃣ Testing Genesis Root Registration...');
    const regRoot = await mlmEngine.registerNode(rootWallet, null, 'L');
    assert.strictEqual(regRoot.success, true);
    assert.strictEqual(regRoot.placementType, 'Genesis');
    console.log('✅ Genesis node registered successfully.');

    // 2. Register Left Child 1
    console.log('\n2️⃣ Testing Left Leg Placement...');
    const regL1 = await mlmEngine.registerNode(leftChild1, rootWallet, 'L');
    assert.strictEqual(regL1.success, true);
    assert.strictEqual(regL1.placementType, 'Direct');
    console.log('✅ Left child 1 placed directly on Left leg.');

    // 3. Register Left Child 2 (Spillover test)
    console.log('\n3️⃣ Testing Extreme Left Leg Spillover Placement...');
    const regL2 = await mlmEngine.registerNode(leftChild2, rootWallet, 'L');
    assert.strictEqual(regL2.success, true);
    assert.strictEqual(regL2.placementType, 'Spillover');
    assert.strictEqual(regL2.node.uplineAddress.toLowerCase(), leftChild1.toLowerCase());
    console.log('✅ Left child 2 automatically spilled over under Left Child 1.');

    // 4. Register Right Child 1
    console.log('\n4️⃣ Testing Right Leg Placement...');
    const regR1 = await mlmEngine.registerNode(rightChild1, rootWallet, 'R');
    assert.strictEqual(regR1.success, true);
    assert.strictEqual(regR1.placementType, 'Direct');
    console.log('✅ Right child 1 placed directly on Right leg.');

    // 5. Add Volume to Left Branch
    console.log('\n5️⃣ Testing Volume Addition & Upline Bubble-Up (Left Leg: 10,000 NCH)...');
    const volL = await mlmEngine.addVolume(leftChild2, 10000);
    assert.strictEqual(volL.success, true);
    assert.strictEqual(volL.bubbledLevels, 2);

    let statsRoot = await mlmEngine.getStats(rootWallet);
    assert.strictEqual(statsRoot.leftVolume, 10000);
    assert.strictEqual(statsRoot.leftCarryover, 10000);
    console.log(`✅ Left leg volume bubbled up to root: Left Vol = ${statsRoot.leftVolume} NCH.`);

    // 6. Add Volume to Right Branch
    console.log('\n6️⃣ Testing Volume Addition (Right Leg: 6,000 NCH)...');
    const volR = await mlmEngine.addVolume(rightChild1, 6000);
    assert.strictEqual(volR.success, true);

    statsRoot = await mlmEngine.getStats(rootWallet);
    assert.strictEqual(statsRoot.rightVolume, 6000);
    assert.strictEqual(statsRoot.rightCarryover, 6000);
    console.log(`✅ Right leg volume bubbled up to root: Right Vol = ${statsRoot.rightVolume} NCH.`);

    // 7. Calculate Weak Leg Binary Pair Matching Bonus
    console.log('\n7️⃣ Testing Weaker Leg Binary Pair Matching Payout & Carryover Calculation...');
    // Left Carryover = 10,000 NCH, Right Carryover = 6,000 NCH.
    // Weak leg = 6,000 NCH. 10% bonus = 600 NCH.
    const matchRes = await mlmEngine.calculateMatchingBonus(rootWallet);
    assert.strictEqual(matchRes.weakLegVolume, 6000);
    assert.strictEqual(matchRes.paid, 600);
    assert.strictEqual(matchRes.leftCarryover, 4000); // 10000 - 6000
    assert.strictEqual(matchRes.rightCarryover, 0);   // 6000 - 6000
    console.log(`✅ Binary Pair Matching Verified! Paid: ${matchRes.paid} NCH. New Left Carryover: ${matchRes.leftCarryover} NCH. New Right Carryover: ${matchRes.rightCarryover} NCH.`);

    // 8. Test Visual Tree Hierarchy Retrieval
    console.log('\n8️⃣ Testing Visual Tree Hierarchy Generation...');
    const treeObj = await mlmEngine.getTreeStructure(rootWallet, 3);
    assert.notStrictEqual(treeObj, null);
    assert.notStrictEqual(treeObj.leftChild, null);
    assert.notStrictEqual(treeObj.rightChild, null);
    console.log('✅ Visual tree structure generated with Left & Right branches.');

    // 9. Test Referral Code Prefix Resolution
    console.log('\n9️⃣ Testing Referral Code prefix lookup resolution...');
    const resolvedGenesis = await mlmEngine.resolveReferralCode('CHEESE-0E6EC671');
    assert.strictEqual(resolvedGenesis.toLowerCase(), rootWallet.toLowerCase());
    
    const resolvedFullHex = await mlmEngine.resolveReferralCode('0x0e6ec6713e7b5b7c11d969da848813d08223598e');
    assert.strictEqual(resolvedFullHex.toLowerCase(), rootWallet.toLowerCase());
    console.log(`✅ Referral prefix lookup matches perfectly. Resolved: ${resolvedGenesis}`);

    // Cleanup
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    console.log('\n🎉 ALL NCH BINARY MLM AUTOMATED TESTS PASSED 100% PERFECTLY!\n');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    process.exit(1);
});
