import assert from 'node:assert';
import {
    detectCdnProvider,
    detectResourceCdn,
    aggregateHostCdn,
    normalizeHeaders,
    detectCdnFromCname,
    detectCdnFromIp,
    resolveDnsCname
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

test("Valid Cloudflare headers (cf-ray and server)", () => {
    const res = detectCdnProvider({
        'cf-ray': '8f3bc4928b971234-IAD',
        'server': 'cloudflare'
    });
    assert.strictEqual(res.provider, 'Cloudflare');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.evidence.some(e => e.includes('cf-ray')));
});

test("Valid Cloudflare R2 headers (distinct from standard Cloudflare)", () => {
    const res = detectCdnProvider({
        'x-amz-meta-cf-r2-structure': '1',
        'server': 'cloudflare-r2'
    });
    assert.strictEqual(res.provider, 'Cloudflare R2');
    assert.strictEqual(res.confidence, 'high');
});

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

test("Google edge + Cloud Storage headers are not reported as confirmed Google Cloud CDN", () => {
    const res = detectCdnProvider({
        'x-goog-generation': '1234567890',
        'via': '1.1 google',
        'server': 'UploadServer'
    });
    assert.strictEqual(res.provider, 'Google Front End', "GFE is the delivery edge");
    assert.strictEqual(res.status, 'network-only', "GFE evidence is edge ownership, not product-specific");
    assert.notStrictEqual(res.provider, 'Google Cloud CDN');
    assert.ok(res.possibleLayers.some(l => l.provider === 'Google Cloud Storage' && l.role === 'origin-storage'), "GCS recorded as origin storage");
    assert.ok(res.notes.some(n => n.includes('does not confirm the Google Cloud CDN')));
});

test("Valid Azure Front Door headers (x-azure-ref)", () => {
    const res = detectCdnProvider({
        'x-azure-ref': '0abcd1234efgh5678',
        'x-cache': 'TCP_HIT'
    });
    assert.strictEqual(res.provider, 'Azure CDN');
    assert.strictEqual(res.confidence, 'high');
});

test("Valid Vercel headers (x-vercel-id and x-vercel-cache)", () => {
    const res = detectCdnProvider({
        'x-vercel-id': 'iad1::iad1::12345-67890',
        'x-vercel-cache': 'HIT'
    });
    assert.strictEqual(res.provider, 'Vercel');
    assert.strictEqual(res.confidence, 'high');
});

test("Valid Netlify headers (x-nf-request-id and server)", () => {
    const res = detectCdnProvider({
        'x-nf-request-id': '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        'server': 'Netlify'
    });
    assert.strictEqual(res.provider, 'Netlify');
    assert.strictEqual(res.confidence, 'high');
});

test("Valid BunnyCDN headers (server banner and pull zone)", () => {
    const res = detectCdnProvider({
        'cdn-pullzone': '123456',
        'server': 'BunnyCDN-IL1'
    });
    assert.strictEqual(res.provider, 'BunnyCDN');
    assert.strictEqual(res.confidence, 'high');
});

test("Missing headers safely yield Not Detected with none confidence", () => {
    const res = detectCdnProvider({});
    assert.strictEqual(res.provider, 'Not Detected');
    assert.strictEqual(res.confidence, 'none');
    assert.strictEqual(res.evidence.length, 0);
});

test("Case-insensitive header names (uppercase, mixed case)", () => {
    const res = detectCdnProvider({
        'CF-RAY': '99999999999-LHR',
        'SERVER': 'CLOUDFLARE',
        'CF-CACHE-STATUS': 'HIT'
    });
    assert.strictEqual(res.provider, 'Cloudflare');
    assert.strictEqual(res.confidence, 'high');
});

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

test("Ambiguous/conflicting multi-layer headers preserved in possibleLayers", () => {
    const res = detectCdnProvider({
        'cf-ray': '8f3bc4928b971234-IAD',
        'server': 'cloudflare',
        'x-vercel-id': 'iad1::iad1::12345-67890'
    });

    assert.ok(res.provider === 'Cloudflare' || res.provider === 'Vercel');
    assert.strictEqual(res.confidence, 'high');
    assert.ok(res.possibleLayers.length > 0, "Secondary layer must be tracked in possibleLayers");
});

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

