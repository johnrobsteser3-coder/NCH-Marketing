/**
 * Tier Leverage App Client Logic
 */

let currentUser = null;
let currentWallet = null;
let selectedLeg = 'L';
let selectedRegLeg = 'L';
let selectedPackageUsdt = 100;
let systemSettings = {
    nch_usdt_price: '0.02',
    platform_master_address: '0x3801490C9f806c917b8CbA710Db9135FA3B116ae'
};

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    fetchSystemSettings();
    checkURLParams();
});

// Check if wallet session exists in local storage
async function checkSession() {
    const savedWallet = localStorage.getItem('mlm_wallet');
    if (savedWallet) {
        currentWallet = savedWallet.toLowerCase();
        await walletLogin(currentWallet);
    }
}

// Fetch general network details
async function fetchSystemSettings() {
    try {
        const res = await fetch('/api/system/settings');
        const data = await res.json();
        if (data.success && data.settings) {
            systemSettings = { ...systemSettings, ...data.settings };
        }
        updatePaymentDetails();
    } catch (e) {
        console.warn("Failed to fetch settings, using defaults:", e.message);
    }
}

// Check URL parameters for invites: ?ref=username&leg=L
function checkURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    const leg = urlParams.get('leg');

    if (ref) {
        localStorage.setItem('pendingRef', ref);
        const refBanner = document.getElementById('loginRefBanner');
        const refText = document.getElementById('loginRefText');
        if (refBanner && refText) {
            refBanner.classList.remove('hidden');
            refText.textContent = `🎁 Sponsor invitation detected: Join under @${ref}`;
        }
    }
    if (leg && (leg.toUpperCase() === 'L' || leg.toUpperCase() === 'R')) {
        selectedRegLeg = leg.toUpperCase();
        localStorage.setItem('pendingLeg', selectedRegLeg);
    }
}

// Connect MetaMask Web3 Wallet
async function connectWeb3Wallet() {
    if (!window.ethereum) return alert('MetaMask extension not detected. Please install MetaMask to use Tier Leverage.');
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
            currentWallet = accounts[0].toLowerCase();
            await walletLogin(currentWallet);
        }
    } catch (e) {
        alert('EVM Connection failed: ' + e.message);
    }
}

// Connect manual wallet address typed in input field
async function connectManualWalletAddress() {
    const inputVal = document.getElementById('manualWalletInput').value.trim();
    if (!inputVal) return alert('Please enter an EVM wallet address.');
    
    // EVM Address regex verification (starts with 0x, followed by 40 hex chars)
    const isEvm = /^0x[a-fA-F0-9]{40}$/.test(inputVal);
    if (!isEvm) {
        return alert('Invalid EVM address format. Address must start with "0x" and be exactly 42 characters long.');
    }
    
    currentWallet = inputVal.toLowerCase();
    await walletLogin(currentWallet);
}

// Check wallet registration status and log in or show registration form
async function walletLogin(wallet) {
    try {
        const res = await fetch(`/api/auth/wallet/${wallet}`);
        const data = await res.json();
        if (data.success) {
            if (data.registered) {
                // Already registered -> log in immediately
                currentUser = data.user;
                localStorage.setItem('mlm_wallet', wallet);
                document.getElementById('registerFormContainer').classList.add('hidden');
                showAppView();
            } else {
                // Not registered -> display registration inputs
                document.getElementById('registerFormContainer').classList.remove('hidden');
                document.getElementById('connectionStatus').innerHTML = `🟢 Wallet Connected: <span style="font-family:monospace; color:var(--primary);">${wallet.slice(0, 10)}...${wallet.slice(-6)}</span><br/>Wallet is not registered on-chain yet. Please register your profile below.`;
                
                // Pre-fill sponsor if pending referral exists
                const pendingRef = localStorage.getItem('pendingRef') || '';
                if (pendingRef) {
                    document.getElementById('regSponsor').value = pendingRef;
                }
                const pendingLeg = localStorage.getItem('pendingLeg') || 'L';
                selectRegLeg(pendingLeg);
            }
        }
    } catch (e) {
        alert('Auth query error: ' + e.message);
    }
}

