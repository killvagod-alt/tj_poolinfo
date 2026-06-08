// Global variables to store data & chart instances
let currentData = null;
let depthChartInstance = null;

// DOM Elements
const queryForm = document.getElementById('queryForm');
const submitBtn = document.getElementById('submitBtn');
const loadingPanel = document.getElementById('loadingPanel');
const errorPanel = document.getElementById('errorPanel');
const errorMessage = document.getElementById('errorMessage');
const resultsSection = document.getElementById('resultsSection');

// Form inputs
const poolSelect = document.getElementById('poolSelect');
const customPoolContainer = document.getElementById('customPoolContainer');
const poolAddressInput = document.getElementById('poolAddress');
const minPriceInput = document.getElementById('minPrice');
const maxPriceInput = document.getElementById('maxPrice');
const rpcUrlInput = document.getElementById('rpcUrl');

// Helper to update chain UI
function updateChainUI(chain, rpc) {
    // Update RPC input value
    if (rpcUrlInput && rpc) {
        rpcUrlInput.value = rpc;
        // Update label text
        const rpcLabel = document.getElementById('rpcUrlLabel');
        if (rpcLabel) {
            rpcLabel.innerText = `${chain} RPC 節點 URL`;
        }
    }
    
    // Update network badge in header
    const networkBadge = document.getElementById('networkBadge');
    const networkBadgeText = document.getElementById('networkBadgeText');
    const networkBadgeDot = document.getElementById('networkBadgeDot');
    
    if (networkBadge && networkBadgeText && networkBadgeDot) {
        networkBadgeText.innerText = chain;
        if (chain === 'Monad') {
            networkBadge.className = "px-3 py-1 rounded-full text-xs font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center gap-1.5";
            networkBadgeDot.className = "w-2 h-2 rounded-full bg-purple-500 animate-ping";
        } else {
            networkBadge.className = "px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-1.5";
            networkBadgeDot.className = "w-2 h-2 rounded-full bg-red-500 animate-ping";
        }
    }
}

// Helper to get active chain name
function getCurrentChainName() {
    if (poolSelect.value !== 'custom') {
        const selectedOpt = poolSelect.options[poolSelect.selectedIndex];
        return selectedOpt.getAttribute('data-chain') || '區塊鏈';
    }
    const rpc = rpcUrlInput.value.toLowerCase();
    if (rpc.includes('monad')) return 'Monad';
    if (rpc.includes('avax') || rpc.includes('avalanche')) return 'Avalanche';
    return '區塊鏈';
}

// Pool Selection Change listener
if (poolSelect && customPoolContainer) {
    poolSelect.addEventListener('change', () => {
        if (poolSelect.value === 'custom') {
            customPoolContainer.classList.remove('hidden');
            poolAddressInput.value = '';
            poolAddressInput.focus();
        } else {
            customPoolContainer.classList.add('hidden');
            poolAddressInput.value = poolSelect.value;
            const selectedOpt = poolSelect.options[poolSelect.selectedIndex];
            const chain = selectedOpt.getAttribute('data-chain');
            const rpc = selectedOpt.getAttribute('data-rpc');
            updateChainUI(chain, rpc);
        }
    });
    // Set initial value
    poolAddressInput.value = poolSelect.value;
    const selectedOpt = poolSelect.options[poolSelect.selectedIndex];
    if (selectedOpt && selectedOpt.value !== 'custom') {
        const chain = selectedOpt.getAttribute('data-chain');
        const rpc = selectedOpt.getAttribute('data-rpc');
        updateChainUI(chain, rpc);
    }
}

// Quick fills
function fillExample(address, min, max, chain, rpc) {
    if (poolSelect && customPoolContainer) {
        poolSelect.value = 'custom';
        customPoolContainer.classList.remove('hidden');
    }
    poolAddressInput.value = address;
    minPriceInput.value = min;
    maxPriceInput.value = max;
    if (chain && rpc) {
        updateChainUI(chain, rpc);
    }
    // Scroll smoothly to form
    queryForm.scrollIntoView({ behavior: 'smooth' });
}

// Format numbers nicely
function formatNumber(num, decimals = 4) {
    if (num === 0) return "0";
    if (num < 0.00001) return num.toExponential(4);
    
    // Adjust decimals based on size
    let dec = decimals;
    if (num > 1000) dec = 2;
    if (num > 100000) dec = 0;
    
    return num.toLocaleString('zh-TW', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec
    });
}

