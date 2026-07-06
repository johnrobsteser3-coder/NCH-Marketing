const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

console.log('🧪 Testing NCH-Marketing Express Server Endpoints...');

const serverProcess = spawn('node', ['server.js'], { cwd: __dirname + '/..' });

serverProcess.stdout.on('data', async (data) => {
    const output = data.toString();
    console.log('[SERVER]:', output.trim());

    if (output.includes('running on port 4000')) {
        try {
            // Test 1: Health
            const health = await fetchJSON('http://localhost:4000/health');
            assert.strictEqual(health.status, 'ok');
            console.log('✅ /health endpoint OK');

            // Test 2: Register via HTTP
            const reg = await postJSON('http://localhost:4000/api/mlm/register', {
                walletAddress: '0x0e6ec6713e7b5b7c11d969da848813d08223598e',
                sponsorAddress: null,
                preferredLeg: 'L'
            });
            assert.strictEqual(reg.success, true);
            console.log('✅ /api/mlm/register HTTP endpoint OK');

            // Test 3: Stats via HTTP
            const stats = await fetchJSON('http://localhost:4000/api/mlm/stats/0x0e6ec6713e7b5b7c11d969da848813d08223598e');
            assert.strictEqual(stats.success, true);
            console.log('✅ /api/mlm/stats HTTP endpoint OK');

            // Test 4: Tree via HTTP
            const tree = await fetchJSON('http://localhost:4000/api/mlm/tree/0x0e6ec6713e7b5b7c11d969da848813d08223598e');
            assert.strictEqual(tree.success, true);
            console.log('✅ /api/mlm/tree HTTP endpoint OK');

            // Test 5: Resolve Referral via HTTP
            const resolve = await fetchJSON('http://localhost:4000/api/mlm/resolve-ref/CHEESE-0E6EC671');
            assert.strictEqual(resolve.success, true);
            assert.strictEqual(resolve.walletAddress, '0x0e6ec6713e7b5b7c11d969da848813d08223598e');
            console.log('✅ /api/mlm/resolve-ref HTTP endpoint OK');

            console.log('\n🎉 ALL EXPRESS HTTP ENDPOINTS TESTED PERFECTLY!\n');
            serverProcess.kill();
            process.exit(0);
        } catch (e) {
            console.error('❌ Server endpoint test failed:', e.message);
            serverProcess.kill();
            process.exit(1);
        }
    }
});

serverProcess.stderr.on('data', (data) => {
    console.error('[SERVER ERR]:', data.toString());
});

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function postJSON(url, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
