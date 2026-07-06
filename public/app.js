/**
 * NCH Sovereign Network Dashboard Client Logic
 */

let currentWallet = '0x0e6ec6713e7b5b7c11d969da848813d08223598e'; // Default demo wallet
let selectedLeg = 'L';
let selectedActivationLeg = 'L'; // Leg choice inside the activation card

document.addEventListener('DOMContentLoaded', () => {
    // Auto-check for ref code in URL
    checkURLParams();
    // Auto-load stats for default wallet
    loadWalletData(currentWallet);
});

// Check URL query params for ?ref=CHEESE-XXXX&leg=L
async function checkURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    const leg = urlParams.get('leg');

    if (ref) {
        console.log(`🎁 Referral detected from URL: ${ref}`);
        localStorage.setItem('pendingRefCode', ref);
        
        // Show banner showing loading status
        const banner = document.getElementById('referralBanner');
        const bannerText = document.getElementById('referralBannerText');
        banner.classList.remove('hidden');
        bannerText.textContent = `Resolving sponsor invitation for code: ${ref}...`;

        // If it is a full hex address, use it directly
        if (/^0x[a-fA-F0-9]{40}$/.test(ref)) {
            const normalizedRef = ref.toLowerCase();
            localStorage.setItem('pendingSponsorAddress', normalizedRef);
            bannerText.textContent = `Sponsor invitation detected: Node ${normalizedRef.slice(0, 6)}...${normalizedRef.slice(-4)}`;
        } else {
            // Resolve short code via API
            try {
                const res = await fetch(`/api/mlm/resolve-ref/${ref}`);
                const data = await res.json();
                if (data.success && data.walletAddress) {
                    localStorage.setItem('pendingSponsorAddress', data.walletAddress);
                    bannerText.textContent = `Sponsor invitation detected: Node ${data.walletAddress.slice(0, 6)}...${data.walletAddress.slice(-4)}`;
                } else {
                    bannerText.textContent = `⚠️ Invitation code "${ref}" could not be resolved. Joining under Genesis.`;
                    localStorage.removeItem('pendingSponsorAddress');
                }
            } catch (e) {
                console.warn('Failed to resolve referral code:', e.message);
                bannerText.textContent = `⚠️ Error resolving invitation. Joining under Genesis.`;
            }
        }
    }
    
    if (leg && (leg.toUpperCase() === 'R' || leg.toUpperCase() === 'L')) {
        const uppercaseLeg = leg.toUpperCase();
        localStorage.setItem('pendingLeg', uppercaseLeg);
        selectLeg(uppercaseLeg);
        selectActivationLeg(uppercaseLeg);
    }
}

// Connect Web3 / MetaMask Wallet or Prompt Demo Address
async function connectWallet() {
    if (window.ethereum) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            if (accounts && accounts.length > 0) {
                currentWallet = accounts[0].toLowerCase();
                console.log(`⚡ Connected Web3 Wallet: ${currentWallet}`);
                loadWalletData(currentWallet);
                return;
            }
        } catch (e) {
            console.warn('MetaMask connect error:', e.message);
        }
    }

    const inputAddr = prompt('Enter NCH Wallet Address to View Sovereign Dashboard:', currentWallet);
    if (inputAddr) {
        currentWallet = inputAddr.trim().toLowerCase();
        loadWalletData(currentWallet);
    }
}

// Select Leg Preference for Referral Link Generator
function selectLeg(leg) {
    selectedLeg = leg === 'R' ? 'R' : 'L';
    document.getElementById('legBtnL').classList.toggle('active', selectedLeg === 'L');
    document.getElementById('legBtnR').classList.toggle('active', selectedLeg === 'R');
    updateShareLinks();
}

// Select Leg Preference inside Node Activation form
function selectActivationLeg(leg) {
    selectedActivationLeg = leg === 'R' ? 'R' : 'L';
    document.getElementById('activationLegL').classList.toggle('active', selectedActivationLeg === 'L');
    document.getElementById('activationLegR').classList.toggle('active', selectedActivationLeg === 'R');
}