test("Multiple CDN providers on same site grouped accurately by host", () => {
    const resources = [

        {
            url: 'https://example.com/',
            hostname: 'example.com',
            resourceType: 'Document',
            cdn: { provider: 'Not Detected', confidence: 'none', matchedEvidence: [] },
            edge: { edgePop: null, remoteIp: '192.0.2.1' },
            encodedDataLength: 15000
        },

        {
            url: 'https://cdn.example.com/bundle.js',
            hostname: 'cdn.example.com',
            resourceType: 'Script',
            cdn: { provider: 'Amazon CloudFront', confidence: 'high', matchedEvidence: ['x-amz-cf-id'] },
            edge: { edgePop: 'IAD89-C1', remoteIp: '13.224.10.45' },
            encodedDataLength: 85000
        },

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

test("DNS CNAME detection detects CDN with medium confidence", () => {
    const cnameRes = detectCdnFromCname(['cdn.example.com.cdn.cloudflare.net']);
    assert.ok(cnameRes !== null);
    assert.strictEqual(cnameRes.provider, 'Cloudflare');
    assert.strictEqual(cnameRes.confidence, 'medium');

    const fastlyCname = detectCdnFromCname(['dualstack.f.ssl.fastly.net']);
    assert.ok(fastlyCname !== null);
    assert.strictEqual(fastlyCname.provider, 'Fastly');
});

test("IP ownership fallback detects CDN with low confidence", () => {
    const cfIp = detectCdnFromIp('104.21.5.12');
    assert.ok(cfIp !== null);
    assert.strictEqual(cfIp.provider, 'Cloudflare');
    assert.strictEqual(cfIp.confidence, 'low');

    const fastlyIp = detectCdnFromIp('151.101.65.140');
    assert.ok(fastlyIp !== null);
    assert.strictEqual(fastlyIp.provider, 'Fastly');
    assert.strictEqual(fastlyIp.confidence, 'low');

    const unknownIp = detectCdnFromIp('1.1.1.1');
    assert.strictEqual(unknownIp, null);
});

test("Evidence hierarchy prioritizes headers over CNAME and CNAME over IP", () => {
    const headerOverride = detectCdnProvider({
        'cf-ray': '123456789-IAD',
        'server': 'cloudflare'
    }, {
        cnames: ['d123.cloudfront.net'],
        remoteIp: '151.101.1.1'
    });
    assert.strictEqual(headerOverride.provider, 'Cloudflare', "Headers take primary precedence");
    assert.strictEqual(headerOverride.confidence, 'high');
    assert.strictEqual(headerOverride.detectionMethod, 'response-header-inspection');
    assert.ok(headerOverride.possibleLayers.some(l => l.provider === 'Amazon CloudFront'), "CNAME preserved in possible layers");

    const cnameFallback = detectCdnProvider({
        'server': 'nginx'
    }, {
        cnames: ['my-app.b-cdn.net'],
        remoteIp: '104.16.1.1'
    });
    assert.strictEqual(cnameFallback.provider, 'BunnyCDN', "CNAME takes secondary precedence over IP");
    assert.strictEqual(cnameFallback.confidence, 'medium');
    assert.strictEqual(cnameFallback.detectionMethod, 'dns-cname-inspection');
    assert.ok(cnameFallback.possibleLayers.some(l => l.provider === 'Cloudflare'), "IP fallback preserved in possible layers");

    const ipFallback = detectCdnProvider({
        'server': 'Apache'
    }, {
        remoteIp: '104.16.10.20'
    });
    assert.strictEqual(ipFallback.provider, 'Cloudflare', "IP fallback works when headers and CNAME missing");
    assert.strictEqual(ipFallback.confidence, 'low');
    assert.strictEqual(ipFallback.detectionMethod, 'ip-range-fallback');
});

test("DNS CNAME resolution gracefully handles invalid hostnames and network errors", async () => {
    const invalidRes = await resolveDnsCname('invalid hostname with spaces');
    assert.strictEqual(invalidRes, null, "Invalid host safely returns null");

    const localhostRes = await resolveDnsCname('localhost');
    assert.strictEqual(localhostRes, null, "Localhost safely returns null");
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} CDN Provider Detection tests passed.`);
console.log("=================================================");
