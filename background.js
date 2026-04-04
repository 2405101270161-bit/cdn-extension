// Start times for current requests to calculate response timing
let requestStartTimes = {};

// Clean up state when a tab is closed or updated
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.remove(`tab_${tabId}`);
});

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Reset tab data for new page load
        if (details.type === 'main_frame' && details.tabId !== -1) {
            const initData = {
                cdnProvider: 'Unknown',
                cacheStatus: 'UNKNOWN',
                totalLoadTime: 0,
                loadTimesCount: 0,
                avgLoadTime: 0,
                totalRequests: 0,
                errors: 0,
                providers: {}
            };
            const dataObj = {};
            dataObj[`tab_${details.tabId}`] = initData;
            chrome.storage.local.set(dataObj);
        }
        requestStartTimes[details.requestId] = details.timeStamp;
    },
    { urls: ["<all_urls>"] }
);

// Capture headers, CDN info, and end time
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        const tabId = details.tabId;
        if (tabId === -1) return; // ignore background requests

        let duration = 0;
        if (requestStartTimes[details.requestId]) {
            duration = details.timeStamp - requestStartTimes[details.requestId];
            delete requestStartTimes[details.requestId];
        }

        // Analyze headers
        let cdn = 'Unknown';
        let cache = 'UNKNOWN';
        
        if (details.responseHeaders) {
            for (let header of details.responseHeaders) {
                const name = header.name.toLowerCase();
                const value = header.value.toLowerCase();
                
                // CDN Detection
                if (name === 'server') {
                    if (value.includes('cloudflare')) cdn = 'Cloudflare';
                    else if (value.includes('akamai')) cdn = 'Akamai';
                    else if (value.includes('fastly')) cdn = 'Fastly';
                    else if (value.includes('cloudfront')) cdn = 'Amazon CloudFront';
                }
                if (name === 'x-amz-cf-id' || name === 'x-amz-cf-pop') cdn = 'Amazon CloudFront';
                if (name === 'cf-ray') cdn = 'Cloudflare';
                if (name === 'via') {
                    if (value.includes('cloudfront')) cdn = 'Amazon CloudFront';
                    else if (value.includes('akamai')) cdn = 'Akamai';
                    else if (value.includes('fastly')) cdn = 'Fastly';
                    else if (cdn === 'Unknown') cdn = `Via: ${header.value}`; // Generic fallback
                }

                // Cache Status Detection
                if (name === 'x-cache' || name === 'cf-cache-status' || name === 'x-edge-result') {
                    if (value.includes('hit')) cache = 'HIT';
                    else if (value.includes('miss')) cache = 'MISS';
                    else cache = value.toUpperCase();
                }
            }
        }

        // Use chrome.storage.local to update info
        const key = `tab_${tabId}`;
        chrome.storage.local.get(key, (res) => {
            let data = res[key] || {
                cdnProvider: 'Unknown',
                cacheStatus: 'UNKNOWN',
                totalLoadTime: 0,
                loadTimesCount: 0,
                avgLoadTime: 0,
                totalRequests: 0,
                errors: 0,
                providers: {}
            };

            data.totalRequests++;
            if (duration > 0) {
                data.totalLoadTime += duration;
                data.loadTimesCount++;
                data.avgLoadTime = Math.round(data.totalLoadTime / data.loadTimesCount);
            }

            if (cdn !== 'Unknown') {
                data.providers[cdn] = (data.providers[cdn] || 0) + 1;
                // Primary CDN is the one with most requests
                data.cdnProvider = Object.keys(data.providers).reduce((a, b) => data.providers[a] > data.providers[b] ? a : b);
            }

            // Keep best cache status we find or default to the last interesting one
            if (data.cacheStatus === 'UNKNOWN' || cache === 'HIT' || cache === 'MISS') {
                 if (cache !== 'UNKNOWN') data.cacheStatus = cache;
            }
            if (data.cacheStatus !== 'HIT' && cache === 'HIT') {
                data.cacheStatus = 'HIT';
            } else if (data.cacheStatus === 'UNKNOWN' && cache === 'MISS') {
                data.cacheStatus = 'MISS';
            }

            console.log(`[Request] CDN: ${cdn}, Cache: ${cache}, Duration: ${duration.toFixed(2)}ms`);

            let updateObj = {};
            updateObj[key] = data;
            chrome.storage.local.set(updateObj);
        });
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders", "extraHeaders"]
);

// Capture errors
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        const tabId = details.tabId;
        if (tabId === -1) return;

        console.error(`[Request Error] ${details.url}`, details.error);

        delete requestStartTimes[details.requestId];

        const key = `tab_${tabId}`;
        chrome.storage.local.get(key, (res) => {
            if (res[key]) {
                res[key].errors++;
                let updateObj = {};
                updateObj[key] = res[key];
                chrome.storage.local.set(updateObj);
            }
        });
    },
    { urls: ["<all_urls>"] }
);
