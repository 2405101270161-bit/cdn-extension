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
        const loadingText = document.querySelector('.loading-state p');

        const samples = 5;
        const results = [];
        
        for (let i = 0; i < samples; i++) {
            if (loadingText) loadingText.textContent = `Analyzing sample ${i + 1}/${samples}...`;
            
            const analysisId = `id_${Date.now()}_${i}`;
            const targetUrl = url + (url.includes('?') ? '&' : '?') + `cdn_analyzer_id=${analysisId}`;

            try {
                // Trigger the request (mode: 'no-cors' for maximum compatibility)
                await fetch(targetUrl, { mode: 'no-cors', cache: 'no-cache' });

                // Poll background for metrics (retry up to 10 times, every 100ms)
                let sampleData = null;
                for (let retry = 0; retry < 10; retry++) {
                    await new Promise(r => setTimeout(r, 150));
                    const response = await chrome.runtime.sendMessage({
                        type: "GET_SAMPLE_DATA",
                        id: analysisId
                    });
                    
                    if (response.success) {
                        sampleData = response.data;
                        break;
                    }
                }

                if (sampleData) {
                    results.push(sampleData);
                    console.log(`Sample ${i+1} captured:`, sampleData);
                } else {
                    console.warn(`Sample ${i+1} metrics not captured by background.`);
                }
            } catch (err) {
                console.error(`Sample ${i+1} fetch failed:`, err);
            }
        }

        if (results.length === 0) {
            showError("Failed to gather network metrics. Please check the URL and your connection.");
            return;
        }

        processResults(url, results);
    }

    function processResults(url, results) {
        // Aggregate statistics
        const ttfbs = results.map(r => r.ttfb);
        const loadTimes = results.map(r => r.loadTime);
        const avgTTFB = Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length);
        const avgLoadTime = Math.round(loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length);
        
        const firstSuccess = results[0];
        const headers = firstSuccess.headers || [];
        const serverHeader = headers.find(h => h.name.toLowerCase() === 'server')?.value || 'Unknown';
        
        // Accurate detection logic
        const cdnProvider = getCDNProvider(headers, serverHeader);
        const cacheStatus = getCacheStatus(headers);
        
        // Scoring
        const ttfbScore = avgTTFB < 100 ? 100 : (avgTTFB < 300 ? 80 : (avgTTFB < 600 ? 60 : 40));
        const loadScore = avgLoadTime < 1000 ? 100 : (avgLoadTime < 2000 ? 80 : (avgLoadTime < 3000 ? 60 : 40));
        const finalScore = Math.round((ttfbScore * 0.4) + (loadScore * 0.6));
        
        // Std Dev / Stability
        const stdDev = Math.sqrt(loadTimes.map(x => Math.pow(x - avgLoadTime, 2)).reduce((a, b) => a + b, 0) / loadTimes.length);

        showResults({
            url: url,
            score: finalScore,
            cdnProvider,
            edgeServer: serverHeader,
            statusCode: firstSuccess.statusCode,
            cacheStatus,
            loadTime: avgLoadTime,
            ttfb: avgTTFB,
            minTTFB: Math.min(...ttfbs),
            maxTTFB: Math.max(...ttfbs),
            minLoad: Math.min(...loadTimes),
            maxLoad: Math.max(...loadTimes),
            protocol: firstSuccess.protocol,
            samplesCount: results.length,
            stability: stdDev < (avgLoadTime * 0.2) ? "Stable" : "Unstable"
        });
    }

    function getCDNProvider(headers, edgeServer) {
        const headerMap = {};
        headers.forEach(h => { headerMap[h.name.toLowerCase()] = h.value; });

        if (headerMap['cf-ray'] || (edgeServer && edgeServer.includes('cloudflare'))) return "Cloudflare";
        if (headerMap['x-amz-cf-id'] || (headerMap['via'] && headerMap['via'].includes('CloudFront')) || (edgeServer && edgeServer.includes('AmazonS3'))) return "AWS CloudFront";
        if (headerMap['x-akamai-transformed'] || (edgeServer && edgeServer.includes('Akamai')) || (headerMap['via'] && headerMap['via'].includes('Akamai'))) return "Akamai";
        if (headerMap['x-fastly-request-id'] || (headerMap['via'] && headerMap['via'].includes('Fastly'))) return "Fastly";
        if (headerMap['x-vercel-id']) return "Vercel / Edge";
        if (edgeServer && (edgeServer.includes('GSE') || edgeServer.includes('Google'))) return "Google Cloud";
        if (headerMap['x-edge-location']) return "EdgeCast / Verizon";
        return "Unknown";
    }

    function getCacheStatus(headers) {
        const headerMap = {};
        headers.forEach(h => { headerMap[h.name.toLowerCase()] = h.value; });
        const res = headerMap['cf-cache-status'] || headerMap['x-cache'] || headerMap['x-vercel-cache'] || 'UNKNOWN';
        if (res.toUpperCase().includes('HIT')) return 'HIT';
        if (res.toUpperCase().includes('MISS')) return 'MISS';
        return res.toUpperCase();
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
        if (data.cacheStatus === 'HIT') cacheColor = 'text-success';
        if (data.cacheStatus === 'MISS') cacheColor = 'text-warning';
        
        const score = data.score || 0;
        let grade = "D";
        if (score >= 90) grade = "A";
        else if (score >= 75) grade = "B";
        else if (score >= 60) grade = "C";

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
                    <div class="sample-info">Based on ${data.samplesCount} test samples</div>
                </div>

                <div class="glass-panel">
                    <div class="overview-card">
                        <div class="info-group">
                            <span class="info-label">CDN Provider</span>
                            <span class="info-value highlight">${data.cdnProvider}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Stability</span>
                            <span class="info-value ${data.stability === 'Stable' ? 'text-success' : 'text-warning'}">${data.stability}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Status Code</span>
                            <span class="info-value ${data.statusCode >= 400 ? 'text-error' : 'text-success'}">${data.statusCode}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Cache Status</span>
                            <span class="info-value ${cacheColor}">${data.cacheStatus}</span>
                        </div>
                        <div class="info-group">
                            <span class="info-label">Protocol</span>
                            <span class="info-value">${data.protocol}</span>
                        </div>
                        <div class="info-group" style="grid-column: 1 / -1;">
                            <span class="info-label">Edge Server</span>
                            <span class="info-value url">${data.edgeServer}</span>
                        </div>
                    </div>
                </div>

                <div class="metrics-row">
                    <div class="metric-tile">
                        <div class="metric-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span>Load Time</span>
                        </div>
                        <span class="metric-tile-value">${data.loadTime}ms</span>
                        <div class="metric-stats">min: ${data.minLoad}ms | max: ${data.maxLoad}ms</div>
                    </div>
                    <div class="metric-tile">
                        <div class="metric-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            <span>TTFB</span>
                        </div>
                        <span class="metric-tile-value">${data.ttfb}ms</span>
                        <div class="metric-stats">min: ${data.minTTFB}ms | max: ${data.maxTTFB}ms</div>
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
