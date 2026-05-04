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

        // Delegate heavy lifting and CORS-sensitive work to background script
        chrome.runtime.sendMessage({ 
            action: 'START_ANALYSIS', 
            url: url 
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Messaging Error:", chrome.runtime.lastError);
                showError("Extension Service Error. Please reload the extension.");
                return;
            }
        }

            if (response && response.success) {
                showResults(response.data);
            } else {
                console.error("Analysis Error:", response?.error);
                showError(response?.error || "Analysis Failed. Check URL and try again.");
            }
        });
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
