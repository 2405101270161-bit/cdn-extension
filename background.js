chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze') {
        analyzeUrl(request.url).then(data => {
            sendResponse({ data: data });
        }).catch(err => {
            sendResponse({ error: err.message || "Request failed" });
        });
        return true; // Keep message channel open for async response
    }
});

async function analyzeUrl(url) {
    const startTime = performance.now();
    
    // We use a GET request here because sometimes HEAD doesn't trigger cache the same way,
    // but we can abort it if we only want headers. To keep it simple and accurate for size,
    // we'll fetch the whole thing since it's an active load test.
    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            cache: 'no-store' // don't use browser local cache to get true network hit/miss
        });
    } catch(err) {
        throw new Error("Network error or CORS blocked. Is the URL correct?");
    }

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    const headers = response.headers;
    
    // Extract required data
    const status = response.status;
    const domain = new URL(url).hostname;
    
    // Read headers
    const serverValue = headers.get('server') || '';
    const viaValue = headers.get('via') || '';
    const cfRay = headers.get('cf-ray');
    const amzCfId = headers.get('x-amz-cf-id');
    const cacheHit = headers.get('x-cache') || headers.get('cf-cache-status') || headers.get('x-edge-result');
    const contentLength = headers.get('content-length');

    // Detect CDN
    let cdn = 'Unknown';
    if (cfRay || serverValue.toLowerCase().includes('cloudflare')) {
        cdn = 'Cloudflare';
    } else if (amzCfId || serverValue.toLowerCase().includes('cloudfront') || viaValue.toLowerCase().includes('cloudfront')) {
        cdn = 'AWS CloudFront';
    } else if (serverValue.toLowerCase().includes('akamai') || viaValue.toLowerCase().includes('akamai')) {
        cdn = 'Akamai';
    } else if (serverValue.toLowerCase().includes('fastly') || viaValue.toLowerCase().includes('fastly')) {
        cdn = 'Fastly';
    } else if (headers.get('x-azure-ref')) {
        cdn = 'Azure Front Door';
    } else if (headers.get('x-edgeconnect-proxied')) {
         cdn = 'Edgecast';
    } else if (serverValue) {
        // Fallback to server name if it's somewhat known
        cdn = `Server: ${serverValue.split(' ')[0]}`;
    }

    // Cache parsing
    let cacheStatus = 'UNKNOWN';
    if (cacheHit) {
        const lower = cacheHit.toLowerCase();
        if (lower.includes('hit')) cacheStatus = 'HIT';
        else if (lower.includes('miss')) cacheStatus = 'MISS';
        else cacheStatus = cacheHit.toUpperCase();
    }

    // Edge Server Info
    let edgeServer = serverValue;
    if (cfRay) edgeServer = `CF-Ray: ${cfRay.split('-')[1] || cfRay}`;
    if (amzCfId) edgeServer = `Amz-Id: ${amzCfId.substring(0, 10)}...`;

    // Calculate Score (0-100)
    // < 500ms = 90-100
    // 500 - 1500ms = 70-89
    // > 1500ms = < 70
    let score = 100;
    if (duration < 500) {
        score = 100 - Math.floor((duration / 500) * 10); // 90-100
    } else if (duration < 1500) {
        score = 89 - Math.floor(((duration - 500) / 1000) * 19); // 70-89
    } else if (duration <= 3000) {
        score = 69 - Math.floor(((duration - 1500) / 1500) * 19); // 50-69
    } else {
        score = Math.max(0, 49 - Math.floor((duration - 3000) / 100)); // < 50
    }

    // Penalty for bad status code
    if (status >= 400) {
        score = Math.max(0, score - 30);
    }

    return {
        domain: domain,
        cdn: cdn,
        server: edgeServer || 'Unknown',
        status: status,
        cache: cacheStatus,
        size: contentLength ? parseInt(contentLength, 10) : null,
        time: duration,
        score: score
    };
}