// Handle Web3 new account registration submission
async function handleWeb3Registration(e) {
    e.preventDefault();
    if (!currentWallet) return alert('Please connect MetaMask first');

    const username = document.getElementById('regUsername').value.trim();
    const sponsorUsername = document.getElementById('regSponsor').value.trim();
    const position = selectedRegLeg;

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: currentWallet,
                username,
                sponsorUsername,
                position
            })
        });
        const data = await res.json();
        if (data.success && data.user) {
            currentUser = data.user;
            localStorage.setItem('mlm_wallet', currentWallet);
            localStorage.removeItem('pendingRef');
            localStorage.removeItem('pendingLeg');
            document.getElementById('registerFormContainer').classList.add('hidden');
            alert('🎉 Account registered and node placed in tree successfully!');
            showAppView();
        } else {
            alert('Registration failed: ' + data.error);
        }
    } catch (err) {
        alert('Error registering node: ' + err.message);
    }
}

// Select registration leg selection visual helper
function selectRegLeg(leg) {
    selectedRegLeg = leg === 'R' ? 'R' : 'L';
    document.getElementById('regLegL').classList.toggle('active', selectedRegLeg === 'L');
    document.getElementById('regLegR').classList.toggle('active', selectedRegLeg === 'R');
}

function handleLogout() {
    localStorage.removeItem('mlm_wallet');
    currentUser = null;
    currentWallet = null;
    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('appView').classList.add('hidden');
    document.getElementById('connectionStatus').textContent = 'Connect your EVM wallet to access the dashboard';
}

// Display Main HUB layout
function showAppView() {
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('appView').classList.remove('hidden');

    // Populate user profile info in navbar
    document.getElementById('navUsername').textContent = currentUser.username || 'Unclaimed';
    document.getElementById('navWallet').textContent = `${currentUser.walletAddress.slice(0, 10)}...${currentUser.walletAddress.slice(-6)}`;

    // Load active tab
    switchTab('dashboard');
    loadProfileStats();

    // Check MetaMask wallet presence / switch status
    updateChainIndicator();
}

// Tab navigation controller
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.side-tab').forEach(el => el.classList.remove('active'));

    const tabEl = document.getElementById(`tab-${tabId}`);
    if (tabEl) tabEl.classList.remove('hidden');

    // Find side-tab matching the action and highlight
    const tabBtns = document.querySelectorAll('.side-tab');
    for (const btn of tabBtns) {
        if (btn.getAttribute('onclick').includes(tabId)) {
            btn.classList.add('active');
        }
    }

    if (tabId === 'admin') {
        if (!currentUser || !currentUser.isAdmin) {
            return switchTab('dashboard');
        }
        loadAdminWithdrawals();
    } else if (tabId === 'tree') {
        refreshTree();
    } else if (tabId === 'withdrawals') {
        loadWithdrawalsHistory();
    }
}

