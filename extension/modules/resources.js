const MULTI_PART_SUFFIXES = new Set([

    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'sch.uk',

    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',

    'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz', 'school.nz',

    'co.jp', 'ne.jp', 'ac.jp', 'go.jp', 'or.jp', 'ed.jp', 'ad.jp',

    'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br',

    'com.sg', 'edu.sg', 'gov.sg', 'net.sg', 'org.sg', 'per.sg',

    'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za', 'web.za',

    'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'edu.in', 'res.in', 'gov.in',

    'com.mx', 'org.mx', 'edu.mx', 'gob.mx', 'net.mx',

    'com.tr', 'edu.tr', 'gov.tr', 'org.tr', 'net.tr', 'bbs.tr',

    'com.hk', 'edu.hk', 'gov.hk', 'net.hk', 'org.hk', 'idv.hk',

    'com.tw', 'org.tw', 'gov.tw', 'edu.tw', 'net.tw', 'idv.tw',

    'co.kr', 'ne.kr', 're.kr', 'go.kr', 'pe.kr', 'or.kr',

    'com.ar', 'gov.ar', 'org.ar',
    'com.co', 'gov.co', 'org.co',
    'com.pe', 'gob.pe', 'org.pe',
    'com.ve', 'gov.ve', 'org.ve',
    'com.pk', 'org.pk', 'edu.pk',
    'com.ng', 'org.ng', 'gov.ng',
    'com.eg', 'edu.eg', 'gov.eg',
    'com.ph', 'gov.ph', 'edu.ph',
    'com.my', 'edu.my', 'gov.my', 'org.my',
    'com.vn', 'gov.vn', 'edu.vn', 'org.vn',
    'com.ua', 'gov.ua', 'edu.ua', 'org.ua',
    'co.il', 'org.il', 'gov.il', 'ac.il',

    'github.io', 'gitlab.io', 'appspot.com', 'cloudfront.net', 'vercel.app', 'azurewebsites.net', 'firebaseapp.com'
]);

export function getRegistrableDomain(hostname) {
    if (!hostname || typeof hostname !== 'string') return '';
    let host = hostname.toLowerCase().trim();
    if (host.endsWith('.')) host = host.slice(0, -1);

    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) {
        return host;
    }

    const parts = host.split('.');
    if (parts.length <= 2) return host;

    const twoPart = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(twoPart)) {
        return parts.slice(-3).join('.');
    }

    return parts.slice(-2).join('.');
}

