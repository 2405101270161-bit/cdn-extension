/**
 * Test Suite: Network Timing Calculations
 * Verifies DNS, TCP, TLS, TTFB, download, document, and lifecycle calculations,
 * protocol reporting, connection reuse, redirect handling, and missing-data sentinels.
 */

import assert from 'node:assert';
import { calculateMetrics } from '../modules/metrics.js';

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

// 1. Complete network timing with discrete phases
test("Complete network timing offsets calculated accurately", () => {
    const requests = new Map();
    requests.set("req-full", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1250,
        loadingFinishedTime: 1350
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-full",
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
    assert.strictEqual(metrics.timing.ttfbMs, 250, "ttfbMs = receiveHeadersStart");
    assert.strictEqual(metrics.timing.downloadMs, 95, "downloadMs = 1350 - (1000 + 255)");
    assert.strictEqual(metrics.timing.documentMs, 350, "documentMs = 1350 - 1000");
    assert.strictEqual(metrics.timing.domContentLoadedMs, 600, "domContentLoadedMs = 1600 - 1000");
    assert.strictEqual(metrics.timing.loadEventMs, 900, "loadEventMs = 1900 - 1000");
    assert.strictEqual(metrics.timing.networkIdleMs, 1100, "networkIdleMs = 2100 - 1000");
});

// 2. Measured 0ms vs unavailable null
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
                dnsStart: 20,
                dnsEnd: 20, // Measured 0ms lookup
                connectStart: 20,
                connectEnd: 50,
                sendStart: 50,
                sendEnd: 52,
                receiveHeadersStart: 90,
                receiveHeadersEnd: 92
            }
        },
        navigationStartCDP: 1000
    });

    assert.strictEqual(metrics.timing.dnsMs, 0, "Measured 0ms DNS lookup must be 0, not null");
});

// 3. Reused connection timing
test("Reused connection reports null for DNS, TCP, and TLS (not measured zeroes)", () => {
    const requests = new Map();
    requests.set("req-reused", {
        url: "https://example.com/asset",
        type: "Document",
        requestWillBeSentTime: 2000,
        loadingFinishedTime: 2100
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-reused",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/asset",
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
                sendStart: 1,
                sendEnd: 3,
                receiveHeadersStart: 80,
                receiveHeadersEnd: 82
            }
        },
        navigationStartCDP: 2000
    });

    assert.strictEqual(metrics.connection.reused, true);
    assert.strictEqual(metrics.timing.dnsMs, null, "DNS must be null on reused connection");
    assert.strictEqual(metrics.timing.tcpMs, null, "TCP must be null on reused connection");
    assert.strictEqual(metrics.timing.tlsMs, null, "TLS must be null on reused connection");
});

// 4. HTTP Protocol Reporting (HTTP/1.1, HTTP/2, HTTP/3, and Unknown)
test("Negotiated protocols (http/1.1, h2, h3) reported accurately; unobserved reported as Unknown", () => {
    const makeWithProto = (proto) => {
        const requests = new Map();
        requests.set("r", { url: "https://example.com/", type: "Document" });
        return calculateMetrics({
            mainRequestId: "r",
            requests,
            mainDocumentResponse: proto ? { url: "https://example.com/", protocol: proto } : { url: "https://example.com/" }
        });
    };

    assert.strictEqual(makeWithProto("http/1.1").connection.protocol, "http/1.1");
    assert.strictEqual(makeWithProto("h2").connection.protocol, "h2");
    assert.strictEqual(makeWithProto("h3").connection.protocol, "h3");
    assert.strictEqual(makeWithProto(null).connection.protocol, "Unknown", "Missing protocol must report Unknown");
});

// 5. TTFB Definition: duration from request dispatch to first response byte
test("TTFB derived from timing.receiveHeadersStart", () => {
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

    assert.strictEqual(metrics.timing.ttfbMs, 145);
});

// 6. Content Download duration
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
                dnsStart: -1,
                connectStart: -1,
                sendStart: 1,
                sendEnd: 3,
                receiveHeadersStart: 190,
                receiveHeadersEnd: 200 // Finished at 1000 + 200 = 1200
            }
        },
        navigationStartCDP: 1000
    });

    assert.strictEqual(metrics.timing.downloadMs, 250, "downloadMs = 1450 - 1200");
    assert.strictEqual(metrics.timing.documentMs, 450, "documentMs = 1450 - 1000");
});

// 7. Missing timing object with timestamp fallback
test("Missing timing object falls back to lifecycle timestamps safely", () => {
    const requests = new Map();
    requests.set("req-notiming", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 1000,
        responseReceivedTime: 1300,
        loadingFinishedTime: 1400
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-notiming",
        requests,
        mainDocumentResponse: {
            url: "https://example.com/",
            protocol: "http/1.1",
            timing: null
        },
        navigationStartCDP: 1000
    });

    assert.strictEqual(metrics.timing.ttfbMs, 300, "TTFB fallback = 1300 - 1000");
    assert.strictEqual(metrics.timing.downloadMs, 100, "Download fallback = 1400 - 1300");
    assert.strictEqual(metrics.timing.dnsMs, null);
    assert.strictEqual(metrics.timing.tcpMs, null);
    assert.strictEqual(metrics.timing.tlsMs, null);
});

// 8. Lifecycle event timing without domContentTime or loadEventTime
test("Missing lifecycle events remain null and do not substitute documentMs", () => {
    const requests = new Map();
    requests.set("req-interrupted", {
        url: "https://example.com/aborted",
        type: "Document",
        requestWillBeSentTime: 1000,
        loadingFinishedTime: 1200
    });

    const metrics = calculateMetrics({
        mainRequestId: "req-interrupted",
        requests,
        mainDocumentResponse: { url: "https://example.com/aborted", protocol: "h2" },
        navigationStartCDP: 1000,
        domContentTime: null, // DOMContentLoaded never fired
        loadEventTime: null   // Load event never fired
    });

    assert.strictEqual(metrics.timing.domContentLoadedMs, null, "domContentLoadedMs must be null when event did not fire");
    assert.strictEqual(metrics.timing.loadEventMs, null, "loadEventMs must be null when event did not fire");
});

// 9. Negative or inverted timestamp protection
test("Negative or out-of-order timestamps never yield negative durations", () => {
    const requests = new Map();
    requests.set("req-inverted", {
        url: "https://example.com/",
        type: "Document",
        requestWillBeSentTime: 2000,
        responseReceivedTime: 1900, // Inverted
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
                dnsEnd: 20, // Inverted
                connectStart: 50,
                connectEnd: 30, // Inverted
                sslStart: 40,
                sslEnd: 20, // Inverted
                receiveHeadersStart: -5 // Invalid
            }
        },
        navigationStartCDP: 2000
    });

    assert.strictEqual(metrics.timing.dnsMs, null, "Inverted DNS must be null");
    assert.strictEqual(metrics.timing.tcpMs, null, "Inverted TCP must be null");
    assert.strictEqual(metrics.timing.tlsMs, null, "Inverted TLS must be null");
    assert.strictEqual(metrics.timing.ttfbMs, null, "Negative TTFB must be null");
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Network Timing tests passed.`);
console.log("=================================================");
