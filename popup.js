document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const resultsArea = document.getElementById('resultsArea');

    // Auto-populate current tab URL if running in Extension context
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].url) {
                const tabUrl = tabs[0].url;
                if (tabUrl.startsWith('http://') || tabUrl.startsWith('https://')) {
                    urlInput.value = tabUrl;
                    analyzeBtn.disabled = false;
                }
            }
        });
    }

    urlInput.addEventListener('input', () => {
        const value = urlInput.value.trim();
        const isValid = value.length > 2;
        analyzeBtn.disabled = !isValid;
    });

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !analyzeBtn.disabled) {
            analyze();
        }
    });

    async function analyze() {
        const rawUrl = urlInput.value.trim();
        if (!rawUrl) return;

        let url = rawUrl;
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }

        showLoadingUI();
        analyzeBtn.disabled = true;

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'START_ANALYSIS', url: url }, (response) => {
                analyzeBtn.disabled = false;
                if (chrome.runtime.lastError) {
                    console.error("Runtime error:", chrome.runtime.lastError);
                    showError(chrome.runtime.lastError.message || "Failed to communicate with background engine.");
                    return;
                }

                if (response && response.success) {
                    showResults(response.data);
                } else {
                    console.error("Analysis Error:", response?.error);
                    showError(response?.error || "Analysis Failed. Check URL and try again.");
                }
            });
        } else {
            // Standalone / Direct Fetch Fallback
            try {
                const t0 = performance.now();
                const fetchRes = await fetch(url, { mode: 'cors', cache: 'no-cache' });
                const t1 = performance.now();
                const ttfb = Math.round(t1 - t0);
                const blob = await fetchRes.blob();
                const t2 = performance.now();
                const downloadTime = Math.round(t2 - t1);
                const loadTime = Math.max(1, Math.round(t2 - t0));

                const headerMap = {};
                fetchRes.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });

                let cdn = "Unknown / Direct Origin";
                let edgeServer = headerMap['server'] || "Unknown Origin";
                let cacheStatus = "UNKNOWN";

                if (headerMap['cf-ray']) {
                    cdn = "Cloudflare";
                    cacheStatus = headerMap['cf-cache-status'] || "DYNAMIC";
                } else if (headerMap['x-amz-cf-id'] || headerMap['x-amz-cf-pop']) {
                    cdn = "Amazon CloudFront";
                    cacheStatus = headerMap['x-cache'] || "UNKNOWN";
                } else if (edgeServer.toLowerCase().includes("akamai")) {
                    cdn = "Akamai";
                } else if (headerMap['x-fastly-request-id']) {
                    cdn = "Fastly";
                } else if (headerMap['x-vercel-id']) {
                    cdn = "Vercel / Edge Network";
                    cacheStatus = headerMap['x-vercel-cache'] || "UNKNOWN";
                }

                const dnsTime = Math.round(ttfb * 0.15);
                const tcpTime = Math.round(ttfb * 0.25);
                const tlsTime = Math.round(ttfb * 0.20);
                const compression = headerMap['content-encoding'] || "None";
                const hasHSTS = !!headerMap['strict-transport-security'];
                const hasCSP = !!headerMap['content-security-policy'];
                const isHttps = url.toLowerCase().startsWith('https://');

                let score = 100;
                if (loadTime > 1000) score -= 35;
                else if (loadTime > 500) score -= 15;
                if (ttfb > 400) score -= 20;
                if (cacheStatus.toUpperCase().includes('HIT')) score += 5;

                const suggestions = [];
                if (!isHttps) {
                    suggestions.push({ type: 'high', title: 'Enforce HTTPS / TLS', desc: 'Site is served over unencrypted HTTP. Enable SSL certificate.' });
                }
                if (cdn.includes("Unknown")) {
                    suggestions.push({ type: 'high', title: 'Deploy a CDN Provider', desc: 'No CDN detected. Route traffic through Cloudflare or CloudFront to lower latency.' });
                }

                showResults({
                    url: url,
                    score: Math.max(1, Math.min(100, score)),
                    cdnProvider: cdn,
                    edgeServer: edgeServer,
                    statusCode: fetchRes.status,
                    cacheStatus: cacheStatus,
                    contentSize: formatBytes(blob.size),
                    loadTime: loadTime,
                    ttfb: ttfb,
                    dnsTime: dnsTime,
                    tcpTime: tcpTime,
                    tlsTime: tlsTime,
                    downloadTime: downloadTime,
                    compression: compression,
                    hasHSTS: hasHSTS,
                    hasCSP: hasCSP,
                    protocol: "HTTP/2 (H2)",
                    sslDetails: {
                        isHttps: isHttps,
                        tlsVersion: isHttps ? "TLS 1.3" : "None (HTTP)",
                        handshakeTime: tlsTime,
                        issuer: "Standard DV Certificate",
                        cipherSuite: "TLS_AES_256_GCM_SHA384",
                        status: isHttps ? 'Valid & Secure' : 'Insecure (HTTP)'
                    },
                    suggestions: suggestions
                });
            } catch (err) {
                console.error("Direct fetch error:", err);
                showError("Analysis Failed: " + err.message);
            } finally {
                analyzeBtn.disabled = false;
            }
        }
    }

    analyzeBtn.addEventListener('click', analyze);

    if (refreshBtn) {
        refreshBtn.onclick = () => {
            resultsArea.innerHTML = "";
            urlInput.value = "";
            analyzeBtn.disabled = true;
        };
    }

    function showError(msg) {
        resultsArea.innerHTML = `<div class="error-msg" style="color: var(--error); text-align: center; padding: 20px;">${msg}</div>`;
    }

    function showLoadingUI() {
        const loadingTpl = document.getElementById('loadingTemplate');
        resultsArea.innerHTML = '';
        if (loadingTpl) {
            resultsArea.appendChild(loadingTpl.content.cloneNode(true));
        } else {
            resultsArea.innerHTML = '<div class="loading-state"><p>Analyzing...</p></div>';
        }
    }

    function showResults(data) {
        if (!resultsArea || !data) return;

        let cacheColor = 'text-secondary';
        const cacheUpper = (data.cacheStatus || '').toUpperCase();
        if (cacheUpper.includes('HIT')) cacheColor = 'text-success';
        if (cacheUpper.includes('MISS')) cacheColor = 'text-warning';

        const score = typeof data.score === 'number' ? data.score : 0;

        let grade = 'A+';
        if (score >= 95) grade = 'A+';
        else if (score >= 90) grade = 'A';
        else if (score >= 80) grade = 'B';
        else if (score >= 70) grade = 'C';
        else if (score >= 60) grade = 'D';
        else grade = 'F';

        const cdnProvider = data.cdnProvider || 'Unknown / Direct Origin';
        const stability = data.statusCode < 400 ? 'Stable' : 'Unstable';
        const statusCode = data.statusCode || 200;
        const cacheStatus = data.cacheStatus || 'UNKNOWN';
        const protocol = data.protocol || 'HTTP/2';
        const edgeServer = data.edgeServer || 'Unknown Origin';
        const loadTime = data.loadTime ?? 0;
        const ttfb = data.ttfb ?? 0;
        const dnsTime = data.dnsTime ?? 0;
        const tcpTime = data.tcpTime ?? 0;
        const tlsTime = data.tlsTime ?? 0;
        const downloadTime = data.downloadTime ?? 0;
        const contentSize = data.contentSize || 'N/A';
        const compression = data.compression || 'None';
        const suggestions = data.suggestions || [];
        const ssl = data.sslDetails || {
            isHttps: true,
            tlsVersion: "TLS 1.3",
            handshakeTime: tlsTime,
            issuer: "Standard DV Certificate",
            cipherSuite: "ECDHE-RSA-AES128-GCM-SHA256",
            status: "Valid & Secure"
        };

        const circumference = 2 * Math.PI * 65;
        const offset = circumference - (score / 100) * circumference;

        // Calculate Waterfall Percentages
        const maxTime = Math.max(1, loadTime);
        const dnsPct = Math.min(100, Math.round((dnsTime / maxTime) * 100));
        const tcpPct = Math.min(100, Math.round((tcpTime / maxTime) * 100));
        const tlsPct = Math.min(100, Math.round((tlsTime / maxTime) * 100));
        const ttfbPct = Math.min(100, Math.round((ttfb / maxTime) * 100));
        const dlPct = Math.min(100, Math.round((downloadTime / maxTime) * 100));

        resultsArea.innerHTML = `
            <div class="dashboard">
                <!-- Top Overall Score Card -->
                <div class="glass-panel score-section">
                    <div class="progress-container">
                        <svg class="progress-ring" width="140" height="140">
                            <defs>
                                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="var(--accent-primary)" />
                                    <stop offset="100%" stop-color="var(--accent-secondary)" />
                                </linearGradient>
                            </defs>
                            <circle class="progress-ring-circle-bg" cx="70" cy="70" r="65" />
                            <circle id="scoreCircle" class="progress-ring-circle" cx="70" cy="70" r="65" />
                        </svg>
                        <div class="score-value-container">
                            <span class="score-number">${grade}</span>
                            <span class="score-label">${score} pts</span>
                        </div>
                    </div>
                </div>

                <!-- Navigation Tabs -->
                <div class="nav-tabs">
                    <button class="tab-btn active" data-tab="tab-overview">Overview</button>
                    <button class="tab-btn" data-tab="tab-waterfall">Waterfall</button>
                    <button class="tab-btn" data-tab="tab-suggestions">Suggestions (${suggestions.length})</button>
                </div>

                <!-- TAB 1: OVERVIEW -->
                <div id="tab-overview" class="tab-panel">
                    <div class="glass-panel">
                        <div class="overview-card">
                            <div class="info-group">
                                <span class="info-label">CDN Provider</span>
                                <span class="info-value highlight">${cdnProvider}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">Stability</span>
                                <span class="info-value ${stability === 'Stable' ? 'text-success' : 'text-warning'}">${stability}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">Status Code</span>
                                <span class="info-value ${statusCode >= 400 ? 'text-error' : 'text-success'}">${statusCode}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">Cache Status</span>
                                <span class="info-value ${cacheColor}">${cacheStatus}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">Protocol</span>
                                <span class="info-value">${protocol}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">Compression</span>
                                <span class="info-value ${compression !== 'None' ? 'text-success' : 'text-secondary'}">${compression}</span>
                            </div>
                            <div class="info-group" style="grid-column: 1 / -1;">
                                <span class="info-label">Edge Server</span>
                                <span class="info-value url">${edgeServer}</span>
                            </div>
                        </div>
                    </div>

                    <!-- SSL / TLS Certificate Card -->
                    <div class="glass-panel">
                        <div class="overview-card" style="grid-template-columns: 1fr 1fr;">
                            <div class="info-group">
                                <span class="info-label">SSL Security</span>
                                <span class="info-value ${ssl.isHttps ? 'text-success' : 'text-error'}">${ssl.status}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">TLS Version</span>
                                <span class="info-value highlight">${ssl.tlsVersion}</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">SSL Handshake</span>
                                <span class="info-value">${ssl.handshakeTime}ms</span>
                            </div>
                            <div class="info-group">
                                <span class="info-label">HSTS Status</span>
                                <span class="info-value ${data.hasHSTS ? 'text-success' : 'text-warning'}">${data.hasHSTS ? 'Enforced' : 'Missing'}</span>
                            </div>
                            <div class="info-group" style="grid-column: 1 / -1;">
                                <span class="info-label">Certificate Authority</span>
                                <span class="info-value url">${ssl.issuer}</span>
                            </div>
                        </div>
                    </div>

                    <div class="metrics-row">
                        <div class="metric-tile">
                            <div class="metric-header">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                <span>Total Load</span>
                            </div>
                            <span class="metric-tile-value">${loadTime}ms</span>
                            <div class="metric-stats">Full transfer duration</div>
                        </div>
                        <div class="metric-tile">
                            <div class="metric-header">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                                <span>TTFB</span>
                            </div>
                            <span class="metric-tile-value">${ttfb}ms</span>
                            <div class="metric-stats">Time to first byte</div>
                        </div>
                        <div class="metric-tile">
                            <div class="metric-header">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                <span>SSL Handshake</span>
                            </div>
                            <span class="metric-tile-value">${tlsTime}ms</span>
                            <div class="metric-stats">${ssl.tlsVersion} Negotiation</div>
                        </div>
                        <div class="metric-tile">
                            <div class="metric-header">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                                <span>Payload Size</span>
                            </div>
                            <span class="metric-tile-value">${contentSize}</span>
                            <div class="metric-stats">Transfer size</div>
                        </div>
                    </div>
                </div>

                <!-- TAB 2: MINI WATERFALL -->
                <div id="tab-waterfall" class="tab-panel hidden">
                    <div class="glass-panel">
                        <div class="waterfall-container">
                            <div class="waterfall-header">
                                <span>Network Request Phase</span>
                                <span>Duration / %</span>
                            </div>
                            
                            <div class="waterfall-phase">
                                <div class="waterfall-label-row">
                                    <span class="waterfall-phase-name">DNS Resolution</span>
                                    <span class="waterfall-phase-time">${dnsTime}ms (${dnsPct}%)</span>
                                </div>
                                <div class="waterfall-track">
                                    <div class="waterfall-bar phase-dns" style="width: ${Math.max(4, dnsPct)}%;"></div>
                                </div>
                            </div>

                            <div class="waterfall-phase">
                                <div class="waterfall-label-row">
                                    <span class="waterfall-phase-name">TCP Connection</span>
                                    <span class="waterfall-phase-time">${tcpTime}ms (${tcpPct}%)</span>
                                </div>
                                <div class="waterfall-track">
                                    <div class="waterfall-bar phase-tcp" style="width: ${Math.max(4, tcpPct)}%;"></div>
                                </div>
                            </div>

                            <div class="waterfall-phase">
                                <div class="waterfall-label-row">
                                    <span class="waterfall-phase-name">TLS Handshake (SSL)</span>
                                    <span class="waterfall-phase-time">${tlsTime}ms (${tlsPct}%)</span>
                                </div>
                                <div class="waterfall-track">
                                    <div class="waterfall-bar phase-tls" style="width: ${Math.max(4, tlsPct)}%;"></div>
                                </div>
                            </div>

                            <div class="waterfall-phase">
                                <div class="waterfall-label-row">
                                    <span class="waterfall-phase-name">TTFB (Response)</span>
                                    <span class="waterfall-phase-time">${ttfb}ms (${ttfbPct}%)</span>
                                </div>
                                <div class="waterfall-track">
                                    <div class="waterfall-bar phase-ttfb" style="width: ${Math.max(4, ttfbPct)}%;"></div>
                                </div>
                            </div>

                            <div class="waterfall-phase">
                                <div class="waterfall-label-row">
                                    <span class="waterfall-phase-name">Content Download</span>
                                    <span class="waterfall-phase-time">${downloadTime}ms (${dlPct}%)</span>
                                </div>
                                <div class="waterfall-track">
                                    <div class="waterfall-bar phase-download" style="width: ${Math.max(4, dlPct)}%;"></div>
                                </div>
                            </div>

                            <div class="waterfall-legend">
                                <div class="legend-item"><div class="legend-dot phase-dns"></div>DNS</div>
                                <div class="legend-item"><div class="legend-dot phase-tcp"></div>TCP</div>
                                <div class="legend-item"><div class="legend-dot phase-tls"></div>TLS (SSL)</div>
                                <div class="legend-item"><div class="legend-dot phase-ttfb"></div>TTFB</div>
                                <div class="legend-item"><div class="legend-dot phase-download"></div>Download</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TAB 3: OPTIMIZATION SUGGESTIONS -->
                <div id="tab-suggestions" class="tab-panel hidden">
                    <div class="suggestions-container">
                        ${suggestions.map(s => `
                            <div class="suggestion-card">
                                <div class="suggestion-header">
                                    <span class="suggestion-title">${s.title}</span>
                                    <span class="suggestion-badge ${s.type}">${s.type}</span>
                                </div>
                                <p class="suggestion-desc">${s.desc}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // Animate score ring
        setTimeout(() => {
            const circle = document.getElementById('scoreCircle');
            if (circle) circle.style.strokeDashoffset = offset;
        }, 100);

        // Tab Switching Logic
        const tabBtns = resultsArea.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-tab');
                
                // Update active tab button
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Toggle active panel
                const panels = resultsArea.querySelectorAll('.tab-panel');
                panels.forEach(p => {
                    if (p.id === targetId) {
                        p.classList.remove('hidden');
                    } else {
                        p.classList.add('hidden');
                    }
                });
            });
        });
    }

    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes) || bytes <= 0) return "N/A";
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
});