// Event Listeners
queryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // UI states
    const chainName = getCurrentChainName();
    const loadingText = document.getElementById('loadingText');
    if (loadingText) {
        loadingText.innerText = `正在從 ${chainName} 節點獲取數據...`;
    }
    
    loadingPanel.classList.remove('hidden');
    errorPanel.classList.add('hidden');
    resultsSection.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> 正在查詢中...';

    const pool = poolAddressInput.value.trim();
    const minPrice = parseFloat(minPriceInput.value);
    const maxPrice = parseFloat(maxPriceInput.value);
    const rpc = rpcUrlInput.value.trim();

    try {
        const url = `/api/pool_info?pool_address=${encodeURIComponent(pool)}&min_price=${minPrice}&max_price=${maxPrice}&rpc_url=${encodeURIComponent(rpc)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || '讀取資料時發生未知錯誤');
        }

        currentData = data;
        renderDashboard(data);
    } catch (err) {
        console.error(err);
        errorMessage.innerText = err.message || '連線錯誤，請重試。';
        errorPanel.classList.remove('hidden');
        resultsSection.classList.add('hidden');
    } finally {
        loadingPanel.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> 載入流動性與 Reserves 數據';
    }
});

// Render the dashboard data
function renderDashboard(data) {
    resultsSection.classList.remove('hidden');

    // 1. Fill basic metadata
    const symX = data.tokenX.symbol;
    const symY = data.tokenY.symbol;
    document.getElementById('pairSymbols').innerText = `${symX} / ${symY}`;
    document.getElementById('tokenXSymbol').innerText = symX;
    document.getElementById('tokenYSymbol').innerText = symY;

    document.getElementById('activePriceVal').innerText = formatNumber(data.pool.activePrice, 6);
    document.getElementById('activeBinId').innerText = data.pool.activeId;

    const binStep = data.pool.binStep;
    document.getElementById('binStepVal').innerText = binStep;
    document.getElementById('binStepPct').innerText = `即每 Bin 價格差 ${(binStep / 100).toFixed(2)}%`;

    document.getElementById('queryBinCount').innerText = data.queryRange.numBins;
    document.getElementById('binIdRange').innerText = `${data.queryRange.binIdMin} - ${data.queryRange.binIdMax}`;

    // 2. Fill Reserves Overview
    document.getElementById('totalReserveXVal').innerText = formatNumber(data.reserves.totalX, 4);
    document.getElementById('totalReserveXSymbol').innerText = symX;
    document.getElementById('tokenXDetails').innerText = `名稱: ${data.tokenX.name} (${data.tokenX.decimals} Decimals)`;

    document.getElementById('totalReserveYVal').innerText = formatNumber(data.reserves.totalY, 4);
    document.getElementById('totalReserveYSymbol').innerText = symY;
    document.getElementById('tokenYDetails').innerText = `名稱: ${data.tokenY.name} (${data.tokenY.decimals} Decimals)`;

    // Update table headers
    document.getElementById('tableThX').innerText = `${symX} 數量 (Reserves X)`;
    document.getElementById('tableThY').innerText = `${symY} 數量 (Reserves Y)`;
    document.getElementById('tableThVal').innerText = `總價值 (${symY})`;

    // 3. Render Table
    renderTable();

    // 4. Render Chart
    renderChart(data);

    // Auto-scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Table filter checkbox and renderer
const hideEmptyBinsCheckbox = document.getElementById('hideEmptyBins');
hideEmptyBinsCheckbox.addEventListener('change', () => {
    if (currentData) renderTable();
});

function renderTable() {
    if (!currentData) return;
    
    const tbody = document.getElementById('binsTableBody');
    tbody.innerHTML = '';
    
    const hideEmpty = hideEmptyBinsCheckbox.checked;
    let visibleCount = 0;
    
    currentData.bins.forEach(bin => {
        const isEmpty = bin.reserveX === 0 && bin.reserveY === 0;
        if (hideEmpty && isEmpty) return;
        
        visibleCount++;
        const tr = document.createElement('tr');
        if (bin.isActive) {
            tr.className = 'active-bin-row border-b border-borderColor/40';
        } else {
            tr.className = 'border-b border-borderColor/40 hover:bg-darkCard/30';
        }
        
        const totalValY = (bin.reserveX * bin.price) + bin.reserveY;
        
        tr.innerHTML = `
            <td class="py-3 px-6 font-mono text-xs text-textSecondary">${bin.binId}</td>
            <td class="py-3 px-6 font-mono text-sm">${formatNumber(bin.price, 6)}</td>
            <td class="py-3 px-6 text-right font-mono text-sm ${bin.reserveX > 0 ? 'text-accentBlue' : 'text-textSecondary'}">
                ${formatNumber(bin.reserveX, 4)}
            </td>
            <td class="py-3 px-6 text-right font-mono text-sm ${bin.reserveY > 0 ? 'text-accentPurple' : 'text-textSecondary'}">
                ${formatNumber(bin.reserveY, 4)}
            </td>
            <td class="py-3 px-6 text-right font-mono text-sm ${totalValY > 0 ? 'text-green-400 font-semibold' : 'text-textSecondary'}">
                ${formatNumber(totalValY, 4)}
            </td>
            <td class="py-3 px-6 text-center">
                ${bin.isActive ? 
                    `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-accentPurple/20 text-accentPurple border border-accentPurple/30">
                        <i class="fa-solid fa-circle-dot text-[8px] mr-1 animate-pulse"></i>Active Bin
                    </span>` : 
                    (isEmpty ? '<span class="text-textSecondary/40 text-xs">-</span>' : '<span class="px-2 py-0.5 rounded text-[10px] bg-borderColor text-textSecondary">Liquidity</span>')
                }
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    document.getElementById('tableRowCount').innerText = visibleCount;
}

