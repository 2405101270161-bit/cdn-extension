import assert from 'node:assert';
import { calculateMetrics, parseServerTiming } from '../extension/modules/metrics.js';

console.log("=================================================");
console.log("Test Suite: Network Timing Calculations");
console.log("=================================================");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: [TIMING-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [TIMING-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

test("Complete network timing offsets calculated accurately", () => {
    const requests = new Map();
    requests.set("req-doc-1", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1250,
        loadingFinishedTime: 1350
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-doc-1",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2",
            connectionReused: false,
            timing: {
                requestTime: 1.0,
                dnsStart: 10,
                dnsEnd: 40,
                connectStart: 40,
                connectEnd: 110,
                sslStart: 70,
                sslEnd: 110,
                sendStart: 110,
                sendEnd: 115,
                receiveHeadersStart: 250,
                receiveHeadersEnd: 255
            }
        },
        navigationStartCDP: 1000,
        domContentTime: 1600,
        loadEventTime: 1900,
        lastActivityTime: 2100
    });

    assert.strictEqual(metrics.timing.dnsMs, 30, "dnsMs = 40 - 10");
    assert.strictEqual(metrics.timing.tcpMs, 30, "tcpMs = 70 - 40 (connect before SSL)");
    assert.strictEqual(metrics.timing.tlsMs, 40, "tlsMs = 110 - 70");
    assert.strictEqual(metrics.timing.requestSentMs, 5, "requestSentMs = 115 - 110");
    assert.strictEqual(metrics.timing.ttfbMs, 135, "ttfbMs = receiveHeadersStart - sendEnd (250 - 115)");
    assert.strictEqual(metrics.timing.serverWaitingMs, 135, "serverWaitingMs matches ttfbMs");
    assert.strictEqual(metrics.timing.downloadMs, 95, "downloadMs = 1350 - (1000 + 255)");
    assert.strictEqual(metrics.timing.documentMs, 350, "documentMs = 1350 - 1000");
    assert.strictEqual(metrics.timing.domContentLoadedMs, 600, "domContentLoadedMs = 1600 - 1000");
    assert.strictEqual(metrics.timing.loadEventMs, 900, "loadEventMs = 1900 - 1000");
    assert.strictEqual(metrics.timing.networkIdleMs, 1100, "networkIdleMs = 2100 - 1000");
});

test("Measured 0ms DNS duration is reported as 0, not null", () => {
    const requests = new Map();
    requests.set("req-cached-dns", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        loadingFinishedTime: 1100
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-cached-dns",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2",
            connectionReused: false,
            timing: {
                requestTime: 1.0,
                dnsStart: 15,
                dnsEnd: 15,
                connectStart: 15,
                connectEnd: 30,
                sendStart: 30,
                sendEnd: 32,
                receiveHeadersStart: 60,
                receiveHeadersEnd: 62
            }
        }
    });

    assert.strictEqual(metrics.timing.dnsMs, 0, "Measured 0ms DNS lookup must be 0, not null");
});

test("Reused connection reports null for DNS, TCP, and TLS (not measured zeroes)", () => {
    const requests = new Map();
    requests.set("req-reused", {
        url: "https://example.com/asset.js",
        type: "Document",
        requestWillBeSentTime: 2000,
        loadingFinishedTime: 2100
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-reused",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/asset.js",
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
                sendEnd: 4,
                receiveHeadersStart: 45,
                receiveHeadersEnd: 48
            }
        }
    });

    assert.strictEqual(metrics.connection.reused, true);
    assert.strictEqual(metrics.timing.dnsMs, null, "DNS must be null on reused connection");
    assert.strictEqual(metrics.timing.tcpMs, null, "TCP must be null on reused connection");
    assert.strictEqual(metrics.timing.tlsMs, null, "TLS must be null on reused connection");
});

test("Negotiated protocols (http/1.1, h2, h3) reported accurately; unobserved reported as Unknown", () => {
    const makeReq = (proto) => {
        const requests = new Map();
        requests.set("req-proto", { url: "https://example.com/", type: "Document" });
        return calculateMetrics({
            mainRequestId: "req-proto",
            requests,
            mainDocumentResponse: {
                url: "https://example.com/",
                protocol: proto,
                timing: { requestTime: 1.0, receiveHeadersStart: 50, sendEnd: 5 }
            }
        });
    };

    assert.strictEqual(makeReq("http/1.1").connection.protocol, "http/1.1");
    assert.strictEqual(makeReq("h2").connection.protocol, "h2");
    assert.strictEqual(makeReq("h3").connection.protocol, "h3");
    assert.strictEqual(makeReq("").connection.protocol, "Unknown");
    assert.strictEqual(makeReq(null).connection.protocol, "Unknown");
});

test("TTFB derived from timing.receiveHeadersStart minus sendEnd", () => {
    const requests = new Map();
    requests.set("req-ttfb", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 500
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-ttfb",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2",
            timing: {
                requestTime: 0.5,
                dnsStart: -1,
                connectStart: -1,
                sendStart: 2,
                sendEnd: 4,
                receiveHeadersStart: 145,
                receiveHeadersEnd: 150
            }
        }
    });

    assert.strictEqual(metrics.timing.ttfbMs, 141, "ttfbMs = receiveHeadersStart - sendEnd (145 - 4)");
    assert.strictEqual(metrics.timing.serverWaitingMs, 141);
});

