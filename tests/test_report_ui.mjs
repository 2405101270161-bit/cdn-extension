/**
 * Goal 6: Report Generation & UI Presentation Regression Tests
 * Verifies structured 8-section report output, accurate metric representation,
 * missing value handling, browser vs CDN cache separation, sensitive data exclusion,
 * and robust handling of partial/empty analysis states.
 */

import { generateMarkdownReport, generateSanitizedJsonReport } from '../modules/report.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`  FAIL: ${message}`);
        failed++;
        throw new Error(message);
    } else {
        console.log(`  PASS: ${message}`);
        passed++;
    }
}

async function runTests() {
    console.log('=================================================');
    console.log('Test Suite: Report Generation & Result Clarity (Goal 6)');
    console.log('=================================================');

    // Test 1: Complete analysis produces all 8 required report sections
    {
        const mockData = {
            schemaVersion: 2,
            timestamp: '2026-10-14T10:00:00.000Z',
            requestedUrl: 'https://example.com/',
            finalUrl: 'https://example.com/',
            statusCode: 200,
            connection: {
                protocol: 'h2',
                remoteIp: '104.16.12.34',
                reused: false,
                compression: 'gzip'
            },
            cdn: {
                provider: 'Cloudflare',
                confidence: 'high',
                evidence: ['server: cloudflare', 'cf-ray: 8888-BOM'],
                edge: {
                    edgePop: 'BOM78-P3',
                    popCode: 'BOM'
                }
            },
            timing: {
                documentMs: 245,
                ttfbMs: 120,
                downloadMs: 125,
                dnsMs: 15,
                tcpMs: 40,
                tlsMs: 65,
                domContentLoadedMs: 450,
                loadEventMs: 800,
                networkIdleMs: 1200
            },
            transfer: {
                requestCount: 20,
                firstPartyCount: 15,
                thirdPartyCount: 5,
                cachedRequestCount: 4,
                serviceWorkerRequestCount: 0,
                failedRequestCount: 0,
                canceledRequestCount: 0,
                encodedBytes: 150000,
                decodedBytes: 450000
            },
            cdnByHost: {
                'example.com': { provider: 'Cloudflare', requestCount: 15, cdnCount: 15 },
                'static.example.com': { provider: 'Cloudflare', requestCount: 5, cdnCount: 5 }
            },
            cache: {
                documentSource: 'network',
                providerStatus: 'HIT',
                details: { policy: 'public, max-age=3600', ageSeconds: 120 }
            },
            tls: {
                available: true,
                version: 'TLS 1.3',
                cipher: 'TLS_AES_128_GCM_SHA256',
                issuer: 'DigiCert Global Root G2'
            },
            securityHeaders: {
                hsts: { present: true, value: 'max-age=31536000' },
                csp: { present: true, value: "default-src 'self'" },
                xFrameOptions: { present: true, value: 'DENY' },
                xContentTypeOptions: { present: true, value: 'nosniff' },
                referrerPolicy: { present: true, value: 'strict-origin-when-cross-origin' }
            },
            scoreDetails: {
                score: 95,
                grade: 'A+',
                breakdown: {
                    pageLoad: { score: 95, weight: 0.25 },
                    ttfb: { score: 98, weight: 0.25 },
                    cache: { score: 100, weight: 0.20 },
                    compression: { score: 90, weight: 0.15 },
                    security: { score: 92, weight: 0.15 }
                }
            },
            highlights: {
                largestResource: { url: 'https://example.com/bundle.js', bytes: 85000, durationMs: 90 },
                largestImage: { url: 'https://example.com/hero.webp', bytes: 45000, durationMs: 40 },
                largestJS: { url: 'https://example.com/bundle.js', bytes: 85000, durationMs: 90 },
                largestCSS: { url: 'https://example.com/style.css', bytes: 12000, durationMs: 25 },
                slowestResource: { url: 'https://example.com/api', bytes: 2000, durationMs: 220 }
            }
        };

        const report = generateMarkdownReport(mockData);

        assert(report.includes('## 1. Overall Summary'), 'Report contains Section 1: Overall Summary');
        assert(report.includes('## 2. CDN Detection and Supporting Evidence'), 'Report contains Section 2: CDN Evidence');
        assert(report.includes('## 3. Resource-Level Findings'), 'Report contains Section 3: Resource Findings');
        assert(report.includes('## 4. Network Timing and Performance Metrics'), 'Report contains Section 4: Network Timings');
        assert(report.includes('## 5. Browser-Cache and CDN-Cache Findings'), 'Report contains Section 5: Cache Findings');
        assert(report.includes('## 6. Compression and Security Findings'), 'Report contains Section 6: Compression & Security');
        assert(report.includes('## 7. Score Calculation & Component Breakdown'), 'Report contains Section 7: Score Calculation');
        assert(report.includes('## 8. Missing Measurements, Limitations, and Errors'), 'Report contains Section 8: Missing Measurements');
        assert(report.includes('Cloudflare'), 'Report references detected primary CDN provider');
        assert(report.includes('BOM78-P3'), 'Report displays edge node identifier');
        assert(report.includes('BOM (IATA Location Code)'), 'Report displays verified geographic PoP with IATA marker');
    }

    // Test 2: Unmeasured timings are reported as "Not Available" and never as "0 ms"
    {
        const partialData = {
            finalUrl: 'https://unmeasured.test/',
            timing: {
                documentMs: null,
                ttfbMs: undefined,
                dnsMs: null,
                tcpMs: null,
                tlsMs: null
            },
            connection: {
                reused: false
            }
        };

        const report = generateMarkdownReport(partialData);

        assert(report.includes('- **Main Document Fetch:** Not Available'), 'Null documentMs outputs "Not Available"');
        assert(report.includes('- **Full Time to First Byte (TTFB):** Not Available'), 'Undefined ttfbMs outputs "Not Available"');
        assert(report.includes('- **DNS Resolution:** Not Available'), 'Unmeasured DNS outputs "Not Available" instead of fake 0 ms');
        assert(report.includes('- **TCP Connection Establishment:** Not Available'), 'Unmeasured TCP outputs "Not Available"');
        assert(!report.includes('0 ms'), 'Report never replaces unmeasured timings with fabricated 0 ms');
    }

    // Test 3: Connection reuse is explicitly labeled in network timing
    {
        const reusedData = {
            finalUrl: 'https://reused.test/',
            connection: {
                reused: true
            },
            timing: {
                dnsMs: null,
                tcpMs: null,
                tlsMs: null
            }
        };

        const report = generateMarkdownReport(reusedData);

        assert(report.includes('Connection Reused (Bypassed)'), 'Reused connection phases are reported as Reused (Bypassed)');
        assert(report.includes('- **Connection Reused:** Yes (Subsequent socket reuse)'), 'Summary indicates socket reuse occurred');
    }

    // Test 4: Clear distinction between Browser-Cache and CDN-Cache
    {
        const cacheData = {
            finalUrl: 'https://cached.test/',
            cache: {
                documentSource: 'disk-cache',
                providerStatus: 'MISS'
            },
            transfer: {
                requestCount: 10,
                cachedRequestCount: 8,
                serviceWorkerRequestCount: 2
            }
        };

        const report = generateMarkdownReport(cacheData);

        assert(report.includes('- **Browser Delivery Source:** Browser Disk Cache'), 'Correctly identifies browser disk cache layer');
        assert(report.includes('- **CDN Edge Cache Status:** CDN MISS (Fetched from Origin)'), 'Correctly identifies edge cache status without conflation');
        assert(report.includes('- **Browser Cached Requests:** 8'), 'Accurately documents browser-cached request count');
        assert(report.includes('- **Service Worker Interceptions:** 2'), 'Accurately documents service worker interception count');
    }

    // Test 5: Sensitive headers and secrets are excluded from JSON report export
    {
        const sensitiveData = {
            targetUrl: 'https://secure.test/dashboard',
            headers: {
                'authorization': 'Bearer secret-jwt-token-12345',
                'cookie': 'session_id=supersecretcookie; uid=42',
                'set-cookie': 'secret_auth=9999; HttpOnly',
                'x-api-key': 'top-secret-api-key',
                'server': 'cloudflare',
                'content-type': 'application/json'
            },
            resourceEvidence: [
                {
                    url: 'https://secure.test/api/user',
                    headers: {
                        'authorization': 'Bearer secret-user-token',
                        'cookie': 'tracking=abc',
                        'x-amz-cf-id': 'xyz-edge-node'
                    }
                }
            ]
        };

        const jsonStr = generateSanitizedJsonReport(sensitiveData);
        const parsed = JSON.parse(jsonStr);

        assert(!jsonStr.includes('secret-jwt-token-12345'), 'JWT token is scrubbed from JSON export');
        assert(!jsonStr.includes('supersecretcookie'), 'Cookie value is scrubbed from JSON export');
        assert(!jsonStr.includes('top-secret-api-key'), 'API key is scrubbed from JSON export');
        assert(!jsonStr.includes('secret-user-token'), 'Resource-level authorization header is scrubbed');
        assert(parsed.headers.authorization === undefined, 'Scrubbed sensitive header authorization key is completely removed');
        assert(parsed.headers.cookie === undefined, 'Scrubbed cookie header key is completely removed');
        assert(parsed.headers.server === 'cloudflare', 'Safe diagnostic header (server) is preserved');
        assert(parsed.resourceEvidence[0].headers['x-amz-cf-id'] === 'xyz-edge-node', 'Safe CDN diagnostic header is preserved');
    }

    // Test 6: Resource-level accounting and host breakdown with partial data
    {
        const resourceData = {
            finalUrl: 'https://cdn-mixed.test/',
            transfer: {
                requestCount: 10
            },
            cdnByHost: {
                'cdn-mixed.test': { provider: 'Fastly', requestCount: 7, cdnCount: 7 },
                'api.cdn-mixed.test': { provider: 'Not Detected', requestCount: 3, cdnCount: 0 }
            }
        };

        const report = generateMarkdownReport(resourceData);

        assert(report.includes('7 of 10 requests (70%)'), 'CDN delivery ratio accurately calculated and formatted');
        assert(report.includes('cdn-mixed.test**: Fastly (7 requests)'), 'Host distribution lists Fastly host');
        assert(report.includes('api.cdn-mixed.test**: Not Detected (3 requests)'), 'Host distribution lists direct origin host');
    }

    // Test 7: Empty analysis state handled safely without errors
    {
        const emptyReport = generateMarkdownReport({});
        assert(typeof emptyReport === 'string' && emptyReport.length > 50, 'Empty data produces valid fallback report string');
        assert(emptyReport.includes('## 1. Overall Summary'), 'Fallback report contains Section 1');
        assert(emptyReport.includes('0 requests analyzed'), 'Empty resource list shows 0 requests analyzed');

        const emptyJson = generateSanitizedJsonReport({});
        assert(emptyJson === '{}', 'Empty data generates clean empty JSON');
    }

    // Test 8: Limitations and omissions are honestly surfaced in Section 8
    {
        const flawedData = {
            finalUrl: 'https://flawed.test/',
            timing: {
                dnsMs: null,
                tcpMs: null,
                tlsMs: null
            },
            connection: {
                reused: false
            },
            tls: {
                available: false
            },
            transfer: {
                failedRequestCount: 3
            }
        };

        const report = generateMarkdownReport(flawedData);

        assert(report.includes('DNS timing unmeasured'), 'Limitation section documents unmeasured DNS');
        assert(report.includes('TCP handshake unmeasured'), 'Limitation section documents unmeasured TCP');
        assert(report.includes('TLS handshake duration unobserved'), 'Limitation section documents unobserved TLS');
        assert(report.includes('3 network requests failed or were blocked'), 'Limitation section flags failed network requests');
    }

    console.log('=================================================');
    console.log(`Results: ${passed} of ${passed + failed} Goal 6 tests passed.`);
    console.log('=================================================');
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
