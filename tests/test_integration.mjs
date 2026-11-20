import assert from 'node:assert';
import { calculateMetrics } from '../modules/metrics.js';
import { analyzeResources } from '../modules/resources.js';
import {
    detectCdnProvider,
    detectResourceCdn,
    extractCacheStatus,
    analyzeCacheDetails,
    extractEdgeEvidence,
    aggregateHostCdn
} from '../modules/cdn.js';
import { analyzeSecurity } from '../modules/security.js';
import { calculatePerformanceScore, generateSuggestions } from '../modules/scoring.js';

console.log("=================================================");
console.log("Test Suite: End-to-End Pipeline Integration");
console.log("=================================================");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: [INTEG-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [INTEG-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

function runSimulatedPipeline({
    targetUrl,
    finalUrl,
    mainDocumentResponse,
    requestsMap,
    navigationStartCDP,
    domContentTime,
    loadEventTime,
    lastActivityTime
}) {

    const mainReqEntry = [...requestsMap.entries()].find(([_, r]) => r.type === 'Document');
    const mainRequestId = mainReqEntry ? mainReqEntry[0] : 'main-req';

    const metricsResult = calculateMetrics({
        mainRequestId,
        requests: requestsMap,
        mainDocumentResponse,
        navigationStartCDP,
        domContentTime,
        loadEventTime,
        lastActivityTime
    });

    const rawHeaders = {};
    if (mainDocumentResponse?.headers) {
        for (const [k, v] of Object.entries(mainDocumentResponse.headers)) {
            rawHeaders[k.toLowerCase()] = String(v);
        }
    }

    const cdnResult = detectCdnProvider(rawHeaders);
    const mainCacheDetails = analyzeCacheDetails(rawHeaders, mainDocumentResponse);
    const cacheProviderStatus = mainCacheDetails.summary;

    const resourceEvidenceList = [];
    for (const [reqId, req] of requestsMap.entries()) {
        if (!req.url || !/^https?:\/\//i.test(req.url)) continue;

        const mergedHeaders = {};
        if (req.response?.headers) {
            for (const [k, v] of Object.entries(req.response.headers)) {
                mergedHeaders[k.toLowerCase()] = String(v);
            }
        }

        const remoteIp = req.response?.remoteIPAddress || null;
        const remotePort = req.response?.remotePort || null;
        const protocol = req.response?.protocol || null;
        const statusCode = req.response?.status || (req.failed ? 0 : 200);

        const resourceCdn = detectResourceCdn(mergedHeaders, req.url, req.type, remoteIp, remotePort);
        const resourceCacheDetails = analyzeCacheDetails(mergedHeaders, req.response);

        resourceEvidenceList.push({
            requestId: reqId,
            url: req.url,
            hostname: resourceCdn.hostname,
            resourceType: req.type || 'Other',
            statusCode,
            protocol,
            remoteIPAddress: remoteIp,
            remotePort,
            encodedDataLength: req.encodedDataLength || 0,
            failed: req.failed || false,
            canceled: req.canceled || false,
            redirects: req.redirects || [],
            cdn: resourceCdn,
            edge: resourceCdn.edge,
            cacheStatus: resourceCacheDetails.summary,
            cacheDetails: resourceCacheDetails
        });
    }

    const hostAnalysis = aggregateHostCdn(resourceEvidenceList, finalUrl || targetUrl);
    cdnResult.edge = extractEdgeEvidence(rawHeaders, cdnResult.provider, metricsResult.connection.remoteIp, null);
    cdnResult.byHost = hostAnalysis.byHost;
    cdnResult.allProviders = hostAnalysis.allProviders;

    const securityResult = analyzeSecurity(finalUrl || targetUrl, mainDocumentResponse, rawHeaders);
    const resourcesResult = analyzeResources(finalUrl || targetUrl, requestsMap);

    const scoreDetails = calculatePerformanceScore({
        isHttps: securityResult.isHttps,
        timing: metricsResult.timing,
        cacheStatus: cacheProviderStatus,
        headers: rawHeaders,
        compression: metricsResult.connection.compression,
        failedRequestCount: resourcesResult.failedRequestCount,
        protocol: metricsResult.connection.protocol
    });

    const suggestions = generateSuggestions({
        targetUrl,
        cdnResult,
        timing: metricsResult.timing,
        cacheStatus: cacheProviderStatus,
        headers: rawHeaders,
        tls: securityResult.tls,
        resourceHighlights: resourcesResult.highlights
    });

    return {
        metricsResult,
        cdnResult,
        cacheDetails: mainCacheDetails,
        securityResult,
        resourcesResult,
        scoreDetails,
        suggestions,
        resourceEvidenceList,
        hostAnalysis
    };
}

test("Origin-only website: no CDN false positives, accurate resource and cache reporting", () => {
    const requests = new Map();
    requests.set("doc-1", {
        url: "https://myorigin.example.org/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1200,
        loadingFinishedTime: 1300,
        encodedDataLength: 12000,
        response: {
            status: 200,
            protocol: "http/1.1",
            remoteIPAddress: "198.51.100.25",
            headers: {
                "server": "Apache/2.4.54 (Ubuntu)",
                "content-type": "text/html; charset=UTF-8",
                "content-encoding": "gzip",
                "strict-transport-security": "max-age=31536000"
            }
        }
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://myorigin.example.org/",
        finalUrl: "https://myorigin.example.org/",
        mainDocumentResponse: requests.get("doc-1").response,
        requestsMap: requests,
        navigationStartCDP: 1000,
        domContentTime: 1400,
        loadEventTime: 1600,
        lastActivityTime: 1700
    });

    assert.strictEqual(result.cdnResult.provider, "Not Detected");
    assert.strictEqual(result.cdnResult.confidence, "none");
    assert.strictEqual(result.cdnResult.edge.availability, "unavailable");
    assert.strictEqual(result.cdnResult.edge.remoteIp, "198.51.100.25");
    assert.strictEqual(result.cacheDetails.summary, "No Cache Headers");
    assert.strictEqual(result.resourcesResult.requestCount, 1);
    assert.strictEqual(result.resourcesResult.firstPartyCount, 1);
    assert.strictEqual(result.resourcesResult.thirdPartyCount, 0);
    assert.strictEqual(result.scoreDetails.score > 0, true);

    assert.ok(result.suggestions.some(s => s.title === "No CDN Signature Identified"), "Unidentified CDN is reported as unknown, not as direct origin");
    assert.ok(!result.suggestions.some(s => /direct(ly)? from (an )?origin server increases/i.test(s.desc)), "No unsupported direct-origin claim");
});

test("HTML served from origin while static assets are served through distinct CDNs", () => {
    const requests = new Map();

    requests.set("r-html", {
        url: "https://shop.example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1150,
        loadingFinishedTime: 1250,
        encodedDataLength: 14000,
        response: {
            status: 200,
            protocol: "h2",
            remoteIPAddress: "203.0.113.8",
            headers: { "server": "nginx" }
        }
    });

    requests.set("r-js", {
        url: "https://cdn.example.com/app.js",
        type: "Script",
        requestWillBeSentTime: 1200,
        responseReceivedTime: 1250,
        loadingFinishedTime: 1350,
        encodedDataLength: 45000,
        response: {
            status: 200,
            protocol: "h2",
            remoteIPAddress: "104.21.5.12",
            headers: {
                "server": "cloudflare",
                "cf-ray": "8f3bc4928b971234-ORD",
                "cf-cache-status": "HIT"
            }
        }
    });

    requests.set("r-img", {
        url: "https://images.example.com/logo.png",
        type: "Image",
        requestWillBeSentTime: 1250,
        responseReceivedTime: 1300,
        loadingFinishedTime: 1400,
        encodedDataLength: 95000,
        response: {
            status: 200,
            protocol: "h2",
            remoteIPAddress: "13.224.10.45",
            headers: {
                "via": "1.1 cloudfront",
                "x-amz-cf-id": "abcdef1234==",
                "x-amz-cf-pop": "IAD89-C1",
                "x-cache": "Hit from cloudfront"
            }
        }
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://shop.example.com/",
        mainDocumentResponse: requests.get("r-html").response,
        requestsMap: requests,
        navigationStartCDP: 1000
    });

    assert.strictEqual(result.cdnResult.provider, "Not Detected", "Main HTML is not CDN-served");
    assert.strictEqual(result.hostAnalysis.allProviders.length, 2, "Discovered Cloudflare and CloudFront");
    assert.ok(result.hostAnalysis.allProviders.includes("Cloudflare"));
    assert.ok(result.hostAnalysis.allProviders.includes("Amazon CloudFront"));

    assert.strictEqual(result.hostAnalysis.byHost["cdn.example.com"].provider, "Cloudflare");
    assert.strictEqual(result.hostAnalysis.byHost["images.example.com"].provider, "Amazon CloudFront");
    assert.strictEqual(result.resourcesResult.breakdown.script.count, 1);
    assert.strictEqual(result.resourcesResult.breakdown.image.count, 1);
});

test("Multiple resource hosts on multi-part public suffix (.co.uk) classified accurately", () => {
    const requests = new Map();

    requests.set("h1", { url: "https://www.company.co.uk/", type: "Document" });
    requests.set("h2", { url: "https://api.company.co.uk/v1/user", type: "XHR" });
    requests.set("h3", { url: "https://static.company.co.uk/style.css", type: "Stylesheet" });

    requests.set("h4", { url: "https://analytics.track.co.uk/p.gif", type: "Image" });
    requests.set("h5", { url: "https://fonts.thirdparty.co.uk/font.woff2", type: "Font" });

    const result = runSimulatedPipeline({
        targetUrl: "https://www.company.co.uk/",
        mainDocumentResponse: { status: 200, protocol: "h2", headers: {} },
        requestsMap: requests,
        navigationStartCDP: 100
    });

    assert.strictEqual(result.resourcesResult.firstPartyCount, 3, "3 company.co.uk subdomains are 1st party");
    assert.strictEqual(result.resourcesResult.thirdPartyCount, 2, "2 other .co.uk domains are 3rd party");
    assert.strictEqual(result.resourcesResult.requestCount, 5);
});

test("Delayed resources correctly identify slowest request duration", () => {
    const requests = new Map();

    requests.set("fast-doc", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 100,
        loadingFinishedTime: 250 
    });

    requests.set("slow-js", {
        url: "https://example.com/heavy-bundle.js",
        type: "Script",
        requestWillBeSentTime: 200,
        loadingFinishedTime: 1650, 
        encodedDataLength: 350000
    });

    requests.set("fast-img", {
        url: "https://example.com/pic.jpg",
        type: "Image",
        requestWillBeSentTime: 250,
        loadingFinishedTime: 400 
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://example.com/",
        mainDocumentResponse: { status: 200, protocol: "h2", headers: {} },
        requestsMap: requests,
        navigationStartCDP: 100
    });

    assert.ok(result.resourcesResult.highlights.slowestResource !== null);
    assert.strictEqual(result.resourcesResult.highlights.slowestResource.url, "https://example.com/heavy-bundle.js");
    assert.strictEqual(result.resourcesResult.highlights.slowestResource.durationMs, 1450);
});

test("Redirect chain associates final URL and tracks intermediate hops", () => {
    const requests = new Map();

    requests.set("chain-req", {
        url: "https://example.com/dashboard",
        type: "Document",
        requestWillBeSentTime: 500,
        loadingFinishedTime: 950,
        encodedDataLength: 8200,
        redirects: [
            { url: "http://example.com/", status: 301 },
            { url: "https://example.com/", status: 302 }
        ],
        response: { status: 200, protocol: "h2", headers: {} }
    });

    const result = runSimulatedPipeline({
        targetUrl: "http://example.com/",
        finalUrl: "https://example.com/dashboard",
        mainDocumentResponse: requests.get("chain-req").response,
        requestsMap: requests,
        navigationStartCDP: 500
    });

    assert.strictEqual(result.resourcesResult.requestCount, 1, "Only final landing resource counted");
    assert.strictEqual(result.resourceEvidenceList[0].redirects.length, 2, "2 redirect hops captured");
    assert.strictEqual(result.resourceEvidenceList[0].redirects[0].url, "http://example.com/");
    assert.strictEqual(result.resourceEvidenceList[0].redirects[1].url, "https://example.com/");
});

test("Failed network request and browser-canceled request accounting", () => {
    const requests = new Map();

    requests.set("doc", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 100,
        loadingFinishedTime: 200,
        encodedDataLength: 5000,
        response: { status: 200, protocol: "h2", headers: {} }
    });

    requests.set("fail", {
        url: "https://example.com/data.json",
        type: "XHR",
        requestWillBeSentTime: 200,
        failed: true,
        canceled: false
    });

    requests.set("cancel", {
        url: "https://example.com/prefetch.jpg",
        type: "Image",
        requestWillBeSentTime: 250,
        failed: false,
        canceled: true
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://example.com/",
        mainDocumentResponse: requests.get("doc").response,
        requestsMap: requests,
        navigationStartCDP: 100
    });

    assert.strictEqual(result.resourcesResult.failedRequestCount, 1);
    assert.strictEqual(result.resourcesResult.canceledRequestCount, 1);
    assert.strictEqual(result.resourcesResult.requestCount, 3);
});

test("Cache-related response headers categorized into distinct models", () => {
    const requests = new Map();

    requests.set("cached-disk", {
        url: "https://example.com/style.css",
        type: "Stylesheet",
        requestWillBeSentTime: 100,
        loadingFinishedTime: 110,
        encodedDataLength: 0,
        response: {
            status: 200,
            fromDiskCache: true,
            headers: { "cache-control": "public, max-age=31536000, immutable" }
        }
    });

    requests.set("cached-sw", {
        url: "https://example.com/worker-asset.png",
        type: "Image",
        requestWillBeSentTime: 120,
        loadingFinishedTime: 135,
        encodedDataLength: 0,
        response: {
            status: 200,
            fromServiceWorker: true,
            headers: { "content-type": "image/png" }
        }
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://example.com/",
        mainDocumentResponse: { status: 200, protocol: "h2", headers: {} },
        requestsMap: requests,
        navigationStartCDP: 100
    });

    assert.strictEqual(result.resourcesResult.cachedRequestCount, 1, "1 disk-cached request");
    assert.strictEqual(result.resourcesResult.serviceWorkerRequestCount, 1, "1 service-worker request");
    assert.strictEqual(result.resourceEvidenceList[0].cacheStatus, "Disk Cache");
    assert.strictEqual(result.resourceEvidenceList[1].cacheStatus, "Service Worker");
});

test("Mixed HTTP protocol reporting across requests", () => {
    const requests = new Map();

    requests.set("doc-h3", {
        url: "https://example.com/",
        type: "Document",
        response: { status: 200, protocol: "h3", headers: {} }
    });

    requests.set("script-h2", {
        url: "https://example.com/script.js",
        type: "Script",
        response: { status: 200, protocol: "h2", headers: {} }
    });

    requests.set("frame-h1", {
        url: "https://example.com/frame.html",
        type: "Document",
        response: { status: 200, protocol: "http/1.1", headers: {} }
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://example.com/",
        mainDocumentResponse: requests.get("doc-h3").response,
        requestsMap: requests,
        navigationStartCDP: 100
    });

    assert.strictEqual(result.metricsResult.connection.protocol, "h3", "Main document connection is h3");
    assert.strictEqual(result.resourceEvidenceList[1].protocol, "h2");
    assert.strictEqual(result.resourceEvidenceList[2].protocol, "http/1.1");
});

test("Main document summary uses the primary navigation document, not late-arriving iframe documents", () => {
    const requestsMap = new Map();

    requestsMap.set("main-doc-req", {
        url: "https://mysite.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1481.43,
        loadingFinishedTime: 1481.43,
        response: {
            url: "https://mysite.com/",
            status: 200,
            protocol: "h2",
            headers: {
                "server": "cloudflare",
                "cf-ray": "8f3bc4928b971234-ORD",
                "content-type": "text/html"
            },
            timing: {
                requestTime: 1.0,
                dnsStart: 10,
                dnsEnd: 25,
                connectStart: 25,
                connectEnd: 74,
                sslStart: 45,
                sslEnd: 74,
                sendStart: 74,
                sendEnd: 75.19,
                receiveHeadersStart: 481.43,
                receiveHeadersEnd: 481.43
            }
        }
    });

    requestsMap.set("iframe-subdocument-req", {
        url: "https://thirdparty-ads.com/frame.html",
        type: "Document",
        requestWillBeSentTime: 1800,
        responseReceivedTime: 2064,
        loadingFinishedTime: 2070,
        response: {
            url: "https://thirdparty-ads.com/frame.html",
            status: 200,
            protocol: "h2",
            headers: {
                "server": "gws",
                "content-type": "text/html"
            },
            timing: {
                requestTime: 1.8,
                sendStart: 5,
                sendEnd: 6,
                receiveHeadersStart: 270,
                receiveHeadersEnd: 272
            }
        }
    });

    const result = runSimulatedPipeline({
        targetUrl: "https://mysite.com/",
        finalUrl: "https://mysite.com/",
        mainDocumentResponse: requestsMap.get("main-doc-req").response,
        requestsMap,
        navigationStartCDP: 1000
    });

    assert.strictEqual(result.metricsResult.timing.ttfbMs, 406.24, "TTFB is from main document (481.43 - 75.19), not iframe (264)");
    assert.strictEqual(result.cdnResult.provider, "Cloudflare", "CDN is from main document, not iframe");
    assert.strictEqual(result.resourceEvidenceList.length, 2);
    assert.strictEqual(result.resourceEvidenceList[0].hostname, "mysite.com");
    assert.strictEqual(result.resourceEvidenceList[1].hostname, "thirdparty-ads.com");
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Integration tests passed.`);
console.log("=================================================");