// Load current user profile from DB
async function loadProfileStats() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/user/profile/${currentUser.walletAddress}`);
        const data = await res.json();
        if (data.success && data.user) {
            currentUser = data.user;

            // Manage Admin Tab visibility based on server authorization
            const adminBtn = document.getElementById('adminTabBtn');
            if (adminBtn) {
                if (currentUser.isAdmin) {
                    adminBtn.classList.remove('hidden');
                } else {
                    adminBtn.classList.add('hidden');
                }
            }

            // Setup welcome text and wallet state
            document.getElementById('dashWelcomeName').textContent = currentUser.username;
            document.getElementById('profileUsernameVal').value = currentUser.username;

            // Wallet details
            const userCard = document.getElementById('userWalletCard');
            const activeAddr = document.getElementById('activeAddress');
            const activeRank = document.getElementById('activeRank');

            userCard.style.opacity = '1';
            activeAddr.textContent = `${currentUser.walletAddress.slice(0, 10)}...${currentUser.walletAddress.slice(-6)}`;
            activeRank.textContent = currentUser.rank || 'Member';
            document.getElementById('wdrawAddress').value = currentUser.walletAddress;

            // Fill withdrawable balances
            const balVal = parseFloat(currentUser.withdrawableUsdt) || 0;
            document.getElementById('wdrawUsdtBalance').textContent = `${balVal.toFixed(2)} USDT`;

            const lockBadge = document.getElementById('wdrawLockBadge');
            if (currentUser.isActive === 1) {
                lockBadge.textContent = `🟢 Node Active (Yields Enabled: Tier ${currentUser.packageUsdt} USDT)`;
                lockBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
                lockBadge.style.color = '#10b981';
            } else {
                lockBadge.textContent = '🔒 Wallet Locked (Needs Package Activation)';
                lockBadge.style.backgroundColor = 'rgba(244, 63, 94, 0.2)';
                lockBadge.style.color = '#f43f5e';
            }

            // Render stats grid
            if (data.stats) {
                const s = data.stats;
                document.getElementById('leftVol').textContent = `${s.leftVolume.toLocaleString()} USDT`;
                document.getElementById('leftCarry').textContent = `Carryover: ${s.leftCarryover.toLocaleString()} USDT`;

                document.getElementById('rightVol').textContent = `${s.rightVolume.toLocaleString()} USDT`;
                document.getElementById('rightCarry').textContent = `Carryover: ${s.rightCarryover.toLocaleString()} USDT`;

                document.getElementById('totalEarned').textContent = `${s.totalEarned.toLocaleString()} USDT`;
                document.getElementById('directCount').textContent = s.directReferralCount || 0;
                document.getElementById('directActiveSub').textContent = `${s.directReferrals.filter(r => r.isActive === 1).length} Active Nodes`;

                // Render earnings log
                renderEarningsLog(s.recentCommissions || []);
            }

            // Referral share link configurations
            updateShareLinks();
        }
    } catch (e) {
        console.error('Failed to load profile data:', e.message);
    }
}

// Manage user custom username update
async function handleClaimUsername(e) {
    e.preventDefault();
    const newUsername = document.getElementById('profileUsernameVal').value.trim();
    if (!newUsername) return;

    try {
        const res = await fetch('/api/user/update-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: currentUser.walletAddress, username: newUsername })
        });
        const data = await res.json();
        if (data.success) {
            alert('Username updated successfully!');
            loadProfileStats();
        } else {
            alert('Username update failed: ' + data.error);
        }
    } catch (err) {
        alert('Error updating username: ' + err.message);
    }
}

async function updateChainIndicator() {
    if (!window.ethereum) return;
    try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const ind = document.getElementById('networkStatus');
        if (chainId === '0x4f1a') {
            ind.textContent = 'L1 Sovereign Network';
            ind.parentElement.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            ind.previousElementSibling.style.backgroundColor = '#10b981';
        } else {
            ind.textContent = 'Switch Chain L1';
            ind.parentElement.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            ind.previousElementSibling.style.backgroundColor = '#ef4444';
        }
    } catch {}
}

async function switchCheeseBlockchain() {
    if (!window.ethereum) return alert("Web3 wallet not detected");
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x4f1a' }]
        });
        updateChainIndicator();
    } catch (switchError) {
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x4f1a',
                        chainName: 'L1 Blockchain',
                        nativeCurrency: { name: 'NCH Coin', symbol: 'NCH', decimals: 18 },
                        rpcUrls: ['https://cheeseblockchain.com/api/rpc'],
                        blockExplorerUrls: ['https://cheeseblockchain.com/explorer/']
                    }]
                });
                updateChainIndicator();
            } catch (addError) {
                console.error(addError);
            }
        }
    }
}

function selectLeg(leg) {
    selectedLeg = leg === 'R' ? 'R' : 'L';
    document.getElementById('legBtnL').classList.toggle('active', selectedLeg === 'L');
    document.getElementById('legBtnR').classList.toggle('active', selectedLeg === 'R');
    updateShareLinks();
}

function updateShareLinks() {
    const username = currentUser.username || 'unclaimed';
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?ref=${username}&leg=${selectedLeg}`;
    document.getElementById('shareLinkInput').value = shareUrl;
}

