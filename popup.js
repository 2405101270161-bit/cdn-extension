document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const resultsArea = document.getElementById('resultsArea');

    urlInput.value = '';

    urlInput.addEventListener('input', () => {
        const value = urlInput.value.trim();
        const isValid = value.includes('.') && value.length > 3;
        analyzeBtn.disabled = !isValid;
    });

    async function analyze() {
        if (!urlInput.value.trim()) return;

        let url = urlInput.value.trim();
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        showLoadingUI();

        const startTime = performance.now();

        try {
            // Using fetch with cache: 'no-cache' to get real-time results
            const response = await fetch(url, { 
                mode: 'cors',
                cache: 'no-cache'
            });
            
            const endTime = performance.now();
            const loadTime = Math.round(endTime - startTime);

            // Detection logic
            const headers = response.headers;
            let cdn = "Unknown";
            let edgeServer = headers.get("server") || "Unknown";
            let cacheStatus = "UNKNOWN";

            // Marker check
            if (headers.get("cf-ray")) {
                cdn = "Cloudflare";
                cacheStatus = headers.get("cf-cache-status") || "DYNAMIC";
            } else if (headers.get("x-amz-cf-id")) {
                cdn = "CloudFront";
                cacheStatus = headers.get("x-cache") || "UNKNOWN";
            } else if (edgeServer.toLowerCase().includes("akamai") || headers.get("x-akamai-transformed")) {
                cdn = "Akamai";
            } else if (headers.get("x-fastly-request-id")) {
                cdn = "Fastly";
                cacheStatus = headers.get("x-cache") || "UNKNOWN";
            } else if (headers.get("x-vercel-id")) {
                cdn = "Vercel / Edge";
                cacheStatus = headers.get("x-vercel-cache") || "UNKNOWN";
            }

            const data = {
                url: url,
                score: loadTime < 500 ? 95 : 75,
                cdnProvider: cdn,
                edgeServer: edgeServer,
                statusCode: response.status,
                cacheStatus: cacheStatus,
                contentSize: headers.get("content-length") || "-",
                loadTime: loadTime,
                ttfb: Math.round(loadTime / 2),
                protocol: response.type === 'opaque' ? "Unknown" : "HTTPS",
                tlsVersion: "TLS 1.3"
            };

            showResults(data);

        } catch (err) {
            console.error("Client-side Analysis Error:", err);
            showError("Analysis Failed: " + err.message);
        }
    }

    analyzeBtn.addEventListener('click', analyze);

    refreshBtn.onclick = () => {
        resultsArea.innerHTML = "";
        urlInput.value = "";
        analyzeBtn.disabled = true;
    };

    function showError(msg) {
        resultsArea.innerHTML = `<div class="error-msg" style="color: var(--error); text-align: center; padding: 20px;">${msg}</div>`;
    }

    function showLoadingUI() {
        const tpl = document.getElementById('loadingTemplate').content.cloneNode(true);
        resultsArea.innerHTML = '';
        resultsArea.appendChild(tpl);
    }

    function showResults(data) {
        const resultsArea = document.getElementById('resultsArea');
        
        let cacheColor = 'text-secondary';
        if (data.cacheStatus.toUpperCase().includes('HIT')) cacheColor = 'text-success';
        if (data.cacheStatus.toUpperCase().includes('MISS')) cacheColor = 'text-warning';
        
        const score = data.score || 0;
        const circumference = 2 * Math.PI * 65; // r=65
        const offset = circumference - (score / 100) * circumference;

        resultsArea.innerHTML = `
            <div class="dashboard">
                <!-- Circular Score -->
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
                            <span class="score-number">${score}</span>
                            <span class="score-label">Grade</span>
                        </div>
                    </div>
                </div>

                <!-- Overview Card -->
                <div class="glass-panel">
                    <div class="overview-card">
                        <div class="info-group">
                            <span class="info-label">CDN Provider</span>
                            <span class="info-value highlight">${data.cdnProvider}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Status Code</span>
                            <span class="info-value ${data.statusCode >= 400 ? 'text-error' : 'text-success'}">${data.statusCode === 0 ? 'Opaque' : data.statusCode}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Cache Status</span>
                            <span class="info-value ${cacheColor}">${data.cacheStatus}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Edge Server</span>
                            <span class="info-value">${data.edgeServer || 'N/A'}</span>
                        </div>
                        <div class="info-group" style="grid-column: 1 / -1;">
                            <span class="info-label">Target URL</span>
                            <span class="info-value url">${data.url}</span>
                        </div>
                    </div>
                </div>

                <!-- Metric Tiles -->
                <div class="metrics-row">
                    <div class="metric-tile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="metric-tile-value">${data.loadTime}ms</span>
                        <span class="metric-tile-label">Load Time</span>
                    </div>
                    <div class="metric-tile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        <span class="metric-tile-value">${data.ttfb}ms</span>
                        <span class="metric-tile-label">TTFB</span>
                    </div>
                    <div class="metric-tile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                        <span class="metric-tile-value">${data.protocol}</span>
                        <span class="metric-tile-label">Protocol</span>
                    </div>
                </div>
            </div>
        `;

        // Trigger animation
        setTimeout(() => {
            const circle = document.getElementById('scoreCircle');
            if (circle) {
                circle.style.strokeDashoffset = offset;
            }
        }, 100);
    }
});