test("Download duration derived from response header receipt to loadingFinished", () => {
    const requests = new Map();
    requests.set("req-dl", {
        url: "https://example.com/large.html",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1200,
        loadingFinishedTime: 1450
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-dl",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/large.html",
            protocol: "h2",
            timing: {
                requestTime: 1.0,
                sendStart: 10,
                sendEnd: 12,
                receiveHeadersStart: 195,
                receiveHeadersEnd: 200
            }
        },
        navigationStartCDP: 1000
    });

    assert.strictEqual(metrics.timing.downloadMs, 250, "downloadMs = 1450 - 1200");
    assert.strictEqual(metrics.timing.documentMs, 450, "documentMs = 1450 - 1000");
});

test("Missing timing object falls back to lifecycle timestamps safely", () => {
    const requests = new Map();
    requests.set("req-notiming", {
        url: "https://example.com/fallback.html",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1300,
        loadingFinishedTime: 1400
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-notiming",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/fallback.html",
            protocol: "h2"
        }
    });

    assert.strictEqual(metrics.timing.ttfbMs, null, "TTFB is unavailable (never estimated) without CDP timing");
    assert.ok(metrics.timing.ttfbUnavailableReason, "Reason for unavailable TTFB is reported");
    assert.strictEqual(metrics.timing.downloadMs, 100, "Download fallback = 1400 - 1300");
    assert.strictEqual(metrics.timing.dnsMs, null);
    assert.strictEqual(metrics.timing.tcpMs, null);
    assert.strictEqual(metrics.timing.tlsMs, null);
});

test("Missing lifecycle events remain null and do not substitute documentMs", () => {
    const requests = new Map();
    requests.set("req-nolifecycle", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        loadingFinishedTime: 1500
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-nolifecycle",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2"
        },
        navigationStartCDP: 1000,
        domContentTime: null,
        loadEventTime: null,
        lastActivityTime: 1600
    });

    assert.strictEqual(metrics.timing.domContentLoadedMs, null, "domContentLoadedMs must be null when event did not fire");
    assert.strictEqual(metrics.timing.loadEventMs, null, "loadEventMs must be null when event did not fire");
    assert.strictEqual(metrics.timing.networkIdleMs, 600, "networkIdleMs = 1600 - 1000");
});

test("Negative or out-of-order timestamps never yield negative durations", () => {
    const requests = new Map();
    requests.set("req-inverted", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 2000,
        responseReceivedTime: 1900,
        loadingFinishedTime: 1800
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-inverted",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2",
            timing: {
                requestTime: 2.0,
                dnsStart: 50,
                dnsEnd: 20,
                connectStart: 50,
                connectEnd: 30,
                sslStart: 40,
                sslEnd: 20,
                receiveHeadersStart: -5
            }
        },
        navigationStartCDP: 2000
    });

    assert.strictEqual(metrics.timing.dnsMs, null, "Inverted DNS must be null");
    assert.strictEqual(metrics.timing.tcpMs, null, "Inverted TCP must be null");
    assert.strictEqual(metrics.timing.tlsMs, null, "Inverted TLS must be null");
    assert.strictEqual(metrics.timing.ttfbMs, null, "Negative TTFB must be null");
});

test("DevTools timing alignment: waiting for server response and total request duration", () => {
    const requests = new Map();
    requests.set("req-ref", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1481.43,
        loadingFinishedTime: 1481.43
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-ref",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "h2",
            connectionReused: false,
            headers: {
                "server-timing": "cf_rtt;dur=25, edge;dur=12.5"
            },
            timing: {
                requestTime: 1.0,
                dnsStart: 10.0,
                dnsEnd: 25.0,
                connectStart: 25.0,
                connectEnd: 74.0,
                sslStart: 45.0,
                sslEnd: 74.0,
                sendStart: 74.0,
                sendEnd: 75.19,
                receiveHeadersStart: 481.43,
                receiveHeadersEnd: 481.43
            }
        },
        navigationStartCDP: 1000
    });

    assert.strictEqual(metrics.timing.ttfbMs, 406.24, "TTFB matches DevTools Waiting for server response (481.43 - 75.19)");
    assert.strictEqual(metrics.timing.serverWaitingMs, 406.24);
    assert.strictEqual(metrics.timing.totalRequestMs, 481.43, "Total request duration matches DevTools (1481.43 - 1000)");

    assert.ok(Array.isArray(metrics.serverTiming));
    assert.strictEqual(metrics.serverTiming.length, 2);
    assert.strictEqual(metrics.serverTiming[0].name, "cf_rtt");
    assert.strictEqual(metrics.serverTiming[0].dur, 25);
    assert.strictEqual(metrics.serverTiming[1].name, "edge");
    assert.strictEqual(metrics.serverTiming[1].dur, 12.5);
    assert.notStrictEqual(metrics.timing.ttfbMs, metrics.serverTiming[0].dur, "Browser TTFB is kept separate from Server-Timing");
});

test("Server-Timing parser correctly handles dur and desc parameters", () => {
    const parsed = parseServerTiming("miss, cdn-cache;desc=HIT, edge;dur=1.4;desc=edge-pop, cf_rtt;dur=32.1");
    assert.strictEqual(parsed.length, 4);
    assert.strictEqual(parsed[0].name, "miss");
    assert.strictEqual(parsed[0].dur, null);
    assert.strictEqual(parsed[1].name, "cdn-cache");
    assert.strictEqual(parsed[1].desc, "HIT");
    assert.strictEqual(parsed[2].name, "edge");
    assert.strictEqual(parsed[2].dur, 1.4);
    assert.strictEqual(parsed[2].desc, "edge-pop");
    assert.strictEqual(parsed[3].name, "cf_rtt");
    assert.strictEqual(parsed[3].dur, 32.1);
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Network Timing tests passed.`);
console.log("=================================================");