function copyShareLink() {
    const val = document.getElementById('shareLinkInput').value;
    navigator.clipboard.writeText(val);
    alert('✅ Share Link copied to clipboard!');
}

// ==================== TIER PACKAGES & PAYMENT ====================

function selectPackageTier(amount, cardEl) {
    selectedPackageUsdt = amount;
    document.querySelectorAll('.package-tier-card').forEach(el => el.classList.remove('active'));

    if (cardEl && cardEl.classList) {
        cardEl.classList.add('active');
    } else {
        const cards = document.querySelectorAll('.package-tier-card');
        for (const card of cards) {
            const text = card.querySelector('.package-usdt')?.textContent?.trim() || '';
            if (text === `${amount} USDT`) {
                card.classList.add('active');
                break;
            }
        }
    }

    document.getElementById('activateUsdtAmount').value = amount;
    updatePaymentDetails();
}

function updatePaymentDetails() {
    const nchPrice = parseFloat(systemSettings.nch_usdt_price) || 0.02;
    const requiredNch = selectedPackageUsdt / nchPrice;

    document.getElementById('payTierUsdt').textContent = `${selectedPackageUsdt} USDT`;
    document.getElementById('payNchPrice').textContent = `1 NCH = ${nchPrice} USDT`;
    document.getElementById('payRequiredNch').textContent = `${requiredNch.toLocaleString(undefined, { maximumFractionDigits: 0 })} NCH`;
    document.getElementById('payMasterAddress').value = systemSettings.platform_master_address;
}

function copyMasterAddress() {
    const val = document.getElementById('payMasterAddress').value;
    navigator.clipboard.writeText(val);
    alert('✅ Platform Master address copied to clipboard!');
}

// Directly trigger native NCH Web3 wallet transfer to platform wallet
async function payWithWeb3Wallet() {
    if (!window.ethereum || !currentWallet) return alert('Please connect Web3 wallet first');
    await switchCheeseBlockchain();

    const nchPrice = parseFloat(systemSettings.nch_usdt_price) || 0.02;
    const requiredNch = selectedPackageUsdt / nchPrice;

    const valueWei = BigInt(Math.floor(requiredNch * 1e18));
    const hexValue = '0x' + valueWei.toString(16);

    try {
        const txHash = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [
                {
                    from: currentWallet,
                    to: systemSettings.platform_master_address,
                    value: hexValue
                }
            ]
        });
        if (txHash) {
            document.getElementById('activateTxHash').value = txHash;
            alert('🎉 Transaction sent successfully! Click "Verify & Activate Node" to submit.');
        }
    } catch (e) {
        alert('Transaction failed: ' + e.message);
    }
}

// Alias for backward compatibility
async function payWithMetaMask() {
    return payWithWeb3Wallet();
}

// Submit activation hash verification request
async function handleActivatePackage(e) {
    e.preventDefault();
    const hash = document.getElementById('activateTxHash').value.trim();

    try {
        const res = await fetch('/api/packages/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: currentUser.walletAddress,
                packageUsdt: selectedPackageUsdt,
                txHash: hash
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('🎉 Account activated successfully!');
            document.getElementById('activateTxHash').value = '';
            loadProfileStats();
            switchTab('dashboard');
        } else {
            alert('Activation verification failed: ' + data.error);
        }
    } catch (err) {
        alert('Error activating node: ' + err.message);
    }
}

// ==================== BINARY TREE VISUALIZER ====================

async function refreshTree() {
    const container = document.getElementById('treeContainer');
    if (!currentUser || !currentUser.walletAddress) {
        container.innerHTML = '<div class="tree-placeholder">Please connect and link a wallet node to view the Tree.</div>';
        return;
    }
    try {
        const res = await fetch(`/api/mlm/tree/${currentUser.walletAddress}?depth=3`);
        const data = await res.json();
        if (data.success && data.tree) {
            container.innerHTML = '';
            container.appendChild(buildTreeDOM(data.tree));
        } else {
            container.innerHTML = '<div class="tree-placeholder">No binary node registered.</div>';
        }
    } catch (e) {
        container.innerHTML = `<div class="tree-placeholder">Failed to load tree: ${e.message}</div>`;
    }
}