export function analyzeResources(targetUrl, requestsMap) {
    let totalEncodedBytes = 0;
    let totalDecodedBytes = 0;
    let requestCount = 0;
    let failedRequestCount = 0;
    let canceledRequestCount = 0;
    let cachedRequestCount = 0;
    let serviceWorkerRequestCount = 0;
    let firstPartyCount = 0;
    let thirdPartyCount = 0;

    let targetDomain = "";
    let targetRegistrable = "";
    try {
        targetDomain = new URL(targetUrl).hostname.toLowerCase();
        targetRegistrable = getRegistrableDomain(targetDomain);
    } catch (e) {
        targetDomain = targetUrl || "";
        targetRegistrable = targetDomain;
    }

    const breakdown = {
        document: { count: 0, bytes: 0, decodedBytes: 0 },
        script: { count: 0, bytes: 0, decodedBytes: 0 },
        stylesheet: { count: 0, bytes: 0, decodedBytes: 0 },
        image: { count: 0, bytes: 0, decodedBytes: 0 },
        font: { count: 0, bytes: 0, decodedBytes: 0 },
        xhr: { count: 0, bytes: 0, decodedBytes: 0 },
        media: { count: 0, bytes: 0, decodedBytes: 0 },
        other: { count: 0, bytes: 0, decodedBytes: 0 }
    };

    let largestResource = null;
    let largestImage = null;
    let largestJS = null;
    let largestCSS = null;
    let slowestResource = null;

    let maxBytes = -1;
    let maxImageBytes = -1;
    let maxJSBytes = -1;
    let maxCSSBytes = -1;
    let maxDuration = -1;

    for (const [id, req] of requestsMap.entries()) {
        const isHttpUrl = req && req.url && /^https?:\/\//i.test(req.url);
        if (!isHttpUrl) continue;

        requestCount++;

        const encodedBytes = (req.encodedDataLength !== undefined && req.encodedDataLength !== null && Number.isFinite(req.encodedDataLength))
            ? Math.max(0, req.encodedDataLength)
            : 0;
        totalEncodedBytes += encodedBytes;

        let decodedBytes = null;
        if (req.response && req.response.headers) {
            const cl = req.response.headers['content-length'] || req.response.headers['Content-Length'];
            if (cl && /^\d+$/.test(String(cl).trim())) {
                decodedBytes = parseInt(String(cl).trim(), 10);
            }
        }
        if (decodedBytes === null && req.dataLength !== undefined && Number.isFinite(req.dataLength)) {
            decodedBytes = Math.max(0, req.dataLength);
        }
        if (decodedBytes !== null) {
            totalDecodedBytes += decodedBytes;
        }

        const fromDisk = Boolean(req.response?.fromDiskCache);
        const fromMemory = Boolean(req.response?.fromMemoryCache || req.servedFromCache);
        const fromSW = Boolean(req.response?.fromServiceWorker);
        if (fromDisk || fromMemory) {
            cachedRequestCount++;
        }
        if (fromSW) {
            serviceWorkerRequestCount++;
        }

        if (req.canceled) {
            canceledRequestCount++;
        } else if (req.failed) {
            failedRequestCount++;
        }

        try {
            const reqHostname = new URL(req.url).hostname.toLowerCase();
            const reqRegistrable = getRegistrableDomain(reqHostname);

            const isFirstParty = (reqHostname === targetDomain) ||
                (targetRegistrable && reqRegistrable === targetRegistrable);

            if (isFirstParty) {
                firstPartyCount++;
            } else {
                thirdPartyCount++;
            }
        } catch (e) {
            firstPartyCount++;
        }

        const startTime = (req.requestWillBeSentTime !== null && Number.isFinite(req.requestWillBeSentTime))
            ? req.requestWillBeSentTime
            : null;
        const endTime = (req.loadingFinishedTime !== null && Number.isFinite(req.loadingFinishedTime))
            ? req.loadingFinishedTime
            : ((req.responseReceivedTime !== null && Number.isFinite(req.responseReceivedTime)) ? req.responseReceivedTime : null);

        let duration = null;
        if (startTime !== null && endTime !== null && endTime >= startTime) {
            duration = Math.max(0, endTime - startTime);
        }

        const rawType = (req.type || 'Other').toLowerCase();
        let cat = 'other';
        if (rawType.includes('document')) cat = 'document';
        else if (rawType.includes('script')) cat = 'script';
        else if (rawType.includes('style')) cat = 'stylesheet';
        else if (rawType.includes('image')) cat = 'image';
        else if (rawType.includes('font')) cat = 'font';
        else if (rawType.includes('xhr') || rawType.includes('fetch')) cat = 'xhr';
        else if (rawType.includes('media') || rawType.includes('video') || rawType.includes('audio')) cat = 'media';

        if (breakdown[cat]) {
            breakdown[cat].count++;
            breakdown[cat].bytes += encodedBytes;
            if (decodedBytes !== null) {
                breakdown[cat].decodedBytes += decodedBytes;
            }
        }

        const sizeForHighlights = encodedBytes > 0 ? encodedBytes : (decodedBytes || 0);

        const reqSummary = {
            url: req.url,
            type: req.type || 'Other',
            bytes: encodedBytes,
            decodedBytes,
            durationMs: duration !== null ? Math.round(duration) : null,
            fromCache: fromDisk || fromMemory,
            fromServiceWorker: fromSW,
            failed: Boolean(req.failed),
            canceled: Boolean(req.canceled)
        };

        if (sizeForHighlights > maxBytes) {
            maxBytes = sizeForHighlights;
            largestResource = reqSummary;
        }

        if (cat === 'image' && sizeForHighlights > maxImageBytes) {
            maxImageBytes = sizeForHighlights;
            largestImage = reqSummary;
        }

        if (cat === 'script' && sizeForHighlights > maxJSBytes) {
            maxJSBytes = sizeForHighlights;
            largestJS = reqSummary;
        }

        if (cat === 'stylesheet' && sizeForHighlights > maxCSSBytes) {
            maxCSSBytes = sizeForHighlights;
            largestCSS = reqSummary;
        }

        if (duration !== null && duration > maxDuration) {
            maxDuration = duration;
            slowestResource = reqSummary;
        }
    }

    return {
        requestCount,
        failedRequestCount,
        canceledRequestCount,
        cachedRequestCount,
        serviceWorkerRequestCount,
        encodedBytes: totalEncodedBytes,
        decodedBytes: totalDecodedBytes,
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
