/**
 * CDN Analyzer Pro v2 - Resource Analysis Module
 * Analyzes network payload sizes, resource types, largest assets, and slowest requests.
 */

export function analyzeResources(targetUrl, requestsMap) {
    let totalEncodedBytes = 0;
    let requestCount = 0;
    let failedRequestCount = 0;
    let firstPartyCount = 0;
    let thirdPartyCount = 0;

    let targetDomain = "";
    let rootDomain = "";
    try {
        targetDomain = new URL(targetUrl).hostname;
        const parts = targetDomain.split('.');
        rootDomain = parts.length >= 2 ? parts.slice(-2).join('.') : targetDomain;
    } catch (e) {}

    const breakdown = {
        document: { count: 0, bytes: 0 },
        script: { count: 0, bytes: 0 },
        stylesheet: { count: 0, bytes: 0 },
        image: { count: 0, bytes: 0 },
        font: { count: 0, bytes: 0 },
        xhr: { count: 0, bytes: 0 },
        other: { count: 0, bytes: 0 }
    };

    let largestResource = null;
    let largestImage = null;
    let largestJS = null;
    let largestCSS = null;
    let slowestResource = null;

    let maxBytes = 0;
    let maxImageBytes = 0;
    let maxJSBytes = 0;
    let maxCSSBytes = 0;
    let maxDuration = 0;

    for (const [id, req] of requestsMap.entries()) {
        const isHttpUrl = req.url && /^https?:\/\//i.test(req.url);
        if (!isHttpUrl) continue;

        requestCount++;
        const bytes = req.encodedDataLength || 0;
        totalEncodedBytes += bytes;

        if (req.failed) failedRequestCount++;

        // 1st vs 3rd party
        try {
            const reqHostname = new URL(req.url).hostname;
            if (reqHostname === targetDomain || (rootDomain && (reqHostname === rootDomain || reqHostname.endsWith('.' + rootDomain)))) {
                firstPartyCount++;
            } else {
                thirdPartyCount++;
            }
        } catch (e) {
            firstPartyCount++;
        }

        // Duration calculation
        const startTime = req.requestWillBeSentTime || 0;
        const endTime = req.loadingFinishedTime || req.responseReceivedTime || startTime;
        const duration = Math.max(0, endTime - startTime);

        // Resource type categorization
        const type = (req.type || 'Other').toLowerCase();
        let cat = 'other';
        if (type.includes('document')) cat = 'document';
        else if (type.includes('script')) cat = 'script';
        else if (type.includes('style')) cat = 'stylesheet';
        else if (type.includes('image')) cat = 'image';
        else if (type.includes('font')) cat = 'font';
        else if (type.includes('xhr') || type.includes('fetch')) cat = 'xhr';

        breakdown[cat].count++;
        breakdown[cat].bytes += bytes;

        const reqSummary = {
            url: req.url,
            type: req.type || 'Other',
            bytes,
            durationMs: Math.round(duration)
        };

        // Largest Overall
        if (bytes > maxBytes) {
            maxBytes = bytes;
            largestResource = reqSummary;
        }

        // Largest Image
        if (cat === 'image' && bytes > maxImageBytes) {
            maxImageBytes = bytes;
            largestImage = reqSummary;
        }

        // Largest JS
        if (cat === 'script' && bytes > maxJSBytes) {
            maxJSBytes = bytes;
            largestJS = reqSummary;
        }

        // Largest CSS
        if (cat === 'stylesheet' && bytes > maxCSSBytes) {
            maxCSSBytes = bytes;
            largestCSS = reqSummary;
        }

        // Slowest Resource
        if (duration > maxDuration && req.url.startsWith('http')) {
            maxDuration = duration;
            slowestResource = reqSummary;
        }
    }

    return {
        requestCount,
        failedRequestCount,
        encodedBytes: totalEncodedBytes,
        firstPartyCount,
        thirdPartyCount,
        breakdown,
        highlights: {
            largestResource,
            largestImage,
            largestJS,
            largestCSS,
            slowestResource
        }
    };
}
