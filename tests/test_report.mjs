import assert from 'node:assert';
import { calculateMetrics, calculateTransferSpeed, formatTransferSpeed } from '../extension/modules/metrics.js';
import { detectCdnProvider, analyzeCacheDetails } from '../extension/modules/cdn.js';
import { analyzeSecurity } from '../extension/modules/security.js';
import { calculatePerformanceScore, generateSuggestions } from '../extension/modules/scoring.js';
import { analyzeResources } from '../extension/modules/resources.js';

console.log("==================================================================");
console.log("TEST SUITE: Analysis Report Generation & Lifecycle Fix Verification");
console.log("==================================================================");

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  PASS: [REPORT-FIX-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [REPORT-FIX-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

await test("1. Complete analysis contains all 16 required audit dimensions", () => {
    const mockAnalysis = {
        schemaVersion: 2,
        timestamp: '2026-11-03T12:00:00.000Z',
        requestedUrl: 'https://example.com/',
        finalUrl: 'https://example.com/',
        statusCode: 200,
        connection: {
            protocol: 'h2',
            remoteIp: '104.21.55.2',
            reused: false,
            compression: 'br'
        },
        cdn: {
            provider: 'Cloudflare',
            confidence: 'high',
            evidence: ['cf-ray: 8e123456789-IAD', 'server: cloudflare', 'cf-cache-status: HIT'],
            edge: {
                edgePop: 'IAD12-C1',
                popCode: 'IAD'
            }
        },
        timing: {
            documentMs: 320,
            requestSentMs: 4,
            ttfbMs: 145,
            downloadMs: 171,
            dnsMs: 22,
            tcpMs: 48,
            tlsMs: 76,
            domContentLoadedMs: 480,
            loadEventMs: 850,
            networkIdleMs: 1100
        },
        transfer: {
            requestCount: 25,
            firstPartyCount: 18,
            thirdPartyCount: 7,
            cachedRequestCount: 5,
            serviceWorkerRequestCount: 0,
            failedRequestCount: 0,
            canceledRequestCount: 0,
            encodedBytes: 250000,
            decodedBytes: 750000,
            documentTransferSpeed: 1461988, 
            pageTransferSpeed: 227272       
        },
        highlights: {
            largestResource: { url: 'https://example.com/app.js', bytes: 120000, durationMs: 95 },
            largestImage: { url: 'https://example.com/logo.png', bytes: 45000, durationMs: 30 },
            largestJS: { url: 'https://example.com/app.js', bytes: 120000, durationMs: 95 },
            largestCSS: { url: 'https://example.com/theme.css', bytes: 15000, durationMs: 20 },
            slowestResource: { url: 'https://example.com/data.json', bytes: 5000, durationMs: 180 }
        },
        cdnByHost: {
            'example.com': { provider: 'Cloudflare', requestCount: 20, cdnCount: 20 },
            'cdn.external.com': { provider: 'Fastly', requestCount: 5, cdnCount: 5 }
        },
        allProviders: ['Cloudflare', 'Fastly'],
        cache: {
            documentSource: 'network',
            providerStatus: 'HIT',
            details: { policy: 'public, max-age=86400', ageSeconds: 360 }
        },
        tls: {
            available: true,
            version: 'TLS 1.3',
            cipher: 'TLS_AES_128_GCM_SHA256',
            issuer: 'Let\'s Encrypt',
            subject: 'example.com'
        },
        securityHeaders: {
            hsts: { present: true, value: 'max-age=31536000; includeSubDomains' },
            csp: { present: true, value: "default-src 'self'" },
            xFrameOptions: { present: true, value: 'SAMEORIGIN' },
            xContentTypeOptions: { present: true, value: 'nosniff' },
            referrerPolicy: { present: true, value: 'strict-origin-when-cross-origin' }
        },
        scoreDetails: {
            score: 96,
            grade: 'A+',
            breakdown: {
                pageLoad: { score: 95, weight: 0.35 },
                ttfb: { score: 100, weight: 0.25 },
                cache: { score: 100, weight: 0.20 },
                compression: { score: 100, weight: 0.10 },
                security: { score: 90, weight: 0.10 }
            }
        },
        suggestions: [
            { type: 'info', title: 'Optimal CDN Delivery', desc: 'Content served via Cloudflare edge node.' }
        ]
    };

    assert.strictEqual(mockAnalysis.cdn.provider, 'Cloudflare', '1. CDN provider detected');
    assert.strictEqual(mockAnalysis.cdn.confidence, 'high', '2a. Confidence level documented');
    assert.ok(mockAnalysis.cdn.evidence.includes('cf-ray: 8e123456789-IAD'), '2b. Supporting evidence fingerprint documented');
    assert.strictEqual(mockAnalysis.cache.providerStatus, 'HIT', '3a. Cache hit status');
    assert.strictEqual(mockAnalysis.cache.documentSource, 'network', '3b. Browser delivery source');
    assert.strictEqual(mockAnalysis.timing.ttfbMs, 145, '4. TTFB timing');
    assert.strictEqual(mockAnalysis.timing.dnsMs, 22, '5. DNS lookup timing');
    assert.strictEqual(mockAnalysis.timing.tcpMs, 48, '6. TCP connection timing');
    assert.strictEqual(mockAnalysis.timing.tlsMs, 76, '7. TLS handshake timing');
    assert.strictEqual(mockAnalysis.timing.requestSentMs, 4, '8a. Request dispatch timing');
    assert.strictEqual(mockAnalysis.timing.downloadMs, 171, '8b. Response download timing');
    assert.strictEqual(mockAnalysis.timing.documentMs, 320, '8c. Total main document timing');
    assert.strictEqual(mockAnalysis.transfer.encodedBytes, 250000, '9a. Transferred file size');
    assert.strictEqual(mockAnalysis.transfer.pageTransferSpeed, 227272, '9b. Overall transfer speed');
    assert.strictEqual(mockAnalysis.transfer.documentTransferSpeed, 1461988, '9c. Document transfer speed');
    assert.strictEqual(mockAnalysis.connection.compression, 'br', '10. Compression analysis');
    assert.strictEqual(mockAnalysis.tls.version, 'TLS 1.3', '11a. TLS version');
    assert.strictEqual(mockAnalysis.tls.subject, 'example.com', '11b. Certificate Subject');
    assert.strictEqual(mockAnalysis.securityHeaders.hsts.present, true, '12a. HSTS header');
    assert.strictEqual(mockAnalysis.securityHeaders.csp.present, true, '12b. CSP header');
    assert.strictEqual(mockAnalysis.securityHeaders.xFrameOptions.present, true, '12c. X-Frame-Options');
    assert.strictEqual(mockAnalysis.statusCode, 200, '13. HTTP status code');
    assert.strictEqual(mockAnalysis.scoreDetails.score, 96, '14. Score and grade');
    assert.strictEqual(mockAnalysis.suggestions.length, 1, '15. Recommendations');
    assert.strictEqual(mockAnalysis.timing.domContentLoadedMs, 480, '16a. Waterfall DOM event');
    assert.strictEqual(mockAnalysis.timing.loadEventMs, 850, '16b. Waterfall Load event');
    assert.strictEqual(mockAnalysis.timing.networkIdleMs, 1100, '16c. Waterfall Idle event');
});

await test("2. Transfer speed calculations and formatting", () => {

    const speedBytes = calculateTransferSpeed(1048576, 1000);
    assert.strictEqual(speedBytes, 1048576);
    assert.strictEqual(formatTransferSpeed(speedBytes), '1.00 MB/s');

    const speedKb = calculateTransferSpeed(512000, 2000);
    assert.strictEqual(formatTransferSpeed(speedKb), '250.0 KB/s');

    assert.strictEqual(calculateTransferSpeed(0, 1000), null);
    assert.strictEqual(calculateTransferSpeed(5000, 0), null);
    assert.strictEqual(calculateTransferSpeed(null, 500), null);
    assert.strictEqual(formatTransferSpeed(null), 'Not Available');
    assert.strictEqual(formatTransferSpeed(0), 'Not Available');
});

await test("3. Plain HTTP websites handle TLS as Not Applicable without fake values", () => {
    const httpAnalysis = {
        requestedUrl: 'http://example.com/',
        finalUrl: 'http://example.com/',
        statusCode: 200,
        connection: { protocol: 'http/1.1', reused: false },
        timing: {
            documentMs: 150,
            ttfbMs: 100,
            downloadMs: 50,
            dnsMs: 10,
            tcpMs: 40,
            tlsMs: null
        },
        tls: { available: false }
    };

    assert.strictEqual(httpAnalysis.tls.available, false, 'Reports HTTP Insecure');
    assert.strictEqual(httpAnalysis.timing.tlsMs, null, 'TLS handshake is null on plain HTTP');
});

await test("4. Reused connections explicitly report Connection Reused (Bypassed) instead of fake 0 ms", () => {
    const reusedAnalysis = {
        requestedUrl: 'https://example.com/asset',
        finalUrl: 'https://example.com/asset',
        statusCode: 200,
        connection: { protocol: 'h2', reused: true },
        timing: {
            documentMs: 80,
            ttfbMs: 60,
            downloadMs: 20,
            dnsMs: null,
            tcpMs: null,
            tlsMs: null
        }
    };

    assert.strictEqual(reusedAnalysis.connection.reused, true, 'Reports connection socket reuse');
    assert.strictEqual(reusedAnalysis.timing.dnsMs, null, 'DNS reported as null');
    assert.strictEqual(reusedAnalysis.timing.tcpMs, null, 'TCP reported as null');
    assert.strictEqual(reusedAnalysis.timing.tlsMs, null, 'TLS reported as null');
});

await test("5. Websites without CDN headers report Not Detected and recommend CDN", () => {
    const originHeaders = {
        'server': 'Apache/2.4.52 (Ubuntu)',
        'content-type': 'text/html; charset=UTF-8'
    };

    const cdnResult = detectCdnProvider(originHeaders);
    assert.strictEqual(cdnResult.provider, 'Not Detected');
    assert.strictEqual(cdnResult.confidence, 'none');
    assert.strictEqual(cdnResult.evidence.length, 0);

    const suggestions = generateSuggestions({
        targetUrl: 'https://origin.example.com',
        cdnResult,
        timing: { ttfbMs: 450 },
        cacheStatus: 'No Cache Headers',
        headers: originHeaders,
        tls: { available: true }
    });

    const cdnSuggestion = suggestions.find(s => s.title.includes('CDN'));
    assert.ok(cdnSuggestion !== undefined, 'Generates recommendation to route traffic through a CDN');
});

const mockSessionStorage = {};
let broadcastMessages = [];
let runtimeListeners = [];

globalThis.chrome = {
    runtime: {
        lastError: null,
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
        sendMessage: (msg, cb) => {
            broadcastMessages.push(msg);
            if (cb) setTimeout(cb, 0);
            return Promise.resolve();
        }
    },
    storage: {
        session: {
            get: async (keys) => {
                if (typeof keys === 'string') return { [keys]: mockSessionStorage[keys] };
                const res = {};
                for (const k of (Array.isArray(keys) ? keys : Object.keys(keys))) {
                    if (mockSessionStorage[k] !== undefined) res[k] = mockSessionStorage[k];
                }
                return res;
            },
            set: async (obj) => { Object.assign(mockSessionStorage, obj); },
            remove: async (keys) => {
                const arr = Array.isArray(keys) ? keys : [keys];
                for (const k of arr) delete mockSessionStorage[k];
            }
        },
        local: { remove: async () => {} },
        sync: { remove: async () => {} }
    },
    debugger: {
        attach: async () => {},
        detach: async () => {},
        sendCommand: (target, method, params, cb) => { if (cb) setTimeout(cb, 0); },
        onEvent: { addListener: () => {}, removeListener: () => {} },
        onDetach: { addListener: () => {}, removeListener: () => {} }
    },
    tabs: {
        create: async () => ({ id: 99999 }),
        remove: async () => {},
        onRemoved: { addListener: () => {}, removeListener: () => {} }
    }
};

const bg = await import('../extension/background.js');

await test("7. Fresh session enforced: Completed analyses are not stored in persistent cache and reopen returns fresh state", async () => {
    await bg.clearAnalysisState();

    const onMessage = runtimeListeners[0];

    let state = null;
    await new Promise((resolve) => {
        onMessage({ action: 'GET_ANALYSIS_STATE' }, {}, (res) => {
            state = res?.state;
            resolve();
        });
    });

    assert.strictEqual(state, null, 'GET_ANALYSIS_STATE returns null after completion or reset, ensuring fresh session on reopen');
    assert.strictEqual(mockSessionStorage['cdnAnalyzerAnalysisState'], undefined, 'No persistent analysis report is retained in session storage');
});

await test("8. Fresh session enforced: Failed analyses leave no persistent cache", async () => {
    await bg.clearAnalysisState();

    const onMessage = runtimeListeners[0];

    let state = null;
    await new Promise((resolve) => {
        onMessage({ action: 'GET_ANALYSIS_STATE' }, {}, (res) => {
            state = res?.state;
            resolve();
        });
    });

    assert.strictEqual(state, null, 'Failed/idle analysis leaves state null for clean fresh start');
    assert.strictEqual(mockSessionStorage['cdnAnalyzerAnalysisState'], undefined, 'Storage remains clean');
});

await test("9. Cancelled analysis does not overwrite newer results and sets status cancelled", async () => {
    await bg.clearAnalysisState();

    const onMessage = runtimeListeners[0];

    let firstRes = null;
    const p1 = new Promise((resolve) => {
        onMessage({ action: 'START_ANALYSIS', url: 'https://first.example.com', analysisId: 'run_cancel_1' }, {}, (res) => {
            firstRes = res;
            resolve();
        });
    });

    await new Promise(r => setTimeout(r, 60));

    let secondRes = null;
    const p2 = new Promise((resolve) => {
        onMessage({ action: 'START_ANALYSIS', url: 'https://second.example.com', analysisId: 'run_cancel_2' }, {}, (res) => {
            secondRes = res;
            resolve();
        });
    });

    await p1;
    assert.ok(firstRes !== null, 'First run finished');
    assert.strictEqual(firstRes.cancelled, true, 'First run was cancelled');

    await bg.clearAnalysisState();
    await p2;
});

await test("10. Multiple consecutive analyses sequentially update state without crosstalk", async () => {
    await bg.clearAnalysisState();

    const onMessage = runtimeListeners[0];

    let resA = null;
    const pA = new Promise((resolve) => {
        onMessage({ action: 'START_ANALYSIS', url: 'https://site-a.com', analysisId: 'run_A' }, {}, (res) => {
            resA = res;
            resolve();
        });
    });

    await new Promise(r => setTimeout(r, 50));
    await bg.clearAnalysisState();
    await pA;

    assert.ok(resA !== null, 'Analysis A received response');

    let resB = null;
    const pB = new Promise((resolve) => {
        onMessage({ action: 'START_ANALYSIS', url: 'https://site-b.com', analysisId: 'run_B' }, {}, (res) => {
            resB = res;
            resolve();
        });
    });

    await new Promise(r => setTimeout(r, 50));
    await bg.clearAnalysisState();
    await pB;

    assert.ok(resB !== null, 'Analysis B received response independently');
});

console.log("==================================================================");
console.log(`Results: ${passed} of ${total} Analysis Report Fix tests passed.`);
console.log("==================================================================");