function buildTreeDOM(treeNode) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-wrapper';

    // Root Node Box
    const nodeBox = document.createElement('div');
    const isNodeActive = treeNode.isActive === 1;
    nodeBox.className = `node-box ${isNodeActive ? 'active-node' : 'inactive-node'}`;
    nodeBox.style.borderColor = isNodeActive ? '#10b981' : '#f43f5e';
    nodeBox.style.boxShadow = isNodeActive ? '0 0 10px rgba(16,185,129,0.3)' : 'none';

    nodeBox.innerHTML = `
        <div class="node-address" style="font-weight:bold;">${treeNode.walletAddress.slice(0, 6)}...${treeNode.walletAddress.slice(-4)}</div>
        <div class="node-vol" style="font-size:0.75rem; color:var(--text-muted);">
            L: ${treeNode.leftCarryover.toLocaleString()} | R: ${treeNode.rightCarryover.toLocaleString()}
        </div>
        <span class="badge" style="font-size: 0.65rem; background: ${isNodeActive ? '#10b981' : '#f43f5e'}; color: black; border-radius: 4px; padding: 1px 4px;">
            ${isNodeActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
    `;
    wrapper.appendChild(nodeBox);

    // Children Wrapper
    if (treeNode.leftChild || treeNode.rightChild) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';

        // Left Branch
        const leftBranch = document.createElement('div');
        leftBranch.className = 'tree-branch';
        leftBranch.innerHTML = `<span class="branch-label">LEFT (L)</span>`;
        if (treeNode.leftChild) {
            leftBranch.appendChild(buildTreeDOM(treeNode.leftChild));
        } else {
            leftBranch.innerHTML += `<div class="node-box empty-slot" style="opacity:0.4; border-style:dashed; color:var(--text-muted);">Open Slot</div>`;
        }
        childrenDiv.appendChild(leftBranch);

        // Right Branch
        const rightBranch = document.createElement('div');
        rightBranch.className = 'tree-branch';
        rightBranch.innerHTML = `<span class="branch-label">RIGHT (R)</span>`;
        if (treeNode.rightChild) {
            rightBranch.appendChild(buildTreeDOM(treeNode.rightChild));
        } else {
            rightBranch.innerHTML += `<div class="node-box empty-slot" style="opacity:0.4; border-style:dashed; color:var(--text-muted);">Open Slot</div>`;
        }
        childrenDiv.appendChild(rightBranch);

        wrapper.appendChild(childrenDiv);
    }
    return wrapper;
}

// ==================== WITHDRAWALS LOGIC ====================

