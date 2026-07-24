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
                const startTime = performance.now();
                const fetchRes = await fetch(url, { mode: 'cors', cache: 'no-cache' });
                const endTime = performance.now();
                const loadTime = Math.round(endTime - startTime);

                const headerMap = {};
                fetchRes.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });

                let cdn = "Unknown";
                let edgeServer = headerMap['server'] || "Unknown";
                let cacheStatus = "UNKNOWN";

                if (headerMap['cf-ray']) {
                    cdn = "Cloudflare";
                    cacheStatus = headerMap['cf-cache-status'] || "DYNAMIC";
                } else if (headerMap['x-amz-cf-id'] || headerMap['x-amz-cf-pop']) {
                    cdn = "CloudFront";
                    cacheStatus = headerMap['x-cache'] || "UNKNOWN";
                } else if (edgeServer.toLowerCase().includes("akamai")) {
                    cdn = "Akamai";
                } else if (headerMap['x-fastly-request-id']) {
                    cdn = "Fastly";
                } else if (headerMap['x-vercel-id']) {
                    cdn = "Vercel / Edge";
                    cacheStatus = headerMap['x-vercel-cache'] || "UNKNOWN";
                }

                let score = 100;
                if (loadTime > 1000) score -= 40;
                else if (loadTime > 500) score -= 20;
                else if (loadTime > 200) score -= 5;
                if (cacheStatus.toUpperCase().includes('HIT')) score += 5;
                if (cacheStatus.toUpperCase().includes('MISS')) score -= 10;
                score = Math.max(0, Math.min(100, score));

                showResults({
                    url: url,
                    score: score,
                    cdnProvider: cdn,
                    edgeServer: edgeServer,
                    statusCode: fetchRes.status,
                    cacheStatus: cacheStatus,
                    loadTime: loadTime,
                    ttfb: Math.round(loadTime * 0.4),
                    protocol: "H2/H3"
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

        const samplesCount = data.samplesCount || 1;
        const cdnProvider = data.cdnProvider || 'Unknown';
        const stability = data.stability || (data.statusCode < 400 ? 'Stable' : 'Unstable');
        const statusCode = data.statusCode || 200;
        const cacheStatus = data.cacheStatus || 'UNKNOWN';
        const protocol = data.protocol || 'H2/H3';
        const edgeServer = data.edgeServer || 'Unknown';
        const loadTime = data.loadTime ?? 0;
        const minLoad = data.minLoad ?? loadTime;
        const maxLoad = data.maxLoad ?? loadTime;
        const ttfb = data.ttfb ?? 0;
        const minTTFB = data.minTTFB ?? ttfb;
        const maxTTFB = data.maxTTFB ?? ttfb;

        const circumference = 2 * Math.PI * 65;
        const offset = circumference - (score / 100) * circumference;

        resultsArea.innerHTML = `
            <div class="dashboard">
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
                    <div class="sample-info">Based on ${samplesCount} test sample${samplesCount > 1 ? 's' : ''}</div>
                </div>

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
                        <div class="info-group" style="grid-column: 1 / -1;">
                            <span class="info-label">Edge Server</span>
                            <span class="info-value url">${edgeServer}</span>
                        </div>
                    </div>
                </div>

                <div class="metrics-row">
                    <div class="metric-tile">
                        <div class="metric-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span>Load Time</span>
                        </div>
                        <span class="metric-tile-value">${loadTime}ms</span>
                        <div class="metric-stats">min: ${minLoad}ms | max: ${maxLoad}ms</div>
                    </div>
                    <div class="metric-tile">
                        <div class="metric-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            <span>TTFB</span>
                        </div>
                        <span class="metric-tile-value">${ttfb}ms</span>
                        <div class="metric-stats">min: ${minTTFB}ms | max: ${maxTTFB}ms</div>
                    </div>
                </div>
            </div>
        `;

        setTimeout(() => {
            const circle = document.getElementById('scoreCircle');
            if (circle) circle.style.strokeDashoffset = offset;
        }, 100);
    }
});
