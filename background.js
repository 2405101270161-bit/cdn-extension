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
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch(e) {
        throw new Error("Invalid URL");
    }

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
        throw new Error("CORS blocked or site unreachable");
    }

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    const headers = response.headers;
    
    // Extract required data
    const status = response.status;
    const domain = parsedUrl.hostname;
    const protocol = parsedUrl.protocol;
    
    // Read headers safely
    const serverValue = headers.get('server') || 'Unknown';
    const viaValue = headers.get('via') || '';
    const cfRay = headers.get('cf-ray');
    const amzCfId = headers.get('x-amz-cf-id');
    const xServedBy = headers.get('x-served-by');
    const xAzureRef = headers.get('x-azure-ref');
    const cacheHit = headers.get('x-cache') || headers.get('cf-cache-status') || headers.get('x-edge-result');
    const contentLength = headers.get('content-length');

    // Detect CDN safely
    let cdn = 'Unknown';
    const serverLower = serverValue.toLowerCase();
    const viaLower = viaValue.toLowerCase();

    if (cfRay || serverLower.includes('cloudflare')) {
        cdn = 'Cloudflare';
    } else if (amzCfId || serverLower.includes('cloudfront') || viaLower.includes('cloudfront')) {
        cdn = 'AWS CloudFront';
    } else if (serverLower.includes('akamai') || viaLower.includes('akamai')) {
        cdn = 'Akamai';
    } else if (xServedBy || serverLower.includes('fastly') || viaLower.includes('fastly')) {
        cdn = 'Fastly';
    } else if (xAzureRef) {
        cdn = 'Azure Front Door';
    } else if (headers.get('x-edgeconnect-proxied')) {
         cdn = 'Edgecast';
    } else if (serverValue !== 'Unknown') {
        // Fallback to server name if it's somewhat known
        cdn = `Server: ${serverValue.split(' ')[0]}`;
    }

    // Cache parsing
    let cacheStatus = 'UNKNOWN';
    if (cacheHit) {
        const lower = cacheHit.toLowerCase();
        if (lower.includes('hit')) cacheStatus = 'HIT';
        else if (lower.includes('miss')) cacheStatus = 'MISS';
        else cacheStatus = 'UNKNOWN';
    }

    // Edge Server Info Cleanup
    let edgeServer = serverValue !== 'Unknown' ? serverValue : 'Unknown';
    if (cfRay) {
        edgeServer = `CF-Ray: ${cfRay.split('-')[1] || cfRay}`;
    } else if (amzCfId) {
        edgeServer = `Amz-Id: ${amzCfId.substring(0, 10)}`;
    }

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
    
    score = Math.max(0, Math.min(100, score));
    
    let contentSize = null;
    if (contentLength) {
        contentSize = parseInt(contentLength, 10);
        if (isNaN(contentSize)) contentSize = null;
    }

    return {
        protocol: protocol,
        domain: domain,
        cdn: cdn,
        server: edgeServer,
        status: status,
        cache: cacheStatus,
        size: contentSize,
        time: duration,
        score: score
    };
}
