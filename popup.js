document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.addEventListener('click', fetchData);

    fetchData();

    // Auto-refresh periodically if popup stays open
    const interval = setInterval(fetchData, 1500);

    // Clean up
    window.addEventListener('unload', () => clearInterval(interval));
});

function fetchData() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;
        const key = `tab_${tabId}`;
        
        chrome.storage.local.get(key, (res) => {
            const data = res[key];
            updateUI(data);
        });
    });
}

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
