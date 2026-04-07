document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-btn');
    const urlInput = document.getElementById('urlInput');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resultsDiv = document.getElementById('results');

    // 1. INPUT FIELD BEHAVIOR FIX
    urlInput.value = '';

    const validateInput = () => {
        const value = urlInput.value.trim();
        const isValid = value.includes('.') && value.length > 3;
        
        analyzeBtn.disabled = !isValid;
        if (isValid) {
            analyzeBtn.style.opacity = '1';
            analyzeBtn.style.cursor = 'pointer';
        } else {
            analyzeBtn.style.opacity = '0.5';
            analyzeBtn.style.cursor = 'not-allowed';
        }
    };

    urlInput.addEventListener('input', validateInput);
    
    analyzeBtn.addEventListener('click', () => {
        const cleanUrl = urlInput.value
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '');
            
        // Show results
        resultsDiv.style.display = 'block';

        // Mock/Reset initial state before actual analysis completes
        updateUI({
            cdnProvider: 'Analyzing...',
            cacheStatus: 'UNKNOWN',
            avgLoadTime: 0,
            totalRequests: 0,
            errors: 0
        });

        // Normally, you would trigger the background worker or fetch data here
        // using the sanitized `cleanUrl`.
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (!analyzeBtn.disabled) {
                analyzeBtn.click();
            }
        });
    }
});

function updateUI(data) {
    if (!data) return;

    // Elements
    const elProvider = document.getElementById('cdn-provider');
    const elCache = document.getElementById('cache-status');
    const elLoadTime = document.getElementById('load-time');
    const elRequests = document.getElementById('total-requests');
    const elErrors = document.getElementById('errors');
    const elSummary = document.getElementById('summary-text');
    const errorBox = document.querySelector('.error-box');

    // Update Text
    elProvider.textContent = data.cdnProvider || 'None Found';
    elRequests.textContent = data.totalRequests || 0;
    elLoadTime.textContent = `${data.avgLoadTime || 0} ms`;
    elErrors.textContent = data.errors || 0;

    // Cache badge styling
    elCache.textContent = data.cacheStatus || 'UNKNOWN';
    elCache.className = 'value badge'; // reset
    if (data.cacheStatus === 'HIT') elCache.classList.add('hit');
    else if (data.cacheStatus === 'MISS') elCache.classList.add('miss');
    else elCache.classList.add('unknown');

    // Highlight Errors visually
    if (data.errors > 0) {
        errorBox.classList.add('has-errors');
        elErrors.classList.add('text-error-active');
    } else {
        errorBox.classList.remove('has-errors');
        elErrors.classList.remove('text-error-active');
    }

    // Update Summary text
    if (data.totalRequests > 0) {
        let errText = '';
        if (data.errors > 0) {
            errText = ` Encountered ${data.errors} failed requests.`;
        } else {
            errText = ' All requests succeeded.';
        }
        
        let cdnText = 'No known CDNs detected.';
        if (data.cdnProvider && data.cdnProvider !== 'Unknown') {
            cdnText = `Content mostly served by ${data.cdnProvider}.`;
        }

        elSummary.textContent = `Analyzed ${data.totalRequests} requests. ${cdnText}${errText}`;
    } else {
        elSummary.textContent = 'No network activity tracked yet. Try reloading the page.';
    }
}
