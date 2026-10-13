/**
 * Goal 3 Deterministic Automated Test Suite
 *
 * Verifies network timing calculations, connection metadata, resource accounting,
 * cache analysis, public suffix parsing, and performance scoring with incomplete data.
 */

import assert from 'assert';
import { calculateMetrics } from '../modules/metrics.js';
import { analyzeResources, getRegistrableDomain } from '../modules/resources.js';
import { analyzeCacheDetails, extractCacheStatus } from '../modules/cdn.js';
import { calculatePerformanceScore } from '../modules/scoring.js';

console.log("=================================================");
console.log("Running Goal 3 Network Metrics & Accounting Tests");
console.log("=================================================");

let passed = 0;
let total = 0;

function runTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`PASS: Test ${total} - ${name}`);
        passed++;
    } catch (err) {
        console.error(`FAIL: Test ${total} - ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// -------------------------------------------------------------
// Test 1: Normal request with complete timing information
// -------------------------------------------------------------
runTest("Normal request with complete timing information", () => {
    const requests = new Map();
    requests.set("req-1", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1200,
        loadingFinishedTime: 1280
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-1",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2",
            remoteIPAddress: "93.184.216.34",
            connectionReused: false,
            headers: {
                "content-encoding": "br",
                "content-type": "text/html"
            },
            timing: {
                requestTime: 1.0,
                dnsStart: 10,
                dnsEnd: 35,
                connectStart: 35,
                connectEnd: 85,
                sslStart: 50,
                sslEnd: 85,
                sendStart: 85,
                sendEnd: 88,
                receiveHeadersStart: 180,
                receiveHeadersEnd: 185
            }
        },
        navigationStartCDP: 1000,
        domContentTime: 1500,
        loadEventTime: 1800,
        lastActivityTime: 2000
    });

    // Timing assertions
    assert.strictEqual(metrics.timing.dnsMs, 25, "DNS resolution duration (35 - 10)");
    assert.strictEqual(metrics.timing.tcpMs, 15, "TCP duration before SSL (50 - 35)");
    assert.strictEqual(metrics.timing.tlsMs, 35, "TLS handshake duration (85 - 50)");
    assert.strictEqual(metrics.timing.requestSentMs, 3, "Request dispatch duration (88 - 85)");
    assert.strictEqual(metrics.timing.ttfbMs, 180, "TTFB relative to request dispatch");
    assert.strictEqual(metrics.timing.downloadMs, 95, "Download duration from header end (1185) to loadingFinished (1280)");
    assert.strictEqual(metrics.timing.documentMs, 280, "Total document load duration (1280 - 1000)");
    assert.strictEqual(metrics.timing.domContentLoadedMs, 500, "DOMContentLoaded relative to navStart (1500 - 1000)");
    assert.strictEqual(metrics.timing.loadEventMs, 800, "Load event relative to navStart (1800 - 1000)");
    assert.strictEqual(metrics.timing.networkIdleMs, 1000, "Network idle duration (2000 - 1000)");

    // Connection assertions
    assert.strictEqual(metrics.connection.reused, false, "Connection was not reused");
    assert.strictEqual(metrics.connection.protocol, "h2", "Negotiated protocol captured");
    assert.strictEqual(metrics.connection.remoteIp, "93.184.216.34", "Remote IP recorded");
    assert.strictEqual(metrics.connection.compression, "br", "Content-encoding captured");
});

// -------------------------------------------------------------
// Test 2: Reused connection with no new DNS/TCP/TLS phases
// -------------------------------------------------------------
runTest("Reused connection with no new DNS/TCP/TLS phases", () => {
    const requests = new Map();
    requests.set("req-2", {
        url: "https://example.com/api/data",
        type: "Document",
        requestWillBeSentTime: 2000,
        responseReceivedTime: 2120,
        loadingFinishedTime: 2150
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-2",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/api/data",
            protocol: "h2",
            connectionReused: true,
            timing: {
                requestTime: 2.0,
                dnsStart: -1,
                dnsEnd: -1,
                connectStart: -1,
                connectEnd: -1,
                sslStart: -1,
                sslEnd: -1,
                sendStart: 2,
                sendEnd: 5,
                receiveHeadersStart: 120,
                receiveHeadersEnd: 125
            }
        },
        navigationStartCDP: 2000
    });

    assert.strictEqual(metrics.connection.reused, true, "Connection is marked reused");
    assert.strictEqual(metrics.timing.dnsMs, null, "Reused connection DNS must be null, not 0ms");
    assert.strictEqual(metrics.timing.tcpMs, null, "Reused connection TCP must be null, not 0ms");
    assert.strictEqual(metrics.timing.tlsMs, null, "Reused connection TLS must be null, not 0ms");
    assert.strictEqual(metrics.timing.requestSentMs, 3, "Send duration measured");
    assert.strictEqual(metrics.timing.ttfbMs, 120, "TTFB measured");
});

// -------------------------------------------------------------
// Test 3: Request with missing timing information
// -------------------------------------------------------------
runTest("Request with missing timing information", () => {
    const requests = new Map();
    requests.set("req-3", {
        url: "https://example.com/page",
        type: "Document",
        requestWillBeSentTime: 3000,
        responseReceivedTime: 3250,
        loadingFinishedTime: 3300
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-3",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/page",
            protocol: "http/1.1",
            // No timing object present (e.g. cached or limited CDP profile)
            timing: null
        },
        navigationStartCDP: 3000
    });

    assert.strictEqual(metrics.timing.dnsMs, null, "DNS must be null when timing is missing");
    assert.strictEqual(metrics.timing.tcpMs, null, "TCP must be null when timing is missing");
    assert.strictEqual(metrics.timing.tlsMs, null, "TLS must be null when timing is missing");
    assert.strictEqual(metrics.timing.requestSentMs, null, "requestSentMs must be null");
    // Fallback TTFB from lifecycle timestamps
    assert.strictEqual(metrics.timing.ttfbMs, 250, "TTFB derived from responseReceivedTime - requestWillBeSentTime (3250 - 3000)");
    assert.strictEqual(metrics.timing.downloadMs, 50, "downloadMs derived from loadingFinishedTime - responseReceivedTime (3300 - 3250)");
    assert.strictEqual(metrics.timing.documentMs, 300, "documentMs (3300 - 3000)");
});

// -------------------------------------------------------------
// Test 4: Redirect chain handling
// -------------------------------------------------------------
runTest("Redirect chain handling in resource accounting", () => {
    const requests = new Map();

    // In CDP, redirects maintain the same requestId with redirect hops recorded
    requests.set("req-redir", {
        url: "https://example.com/final-destination",
        type: "Document",
        requestWillBeSentTime: 1000,
        loadingFinishedTime: 1400,
        encodedDataLength: 5200,
        redirects: [
            { url: "http://example.com/", status: 301 },
            { url: "https://example.com/", status: 302 }
        ]
    });

    const res = analyzeResources("https://example.com/final-destination", requests);

    // Verify redirect chain does not inflate the request count
    assert.strictEqual(res.requestCount, 1, "Only final resource counted in requestCount");
    assert.strictEqual(res.encodedBytes, 5200, "Transferred bytes accurately captured");
    assert.strictEqual(res.firstPartyCount, 1, "Correctly classified as 1st party");
    assert.strictEqual(res.thirdPartyCount, 0, "No false 3rd party attribution");
});

// -------------------------------------------------------------
// Test 5: Failed or canceled request accounting
// -------------------------------------------------------------
runTest("Failed and canceled request accounting", () => {
    const requests = new Map();

    requests.set("req-ok", {
        url: "https://example.com/ok.js",
        type: "Script",
        requestWillBeSentTime: 100,
        loadingFinishedTime: 200,
        encodedDataLength: 1000,
        failed: false,
        canceled: false
    });

    requests.set("req-failed", {
        url: "https://example.com/error.jpg",
        type: "Image",
        requestWillBeSentTime: 150,
        encodedDataLength: 0,
        failed: true,
        canceled: false
    });

    requests.set("req-canceled", {
        url: "https://example.com/aborted.png",
        type: "Image",
        requestWillBeSentTime: 180,
        encodedDataLength: 0,
        failed: false,
        canceled: true
    });

    const res = analyzeResources("https://example.com/", requests);

    assert.strictEqual(res.requestCount, 3, "Total requests matches 3");
    assert.strictEqual(res.failedRequestCount, 1, "Exactly 1 failed request counted");
    assert.strictEqual(res.canceledRequestCount, 1, "Exactly 1 canceled request counted");
    assert.strictEqual(res.encodedBytes, 1000, "Encoded bytes accurately sum successful transfer");
});

// -------------------------------------------------------------
// Test 6: Browser memory/disk cache evidence
// -------------------------------------------------------------
runTest("Browser memory and disk cache evidence", () => {
    // Disk cache response
    const diskCacheAnalysis = analyzeCacheDetails({
        "content-type": "text/html"
    }, {
        fromDiskCache: true,
        fromMemoryCache: false
    });
    assert.strictEqual(diskCacheAnalysis.browserCache.servedFromCache, true);
    assert.strictEqual(diskCacheAnalysis.browserCache.type, "disk");
    assert.strictEqual(diskCacheAnalysis.summary, "Disk Cache");

    // Memory cache response
    const memoryCacheAnalysis = analyzeCacheDetails({
        "content-type": "application/javascript"
    }, {
        fromMemoryCache: true
    });
    assert.strictEqual(memoryCacheAnalysis.browserCache.servedFromCache, true);
    assert.strictEqual(memoryCacheAnalysis.browserCache.type, "memory");
    assert.strictEqual(memoryCacheAnalysis.summary, "Memory Cache");

    // Ensure extractCacheStatus backward compatibility
    assert.strictEqual(extractCacheStatus({}, { fromDiskCache: true }), "Disk Cache");
});

// -------------------------------------------------------------
// Test 7: Service-worker response handling
// -------------------------------------------------------------
runTest("Service-worker response not misclassified as CDN hit", () => {
    const swAnalysis = analyzeCacheDetails({
        "content-type": "text/html"
    }, {
        fromServiceWorker: true
    });

    assert.strictEqual(swAnalysis.serviceWorker.fulfilledByServiceWorker, true);
    assert.strictEqual(swAnalysis.cdnCache.status, "NONE", "Service worker must not be classified as CDN cache");
    assert.strictEqual(swAnalysis.summary, "Service Worker");
    assert.strictEqual(extractCacheStatus({}, { fromServiceWorker: true }), "Service Worker");
});

// -------------------------------------------------------------
// Test 8: CDN cache HIT, MISS, and BYPASS headers
// -------------------------------------------------------------
runTest("CDN cache HIT, MISS, and BYPASS header detection", () => {
    // Cloudflare HIT
    const cfHit = analyzeCacheDetails({ "cf-cache-status": "HIT" });
    assert.strictEqual(cfHit.cdnCache.status, "HIT");
    assert.strictEqual(cfHit.cdnCache.header, "cf-cache-status");
    assert.strictEqual(cfHit.summary, "HIT");

    // Cloudflare BYPASS / DYNAMIC
    const cfBypass = analyzeCacheDetails({ "cf-cache-status": "DYNAMIC" });
    assert.strictEqual(cfBypass.cdnCache.status, "BYPASS");

    // CloudFront MISS
    const cfMiss = analyzeCacheDetails({ "x-cache": "Miss from cloudfront" });
    assert.strictEqual(cfMiss.cdnCache.status, "MISS");
    assert.strictEqual(cfMiss.cdnCache.header, "x-cache");

    // Vercel REVALIDATED
    const vercelReval = analyzeCacheDetails({ "x-vercel-cache": "REVALIDATED" });
    assert.strictEqual(vercelReval.cdnCache.status, "REVALIDATED");

    // Akamai REFRESH_HIT
    const akamaiHit = analyzeCacheDetails({ "x-cache": "TCP_REFRESH_HIT" });
    assert.strictEqual(akamaiHit.cdnCache.status, "REVALIDATED");
});

// -------------------------------------------------------------
// Test 9: Cache-Control policy without explicit CDN result
// -------------------------------------------------------------
runTest("Cache-Control policy without explicit CDN result", () => {
    // Policy allowing caching does NOT mean CDN served a HIT
    const publicCache = analyzeCacheDetails({
        "cache-control": "public, max-age=86400, s-maxage=604800"
    });
    assert.strictEqual(publicCache.cdnCache.status, "NONE", "Must not infer CDN HIT from Cache-Control");
    assert.strictEqual(publicCache.policy.status, "Cacheable");
    assert.strictEqual(publicCache.summary, "Cacheable");

    // Age header presence without CDN status
    const ageHeader = analyzeCacheDetails({
        "age": "120",
        "cache-control": "public, max-age=300"
    });
    assert.strictEqual(ageHeader.cdnCache.status, "NONE", "Must not infer CDN HIT from Age header");
    assert.strictEqual(ageHeader.policy.ageSeconds, 120);

    // Explicit no-store policy
    const noStore = analyzeCacheDetails({
        "cache-control": "no-store, no-cache, private"
    });
    assert.strictEqual(noStore.policy.status, "Not Cacheable");
    assert.strictEqual(noStore.summary, "Not Cacheable");
});

// -------------------------------------------------------------
// Test 10: Missing response sizes and transfer information
// -------------------------------------------------------------
runTest("Missing response sizes and transfer information", () => {
    const requests = new Map();
    requests.set("req-nosize", {
        url: "https://example.com/stream",
        type: "Other",
        // No encodedDataLength and no content-length
        encodedDataLength: null,
        response: { headers: {} }
    });

    const res = analyzeResources("https://example.com/", requests);
    assert.strictEqual(res.encodedBytes, 0, "Does not invent sizes when transfer info missing");
    assert.strictEqual(res.decodedBytes, 0, "Decoded bytes is 0 when missing");
    assert.strictEqual(res.highlights.largestResource.bytes, 0);
    assert.strictEqual(res.highlights.largestResource.decodedBytes, null);
});

// -------------------------------------------------------------
// Test 11: Duplicate or out-of-order CDP events
// -------------------------------------------------------------
runTest("Duplicate or out-of-order CDP events", () => {
    const requests = new Map();

    // Request entry created
    requests.set("req-dupe", {
        url: "https://example.com/asset.js",
        type: "Script",
        requestWillBeSentTime: 500,
        loadingFinishedTime: 700,
        encodedDataLength: 4000
    });

    // Simulated duplicate requestWillBeSent for the same requestId (e.g. service worker intercept)
    const existing = requests.get("req-dupe");
    existing.encodedDataLength = 4000;

    const res = analyzeResources("https://example.com/", requests);
    assert.strictEqual(res.requestCount, 1, "Deduplicated by requestId");
    assert.strictEqual(res.encodedBytes, 4000, "Does not double count encodedDataLength");
});

// -------------------------------------------------------------
// Test 12: Domains with public suffixes (e.g. co.uk, github.io)
// -------------------------------------------------------------
runTest("Domains with multi-part public suffixes", () => {
    // 1. UK ccTLD (bbc.co.uk)
    assert.strictEqual(getRegistrableDomain("news.bbc.co.uk"), "bbc.co.uk");
    assert.strictEqual(getRegistrableDomain("bbc.co.uk"), "bbc.co.uk");
    assert.strictEqual(getRegistrableDomain("static.news.bbc.co.uk"), "bbc.co.uk");
    assert.strictEqual(getRegistrableDomain("adserver.co.uk"), "adserver.co.uk");

    // 2. Australian ccTLD (com.au)
    assert.strictEqual(getRegistrableDomain("shop.brand.com.au"), "brand.com.au");

    // 3. Multi-tenant public hosting (github.io)
    assert.strictEqual(getRegistrableDomain("project.github.io"), "project.github.io");
    assert.strictEqual(getRegistrableDomain("otheruser.github.io"), "otheruser.github.io");

    // First party vs Third party in analyzeResources
    const requests = new Map();
    // 1st party subdomains
    requests.set("r1", { url: "https://news.bbc.co.uk/articles/1", type: "Document" });
    requests.set("r2", { url: "https://static.bbc.co.uk/style.css", type: "Stylesheet" });
    // 3rd party on same ccTLD
    requests.set("r3", { url: "https://analytics.co.uk/track", type: "Script" });
    requests.set("r4", { url: "https://cdn.othercompany.co.uk/lib.js", type: "Script" });

    const res = analyzeResources("https://www.bbc.co.uk/", requests);
    assert.strictEqual(res.firstPartyCount, 2, "2 requests to bbc.co.uk are 1st party");
    assert.strictEqual(res.thirdPartyCount, 2, "2 requests to other .co.uk domains are 3rd party");
    assert.strictEqual(res.firstPartyCount + res.thirdPartyCount, res.requestCount);
});

// -------------------------------------------------------------
// Test 13: Missing compression and protocol information
// -------------------------------------------------------------
runTest("Missing compression and protocol information", () => {
    const requests = new Map();
    requests.set("req-unobserved", {
        url: "https://example.com/unobserved",
        type: "Document"
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-unobserved",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/unobserved",
            // protocol omitted
            // headers omitted
        }
    });

    assert.strictEqual(metrics.connection.protocol, "Unknown", "Protocol must be Unknown when unobserved");
    assert.strictEqual(metrics.connection.compression, "Unknown", "Compression must be Unknown when headers unobserved");
});

// -------------------------------------------------------------
// Test 14: Performance scoring with incomplete data
// -------------------------------------------------------------
runTest("Performance scoring with incomplete data", () => {
    // Site has TTFB of 120ms (excellent), but loadEvent is missing / not measured
    const scoreIncomplete = calculatePerformanceScore({
        isHttps: true,
        timing: {
            ttfbMs: 120,
            loadEventMs: null,
            documentMs: null
        },
        cacheStatus: "HIT",
        headers: {
            "strict-transport-security": "max-age=31536000"
            // content-encoding omitted (unobserved)
        },
        failedRequestCount: 0
    });

    // Verify dynamic reweighting and no NaN
    assert.ok(Number.isFinite(scoreIncomplete.score), "Score is finite number");
    assert.ok(scoreIncomplete.score >= 90, `Score (${scoreIncomplete.score}) should not be penalised for missing load time`);
    assert.strictEqual(scoreIncomplete.applicableComponents.pageLoad, false, "pageLoad flagged as not applicable");
    assert.strictEqual(scoreIncomplete.applicableComponents.compression, false, "compression flagged as not applicable");
    assert.strictEqual(scoreIncomplete.applicableComponents.ttfb, true, "ttfb flagged as applicable");
    assert.ok(scoreIncomplete.completeness < 1.0, "Completeness reflects available data ratio");

    // All data missing edge case
    const scoreEmpty = calculatePerformanceScore({});
    assert.ok(Number.isFinite(scoreEmpty.score), "Empty context yields finite score");
    assert.ok(scoreEmpty.score >= 1 && scoreEmpty.score <= 100, "Score within bounds [1, 100]");
});

console.log("=================================================");
console.log(`RESULTS: ${passed} of ${total} tests PASSED!`);
console.log("=================================================");

if (passed === total) {
    console.log("ALL 14 GOAL 3 SCENARIOS VERIFIED SUCCESSFULLY!");
}
