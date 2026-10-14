/**
 * Test Suite: CDN Provider Detection
 * Tests supported CDN providers, header variations, edge cases, multi-CDN delivery,
 * and origin vs CDN resource scenarios.
 */

import assert from 'node:assert';
import {
    detectCdnProvider,
    detectResourceCdn,
    aggregateHostCdn,
    normalizeHeaders
} from '../modules/cdn.js';

console.log("=================================================");
console.log("Test Suite: CDN Provider Detection");
console.log("=================================================");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: [CDN-DET-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [CDN-DET-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// 1. Cloudflare Detection
test("Valid Cloudflare headers (cf-ray and server)", () => {
    const res = detectCdnProvider({
        'cf-ray': '8f3bc4928b971234-IAD',
        'server': 'cloudflare'
    });
    assert.strictEqual(res.provider, 'Cloudflare');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.evidence.some(e => e.includes('cf-ray')));
});

// 2. Cloudflare R2 Detection
test("Valid Cloudflare R2 headers (distinct from standard Cloudflare)", () => {
    const res = detectCdnProvider({
        'x-amz-meta-cf-r2-structure': '1',
        'server': 'cloudflare-r2'
    });
    assert.strictEqual(res.provider, 'Cloudflare R2');
    assert.strictEqual(res.confidence, 'high');
});

// 3. Amazon CloudFront Detection
test("Valid Amazon CloudFront headers (x-amz-cf-id, via, and x-amz-cf-pop)", () => {
    const res = detectCdnProvider({
        'x-amz-cf-id': 'xyz1234567890abcdef==',
        'x-amz-cf-pop': 'IAD89-C1',
        'via': '1.1 1234.cloudfront.net (CloudFront)'
    });
    assert.strictEqual(res.provider, 'Amazon CloudFront');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.evidence.some(e => e.includes('x-amz-cf-id')));
});

// 4. Fastly Detection
test("Valid Fastly headers (x-fastly-request-id and x-served-by)", () => {
    const res = detectCdnProvider({
        'x-fastly-request-id': 'abc123456789',
        'x-served-by': 'cache-iad-kiad12345-IAD',
        'via': '1.1 varnish'
    });
    assert.strictEqual(res.provider, 'Fastly');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.evidence.some(e => e.includes('x-fastly-request-id')));
});

// 5. Akamai Detection
test("Valid Akamai headers (akamai-grn and x-akamai-transformed)", () => {
    const res = detectCdnProvider({
        'akamai-grn': '0.12345.6789.abcdef',
        'x-akamai-transformed': '9 100 0 -',
        'server': 'AkamaiGHost'
    });
    assert.strictEqual(res.provider, 'Akamai');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.evidence.some(e => e.includes('akamai-grn') || e.includes('AkamaiGHost')));
});

// 6. Google Cloud CDN Detection
test("Valid Google Cloud CDN headers (x-goog-generation and via)", () => {
    const res = detectCdnProvider({
        'x-goog-generation': '1234567890',
        'via': '1.1 google',
        'server': 'UploadServer'
    });
    assert.strictEqual(res.provider, 'Google Cloud CDN');
    assert.strictEqual(res.confidence, 'high');
});

// 7. Microsoft Azure CDN / Front Door Detection
test("Valid Azure Front Door headers (x-azure-ref)", () => {
    const res = detectCdnProvider({
        'x-azure-ref': '0abcd1234efgh5678',
        'x-cache': 'TCP_HIT'
    });
    assert.strictEqual(res.provider, 'Azure CDN');
    assert.strictEqual(res.confidence, 'high');
});

// 8. Vercel Detection
test("Valid Vercel headers (x-vercel-id and x-vercel-cache)", () => {
    const res = detectCdnProvider({
        'x-vercel-id': 'iad1::iad1::12345-67890',
        'x-vercel-cache': 'HIT'
    });
    assert.strictEqual(res.provider, 'Vercel');
    assert.strictEqual(res.confidence, 'high');
});

// 9. Netlify Detection
test("Valid Netlify headers (x-nf-request-id and server)", () => {
    const res = detectCdnProvider({
        'x-nf-request-id': '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        'server': 'Netlify'
    });
    assert.strictEqual(res.provider, 'Netlify');
    assert.strictEqual(res.confidence, 'high');
});

// 10. BunnyCDN Detection
test("Valid BunnyCDN headers (b-ray and server)", () => {
    const res = detectCdnProvider({
        'b-ray': '123456-iad',
        'server': 'BunnyCDN-IL1'
    });
    assert.strictEqual(res.provider, 'BunnyCDN');
    assert.strictEqual(res.confidence, 'high');
});

// 11. Missing headers (empty headers object)
test("Missing headers safely yield Not Detected with none confidence", () => {
    const res = detectCdnProvider({});
    assert.strictEqual(res.provider, 'Not Detected');
    assert.strictEqual(res.confidence, 'none');
    assert.strictEqual(res.evidence.length, 0);
});

// 12. Case-insensitive header names
test("Case-insensitive header names (uppercase, mixed case)", () => {
    const res = detectCdnProvider({
        'CF-RAY': '99999999999-LHR',
        'SERVER': 'CLOUDFLARE',
        'CF-CACHE-STATUS': 'HIT'
    });
    assert.strictEqual(res.provider, 'Cloudflare');
    assert.strictEqual(res.confidence, 'high');
});