// Load Wallet Stats & Tree Structure
async function loadWalletData(address) {
    if (!address) return;

    // Update Wallet Display
    document.getElementById('activeAddress').textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;

    try {
        // 1. Fetch Stats
        const statsRes = await fetch(`/api/mlm/stats/${address}`);
        
        if (statsRes.status === 404) {
            console.warn('Wallet not registered in Sovereign Network, prompting activation...');
            showActivationView(address);
            return;
        }

        const statsData = await statsRes.json();

        if (statsData.success && statsData.stats) {
            // Hide activation card, show main dashboard sections
            document.getElementById('activationSection').classList.add('hidden');
            document.querySelector('.stats-grid').classList.remove('hidden');
            document.querySelector('.workspace-grid').classList.remove('hidden');
            document.querySelector('.glass-card.full-width').classList.remove('hidden');

            const s = statsData.stats;
            document.getElementById('leftVol').textContent = `${s.leftVolume.toLocaleString()} NCH`;
            document.getElementById('leftCarry').textContent = `Carryover: ${s.leftCarryover.toLocaleString()} NCH`;

            document.getElementById('rightVol').textContent = `${s.rightVolume.toLocaleString()} NCH`;
            document.getElementById('rightCarry').textContent = `Carryover: ${s.rightCarryover.toLocaleString()} NCH`;

            document.getElementById('totalEarned').textContent = `${s.totalEarned.toLocaleString()} NCH`;
            document.getElementById('directCount').textContent = s.directReferralCount || 0;
            document.getElementById('activeRank').textContent = s.rank || 'Member';

            // Populate Commission Table
            renderCommissions(s.recentCommissions || []);
        }

        // 2. Fetch Tree
        await refreshTree();
        updateShareLinks();
    } catch (error) {
        console.error('❌ Failed to load wallet data:', error.message);
    }
}

// Show Node Activation view for unregistered addresses
function showActivationView(address) {
    // Hide main dashboard grids
    document.querySelector('.stats-grid').classList.add('hidden');
    document.querySelector('.workspace-grid').classList.add('hidden');
    document.querySelector('.glass-card.full-width').classList.add('hidden');

    // Show activation card
    const actSection = document.getElementById('activationSection');
    actSection.classList.remove('hidden');

    document.getElementById('activationYourAddress').value = address;

    // Prefill sponsor
    const pendingSponsor = localStorage.getItem('pendingSponsorAddress');
    // If we have a pending sponsor, use it; otherwise default to Genesis address
    document.getElementById('activationSponsorInput').value = pendingSponsor || '0x0e6ec6713e7b5b7c11d969da848813d08223598e';

    // Prefill leg
    const pendingLeg = localStorage.getItem('pendingLeg') || 'L';
    selectActivationLeg(pendingLeg);
}