async function loadWithdrawalsHistory() {
    try {
        const res = await fetch(`/api/withdraw/history/${currentUser.walletAddress}`);
        const data = await res.json();
        const tbody = document.getElementById('withdrawalHistoryTableBody');
        if (data.success && data.history && data.history.length > 0) {
            tbody.innerHTML = data.history.map(w => `
                <tr>
                    <td style="font-family: monospace;">${w.id}</td>
                    <td style="font-family: monospace;">${w.walletAddress.slice(0, 10)}...${w.walletAddress.slice(-6)}</td>
                    <td style="font-weight: 700;">${w.amountUsdt.toFixed(2)} USDT</td>
                    <td>${new Date(w.timestamp).toLocaleString()}</td>
                    <td>
                        <span class="badge" style="background: ${w.status === 'PAID' ? '#10b981' : '#ffb703'}; color: black; font-weight: bold; border-radius: 4px; padding: 2px 6px;">
                            ${w.status}
                        </span>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No withdrawal request records found</td></tr>';
        }
    } catch (e) {
        console.warn(e.message);
    }
}

async function handleWithdrawalRequest(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('wdrawAmount').value);
    if (!amount || amount <= 0) return;

    try {
        const res = await fetch('/api/withdraw/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: currentUser.walletAddress, amountUsdt: amount })
        });
        const data = await res.json();
        if (data.success) {
            alert('🎉 Withdrawal request submitted successfully!');
            document.getElementById('wdrawAmount').value = '';
            loadProfileStats();
            loadWithdrawalsHistory();
        } else {
            alert('Failed to request withdrawal: ' + data.error);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function renderEarningsLog(list) {
    const tbody = document.getElementById('earningsTableBody');
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">No earnings records found</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(e => `
        <tr>
            <td><span class="badge" style="background: var(--secondary); color: white; padding: 2px 4px; border-radius:4px; font-weight:bold;">${e.type}</span></td>
            <td style="color: var(--success); font-weight:bold;">+${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</td>
            <td>${new Date(e.timestamp).toLocaleString()}</td>
        </tr>
    `).join('');
}

// ==================== ADMIN OPERATIONS ====================

async function handleUpdateNchPrice(e) {
    e.preventDefault();
    const price = parseFloat(document.getElementById('adminNchPriceInput').value);
    if (!price || price <= 0) return;

    try {
        const res = await fetch('/api/admin/settings/price', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-wallet-address': currentUser ? currentUser.walletAddress : ''
            },
            body: JSON.stringify({ price })
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ NCH exchange rate updated successfully!');
            fetchSystemSettings();
        } else {
            alert('Failed: ' + data.error);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function loadAdminWithdrawals() {
    try {
        const res = await fetch('/api/admin/withdrawals', {
            headers: {
                'x-wallet-address': currentUser ? currentUser.walletAddress : ''
            }
        });
        const data = await res.json();
        const tbody = document.getElementById('adminWithdrawalsTableBody');
        const pends = data.withdrawals?.filter(w => w.status === 'PENDING') || [];

        if (pends.length > 0) {
            tbody.innerHTML = pends.map(w => `
                <tr>
                    <td style="font-family: monospace;">${w.walletAddress.slice(0, 8)}...</td>
                    <td style="font-weight:700;">${w.amountUsdt.toFixed(2)} USDT</td>
                    <td>
                        <button class="btn-primary" onclick="payWithdrawal('${w.id}')" style="padding: 0.25rem 0.5rem; font-size: 0.7rem; margin-right: 0.25rem;">
                            💰 Mark Paid
                        </button>
                        <button class="btn-secondary" onclick="rejectWithdrawal('${w.id}')" style="padding: 0.25rem 0.5rem; font-size: 0.7rem; border-color: rgba(239, 68, 68, 0.5); color: #ef4444;">
                            ❌ Reject
                        </button>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">No pending withdrawals to approve</td></tr>';
        }
    } catch (e) {
        console.warn(e.message);
    }
}

async function payWithdrawal(id) {
    try {
        const res = await fetch('/api/admin/withdrawals/pay', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-wallet-address': currentUser ? currentUser.walletAddress : ''
            },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
            alert('Withdrawal marked as paid!');
            loadAdminWithdrawals();
            loadWithdrawalsHistory();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function rejectWithdrawal(id) {
    if (!confirm('Are you sure you want to reject this withdrawal and refund the user?')) return;
    try {
        const res = await fetch('/api/admin/withdrawals/reject', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-wallet-address': currentUser ? currentUser.walletAddress : ''
            },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
            alert('Withdrawal rejected and user balance refunded!');
            loadAdminWithdrawals();
            loadWithdrawalsHistory();
            loadProfileStats();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function triggerAdminYields() {
    try {
        const res = await fetch('/api/admin/process-yields', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-wallet-address': currentUser ? currentUser.walletAddress : ''
            }
        });
        const data = await res.json();
        if (data.success) {
            alert(`🎉 Yields calculated successfully for ${data.results?.length || 0} nodes.`);
            loadProfileStats();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function triggerAdminMatching() {
    try {
        const res = await fetch('/api/admin/process-matching', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-wallet-address': currentUser ? currentUser.walletAddress : ''
            }
        });
        const data = await res.json();
        if (data.success) {
            alert(`🎉 Pairing bonuses computed successfully! Paid pairing bonuses to ${data.payouts?.length || 0} qualifying wallets.`);
            loadProfileStats();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}
