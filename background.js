let measurements = new Map();

// Helper to extract analysis ID from URL
function getAnalysisId(url) {
    const match = url.match(/cdn_analyzer_id=([^&]+)/);
    return match ? match[1] : null;
}

// webRequest listeners to capture precise timings and raw headers
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        const id = getAnalysisId(details.url);
        if (id) {
            measurements.set(id, {
                startTime: details.timeStamp,
                url: details.url,
                captured: false
            });
        }
    },
    { urls: ["<all_urls>"] }
);

chrome.webRequest.onResponseStarted.addListener(
    (details) => {
        const id = getAnalysisId(details.url);
        const m = measurements.get(id);
        if (m) {
            m.ttfb = Math.round(details.timeStamp - m.startTime);
            m.statusCode = details.statusCode;
            m.protocol = details.protocol || "HTTPS";
            m.headers = details.responseHeaders;
            m.captured = true;
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(
    (details) => {
        const id = getAnalysisId(details.url);
        const m = measurements.get(id);
        if (m) {
            m.loadTime = Math.round(details.timeStamp - m.startTime);
        }
    },
    { urls: ["<all_urls>"] }
);

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_SAMPLE_DATA") {
        const data = measurements.get(request.id);
        if (data && data.captured && data.loadTime) {
            sendResponse({ success: true, data });
        } else {
            sendResponse({ success: false });
        }
        return true;
    }
});

// Periodic cleanup of old measurements
setInterval(() => {
    const now = Date.now();
    for (const [id, m] of measurements.entries()) {
        if (now - m.startTime > 60000) { // 1 min TTL
            measurements.delete(id);
        }
    }
}, 30000);