// Action called when user clicks "Activate Node & Join Network"
async function activateSovereignNode() {
    const yourAddress = document.getElementById('activationYourAddress').value.trim().toLowerCase();
    const sponsorInput = document.getElementById('activationSponsorInput').value.trim();
    const targetLeg = selectedActivationLeg;

    if (!yourAddress || yourAddress === 'not connected') {
        alert('Please connect your wallet first.');
        return;
    }

    try {
        let finalSponsor = sponsorInput;
        
        // Resolve code if it's not a full address
        if (sponsorInput && !/^0x[a-fA-F0-9]{40}$/.test(sponsorInput)) {
            const res = await fetch(`/api/mlm/resolve-ref/${sponsorInput}`);
            const data = await res.json();
            if (data.success && data.walletAddress) {
                finalSponsor = data.walletAddress;
            } else {
                alert(`❌ Could not resolve sponsor code "${sponsorInput}". Please double check it.`);
                return;
            }
        }

        const regRes = await fetch('/api/mlm/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: yourAddress,
                sponsorAddress: finalSponsor || null,
                preferredLeg: targetLeg
            })
        });
        const regData = await regRes.json();

        if (regData.success) {
            alert(`🎉 Sovereign Node Activated Successfully! Placement: ${regData.placementType}`);
            
            // Clear pending invitation from local storage
            localStorage.removeItem('pendingRefCode');
            localStorage.removeItem('pendingSponsorAddress');
            localStorage.removeItem('pendingLeg');
            
            // Hide referral banner
            document.getElementById('referralBanner').classList.add('hidden');

            // Reload statistics
            loadWalletData(yourAddress);
        } else {
            alert(`❌ Activation failed: ${regData.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}


// Update Referral Links
function updateShareLinks() {
    const code = `CHEESE-${currentWallet.slice(2, 10).toUpperCase()}`;
    document.getElementById('refCodeInput').value = code;

    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?ref=${code}&leg=${selectedLeg}`;
    document.getElementById('shareLinkInput').value = shareUrl;
}

// Copy Ref Code
function copyRefCode() {
    const val = document.getElementById('refCodeInput').value;
    navigator.clipboard.writeText(val);
    alert(`✅ Referral Code ${val} copied to clipboard!`);
}

// Copy Share Link
function copyShareLink() {
    const val = document.getElementById('shareLinkInput').value;
    navigator.clipboard.writeText(val);
    alert(`✅ Share Link copied to clipboard!`);
}

// Refresh Interactive Tree
async function refreshTree() {
    const container = document.getElementById('treeContainer');
    try {
        const res = await fetch(`/api/mlm/tree/${currentWallet}?depth=3`);
        const data = await res.json();

        if (data.success && data.tree) {
            container.innerHTML = '';
            container.appendChild(buildTreeDOM(data.tree));
        } else {
            container.innerHTML = `<div class="tree-placeholder">No tree structure found for this wallet.</div>`;
        }
    } catch (e) {
        console.error('Tree fetch failed:', e.message);
        container.innerHTML = `<div class="tree-placeholder">Failed to load tree structure.</div>`;
    }
}

// Build Visual Tree DOM
function buildTreeDOM(treeNode) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-wrapper';

    // Root Node Box
    const nodeBox = document.createElement('div');
    nodeBox.className = 'node-box';
    nodeBox.innerHTML = `
        <div class="node-address">${treeNode.walletAddress.slice(0, 6)}...${treeNode.walletAddress.slice(-4)}</div>
        <div class="node-vol">L: ${treeNode.leftCarryover.toLocaleString()} | R: ${treeNode.rightCarryover.toLocaleString()}</div>
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
            leftBranch.innerHTML += `<div class="node-box" style="opacity:0.4; border-style:dashed;">Open Slot</div>`;
        }
        childrenDiv.appendChild(leftBranch);

        // Right Branch
        const rightBranch = document.createElement('div');
        rightBranch.className = 'tree-branch';
        rightBranch.innerHTML = `<span class="branch-label">RIGHT (R)</span>`;
        if (treeNode.rightChild) {
            rightBranch.appendChild(buildTreeDOM(treeNode.rightChild));
        } else {
            rightBranch.innerHTML += `<div class="node-box" style="opacity:0.4; border-style:dashed;">Open Slot</div>`;
        }
        childrenDiv.appendChild(rightBranch);

        wrapper.appendChild(childrenDiv);
    }

    return wrapper;
}

// Register Member Action
async function registerMember() {
    const newAddr = document.getElementById('newMemberAddress').value.trim();
    if (!newAddr) {
        alert('Please enter a valid wallet address to register');
        return;
    }

    try {
        const res = await fetch('/api/mlm/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: newAddr,
                sponsorAddress: currentWallet,
                preferredLeg: selectedLeg
            })
        });
        const data = await res.json();

        if (data.success) {
            alert(`🎉 Member Registered successfully! Placement: ${data.placementType}`);
            document.getElementById('newMemberAddress').value = '';
            loadWalletData(currentWallet);
        } else {
            alert(`❌ Registration failed: ${data.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

// Add Volume Action
async function addVolume() {
    const amount = parseFloat(document.getElementById('volumeAmountInput').value) || 0;
    if (amount <= 0) return;

    try {
        const res = await fetch('/api/mlm/volume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: currentWallet,
                amount: amount
            })
        });
        const data = await res.json();

        if (data.success) {
            alert(`📈 Added ${amount} BV volume! Bubbled up ${data.bubbledLevels} upline levels.`);
            loadWalletData(currentWallet);
        } else {
            alert(`❌ Volume addition failed: ${data.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

// Trigger Matching Payout
async function triggerMatching() {
    try {
        const res = await fetch('/api/mlm/process-matching', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: currentWallet })
        });
        const data = await res.json();

        if (data.success && data.result) {
            const r = data.result;
            if (r.paid > 0) {
                alert(`💰 Success! Paid ${r.paid} NCH matching bonus on ${r.weakLegVolume} weak leg volume!`);
            } else {
                alert(`ℹ️ Calculation done: ${r.reason || 'No weak leg matching volume to pay'}`);
            }
            loadWalletData(currentWallet);
        } else {
            alert(`❌ Matching calculation failed`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

// Render Commissions Table
function renderCommissions(list) {
    const tbody = document.getElementById('commissionTableBody');
    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No commission records found</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(c => `
        <tr>
            <td style="font-family:monospace;">${c.id}</td>
            <td><span class="wallet-rank-badge">${c.type}</span></td>
            <td>${(c.weakLegVolume || 0).toLocaleString()} NCH</td>
            <td style="color:var(--success); font-weight:700;">+${c.amount.toLocaleString()} NCH</td>
            <td>${new Date(c.timestamp).toLocaleString()}</td>
            <td><span style="color:var(--success);">✅ ${c.status}</span></td>
        </tr>
    `).join('');
}
