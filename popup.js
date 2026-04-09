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
        let errBadgeClass = data.statusCode >= 400 || data.statusCode === 0 ? 'has-errors' : '';
        let errTextClass = data.statusCode >= 400 || data.statusCode === 0 ? 'text-error-active' : 'text-error';
        let errorsCount = data.statusCode >= 400 || data.statusCode === 0 ? 1 : 0;
        
        let cacheClass = 'unknown';https://github.com/2405101270161-bit/cdn-extension/pull/6/conflict?name=background.js&ancestor_oid=37889d538abc192c64dc539a06840a2f29f8dc8d&base_oid=a95e6535686c5b875b1cae4b171583bb357bb221&head_oid=5ca0a9948b36dc0b9eacaeaf924b9a8313333a93
        if (data.cacheStatus.toUpperCase().includes('HIT')) cacheClass = 'hit';
        if (data.cacheStatus.toUpperCase().includes('MISS')) cacheClass = 'miss';
        
        let cdnText = data.cdnProvider !== 'Unknown' 
            ? `Content appears to be served by ${data.cdnProvider}.` 
            : `No known CDN headers detected directly due to browser CORS policies.`;

        resultsArea.innerHTML = `
            <div class="card provider-card">
                <span class="label">Primary CDN Provider</span>
                <h2 id="cdn-provider" class="value text-gradient">${data.cdnProvider}</h2>
            </div>

            <div class="metrics-grid">
                <div class="metric-box">
                    <span class="label">Cache Status</span>
                    <span id="cache-status" class="value badge ${cacheClass}">${data.cacheStatus}</span>
                </div>
                <div class="metric-box">
                    <span class="label">Load Time</span>
                    <span id="load-time" class="value">${data.loadTime} ms</span>
                </div>
                <div class="metric-box">
                    <span class="label">Status</span>
                    <span id="total-requests" class="value">${data.statusCode === 0 ? 'Opaque' : data.statusCode}</span>
                </div>
                <div class="metric-box error-box ${errBadgeClass}">
                    <span class="label">Errors</span>
                    <span id="errors" class="value ${errTextClass}">${errorsCount}</span>
                </div>
            </div>
            
            <div class="summary-section">
                <h3>Request Summary</h3>
                <p id="summary-text">Analyzed 1 request for ${data.url}. Response took ${data.loadTime}ms. ${cdnText}</p>
            </div>
        `;
    }
});