// 13. Malformed header values (empty strings, numbers, nulls)
test("Malformed header values do not crash or produce false positive detections", () => {
    const res = detectCdnProvider({
        'server': '',
        'via': null,
        'x-amz-cf-id': '',
        'cf-ray': '   ',
        'x-fastly-request-id': undefined
    });
    assert.strictEqual(res.provider, 'Not Detected');
    assert.strictEqual(res.confidence, 'none');
});

// 14. Ambiguous / multi-layer provider evidence (e.g. Vercel hosted behind Cloudflare proxy)
test("Ambiguous/conflicting multi-layer headers preserved in possibleLayers", () => {
    const res = detectCdnProvider({
        'cf-ray': '8f3bc4928b971234-IAD',
        'server': 'cloudflare',
        'x-vercel-id': 'iad1::iad1::12345-67890'
    });
    // Both providers have high evidence; primary is chosen deterministically and other is retained in possibleLayers
    assert.ok(res.provider === 'Cloudflare' || res.provider === 'Vercel');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.possibleLayers.length > 0, "Secondary layer must be tracked in possibleLayers");
});

// 15. Generic cache headers without CDN evidence
test("Generic Cache-Control and Expires headers do not produce a false CDN detection", () => {
    const res = detectCdnProvider({
        'server': 'Apache/2.4.52 (Ubuntu)',
        'cache-control': 'public, max-age=604800, immutable',
        'expires': 'Wed, 21 Oct 2026 07:28:00 GMT',
        'etag': '"33a64df551425fcc55e4d42a148795d9f25f89d4"'
    });
    assert.strictEqual(res.provider, 'Not Detected');
    assert.strictEqual(res.confidence, 'none');
});

// 16. Multiple CDN providers on the same website (Multi-CDN asset delivery)
test("Multiple CDN providers on same site grouped accurately by host", () => {
    const resources = [
        // Main page HTML from origin
        {
            url: 'https://example.com/',
            hostname: 'example.com',
            resourceType: 'Document',
            cdn: { provider: 'Not Detected', confidence: 'none', matchedEvidence: [] },
            edge: { edgePop: null, remoteIp: '192.0.2.1' },
            encodedDataLength: 15000
        },
        // Static assets from CloudFront
        {
            url: 'https://cdn.example.com/bundle.js',
            hostname: 'cdn.example.com',
            resourceType: 'Script',
            cdn: { provider: 'Amazon CloudFront', confidence: 'high', matchedEvidence: ['x-amz-cf-id'] },
            edge: { edgePop: 'IAD89-C1', remoteIp: '13.224.10.45' },
            encodedDataLength: 85000
        },
        // Images from Fastly
        {
            url: 'https://images.example.com/hero.png',
            hostname: 'images.example.com',
            resourceType: 'Image',
            cdn: { provider: 'Fastly', confidence: 'high', matchedEvidence: ['x-served-by'] },
            edge: { edgePop: 'cache-iad-kiad12345-IAD', remoteIp: '151.101.1.67' },
            encodedDataLength: 120000
        }
    ];

    const hostAnalysis = aggregateHostCdn(resources, 'https://example.com/');

    assert.strictEqual(hostAnalysis.allProviders.length, 2, "2 distinct CDNs detected across subdomains");
    assert.ok(hostAnalysis.allProviders.includes('Amazon CloudFront'));
    assert.ok(hostAnalysis.allProviders.includes('Fastly'));

    assert.strictEqual(hostAnalysis.byHost['example.com'].provider, 'Not Detected');
    assert.strictEqual(hostAnalysis.byHost['example.com'].isMainHost, true);
    assert.strictEqual(hostAnalysis.byHost['cdn.example.com'].provider, 'Amazon CloudFront');
    assert.strictEqual(hostAnalysis.byHost['images.example.com'].provider, 'Fastly');
});

// 17. HTML served directly while assets are served through CDN
test("HTML served directly from origin while scripts/images are CDN-served", () => {
    const htmlResource = detectResourceCdn({
        'server': 'nginx/1.22.0',
        'content-type': 'text/html'
    }, 'https://mysite.org/', 'Document', '203.0.113.10', 443);

    const jsResource = detectResourceCdn({
        'cf-ray': '8f3bc4928b971234-ORD',
        'server': 'cloudflare'
    }, 'https://assets.mysite.org/app.js', 'Script', '104.21.5.12', 443);

    assert.strictEqual(htmlResource.provider, 'Not Detected', "HTML document is origin-served");
    assert.strictEqual(jsResource.provider, 'Cloudflare', "JavaScript asset is CDN-served");
});

// 18. Domain name alone never implies a specific CDN (No hardcoded domain guesses)
test("Domain names alone (google.com, flipkart.com) never imply a CDN without headers", () => {
    const googleNoHeaders = detectCdnProvider({
        'server': 'gws',
        'content-type': 'text/html'
    });
    assert.strictEqual(googleNoHeaders.provider, 'Not Detected', "No assumption that google.com uses Google Cloud CDN");

    const flipkartNoHeaders = detectCdnProvider({
        'server': 'Apache',
        'content-type': 'text/html'
    });
    assert.strictEqual(flipkartNoHeaders.provider, 'Not Detected', "No assumption that flipkart.com uses a specific CDN");
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} CDN Provider Detection tests passed.`);
console.log("=================================================");
