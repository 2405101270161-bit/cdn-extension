document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyze-btn');
    const loadTestBtn = document.getElementById('load-test-btn');
    const urlInput = document.getElementById('target-url');
    const chips = document.querySelectorAll('.chip');
    
    // UI Elements
    const errorMsg = document.getElementById('error-message');
    const loadingState = document.getElementById('loading-state');
    const dashboard = document.getElementById('results-dashboard');

    // Quick link chips
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            urlInput.value = chip.dataset.url;
            analyzeUrl();
        });
    });

    analyzeBtn.addEventListener('click', analyzeUrl);

    // Optional Load Test functionality (UI only)
    loadTestBtn.addEventListener('click', () => {
        analyzeUrl(); // For now just reuse analyze
    });

    // Handle enter key in input
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            analyzeUrl();
        }
    });

    function showLoading() {
        errorMsg.classList.add('hidden');
        dashboard.classList.add('hidden');
        loadingState.classList.remove('hidden');
    }

    function showError(msg) {
        loadingState.classList.add('hidden');
        dashboard.classList.add('hidden');
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
    }

    function showDashboard() {
        loadingState.classList.add('hidden');
        errorMsg.classList.add('hidden');
        dashboard.classList.remove('hidden');
    }

    function analyzeUrl() {
        let url = urlInput.value.trim();
        
        if (!url) {
            showError("Please enter a valid URL");
            return;
        }

        // Auto prepend https if missing
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
            urlInput.value = url;
        }

        try {
            new URL(url);
        } catch(e) {
            showError("Invalid URL format");
            return;
        }

        showLoading();

        // Send to background service worker
        chrome.runtime.sendMessage({ action: 'analyze', url: url }, (response) => {
            if (chrome.runtime.lastError) {
                showError("Extension error: " + chrome.runtime.lastError.message);
                return;
            }

            if (!response) {
                showError("Unknown error occurred");
                return;
            }

            if (response.error) {
                showError("Failed to analyze: " + response.error);
                return;
            }

            updateDashboard(response.data);
            showDashboard();
        });
    }

    function updateDashboard(data) {
        // Score logic
        const circle = document.getElementById('score-circle');
        const scoreNum = document.getElementById('score-number');
        const scoreGrade = document.getElementById('score-grade');
        
        let score = data.score;
        scoreNum.textContent = score;

        // Calculate progress circle offset (314 is full circumference)
        const offset = 314 - (score / 100) * 314;
        
        // Timeout to allow transition to trigger
        setTimeout(() => {
            circle.style.strokeDashoffset = offset;
        }, 50);

        // Score colors
        let color = 'var(--success)';
        if (score >= 90) {
            color = 'var(--success)';
            scoreGrade.textContent = "A Excellent";
            scoreGrade.style.color = color;
        } else if (score >= 70) {
            color = 'var(--accent-secondary)'; // Blue
            scoreGrade.textContent = "B Good";
            scoreGrade.style.color = color;
            circle.style.stroke = color;
        } else if (score >= 50) {
            color = 'var(--warning)';
            scoreGrade.textContent = "C Average";
            scoreGrade.style.color = color;
            circle.style.stroke = color;
        } else {
            color = 'var(--error)';
            scoreGrade.textContent = "Poor";
            scoreGrade.style.color = color;
            circle.style.stroke = color;
        }

        // Overview metrics
        document.getElementById('res-website').textContent = data.domain || '-';
        document.getElementById('res-website').title = data.domain || '';
        
        document.getElementById('res-cdn').textContent = data.cdn || 'Unknown';
        
        document.getElementById('res-server').textContent = data.server || 'N/A';
        document.getElementById('res-server').title = data.server || '';
        
        document.getElementById('res-status').textContent = data.status || '-';
        
        // Cache Badge
        const cacheEl = document.getElementById('res-cache');
        cacheEl.textContent = data.cache || 'UNKNOWN';
        cacheEl.className = 'metric-value badge';
        if (data.cache === 'HIT') cacheEl.classList.add('hit');
        else if (data.cache === 'MISS') cacheEl.classList.add('miss');
        else cacheEl.classList.add('unknown');

        // Size
        let sizeText = '-';
        if (data.size) {
            let kb = data.size / 1024;
            if (kb > 1024) {
                sizeText = (kb / 1024).toFixed(2) + ' MB';
            } else {
                sizeText = kb.toFixed(1) + ' KB';
            }
        }
        document.getElementById('res-size').textContent = sizeText;

        // Load Time
        document.getElementById('res-time').textContent = data.time ? `${data.time} ms` : '-';
    }
});