// Chart.js Drawing Function
function renderChart(data) {
    const ctx = document.getElementById('depthChart').getContext('2d');
    
    // Destroy existing chart if it exists
    if (depthChartInstance) {
        depthChartInstance.destroy();
    }
    
    const labels = data.bins.map(b => b.price.toFixed(5));
    const dataX = data.bins.map(b => b.reserveX);
    const dataY = data.bins.map(b => b.reserveY);
    
    // Create glowing gradients for the chart bars
    const gradX = ctx.createLinearGradient(0, 0, 0, 300);
    gradX.addColorStop(0, 'rgba(32, 150, 243, 0.85)');
    gradX.addColorStop(1, 'rgba(32, 150, 243, 0.1)');
    
    const gradY = ctx.createLinearGradient(0, 0, 0, 300);
    gradY.addColorStop(0, 'rgba(112, 72, 232, 0.85)');
    gradY.addColorStop(1, 'rgba(112, 72, 232, 0.1)');

    const symX = data.tokenX.symbol;
    const symY = data.tokenY.symbol;

    depthChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `${symX} Reserves (X)`,
                    data: dataX,
                    backgroundColor: gradX,
                    borderColor: 'rgba(32, 150, 243, 1)',
                    borderWidth: 1,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                    borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 }
                },
                {
                    label: `${symY} Reserves (Y)`,
                    data: dataY,
                    backgroundColor: gradY,
                    borderColor: 'rgba(112, 72, 232, 1)',
                    borderWidth: 1,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                    borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 }
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#d1d4dc',
                        font: {
                            family: 'Outfit',
                            size: 11
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 18, 28, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#d1d4dc',
                    borderColor: '#242a35',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: {
                        family: 'JetBrains Mono',
                        size: 12
                    },
                    bodyFont: {
                        family: 'Outfit',
                        size: 12
                    },
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            const bin = data.bins[index];
                            return `Bin ID: ${bin.binId} (價格: ${bin.price.toFixed(6)})`;
                        },
                        label: function(context) {
                            const datasetLabel = context.dataset.label;
                            const value = context.raw;
                            return ` ${datasetLabel}: ${value.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}`;
                        },
                        afterBody: function(context) {
                            const index = context[0].dataIndex;
                            const bin = data.bins[index];
                            if (bin.isActive) {
                                return '\n★ 目前活躍交易價格點 (Active Bin)';
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(36, 42, 53, 0.3)',
                    },
                    ticks: {
                        color: '#8a939f',
                        font: {
                            family: 'JetBrains Mono',
                            size: 9
                        },
                        maxRotation: 45,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 25
                    }
                },
                y: {
                    stacked: false,
                    grid: {
                        color: 'rgba(36, 42, 53, 0.3)',
                    },
                    ticks: {
                        color: '#8a939f',
                        font: {
                            family: 'Outfit',
                            size: 10
                        }
                    }
                }
            }
        }
    });
}
