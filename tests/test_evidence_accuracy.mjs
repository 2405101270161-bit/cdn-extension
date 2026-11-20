import assert from 'node:assert';
import {
    detectCdnProvider,
    detectResourceCdn,
    aggregateHostCdn,
    analyzeCacheDetails,
    detectCdnFromCname,
    detectCdnFromIp,
    resolveDnsCname,
    resolveHostCnames,
    parseIp,
    ipInCidr,
    extractEdgeEvidence
} from '../extension/modules/cdn.js';
import { calculateMetrics } from '../extension/modules/metrics.js';
import { calculatePerformanceScore, generateSuggestions } from '../extension/modules/scoring.js';
import { FIXTURES } from './fixtures/provider_fixtures.mjs';

console.log("=================================================");
console.log("Test Suite: Evidence Accuracy & False-Positive Controls");
console.log("=================================================");

let passed = 0;
let total = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

/* ── 1. Unknown ≠ direct origin ───────────────────────────────────────────── */
test("No signature yields 'unidentified' status with an explicit not-origin-proof note", () => {
    const res = detectCdnProvider({ server: 'nginx', 'content-type': 'text/html' });
    assert.strictEqual(res.provider, 'Not Detected');
    assert.strictEqual(res.status, 'unidentified');
    assert.ok(res.notes.some(n => /does not prove/i.test(n)));
    assert.ok(res.limitations.length >= 5, "Known limitations attached");
});

test("Recommendations never claim direct-origin delivery for an unidentified CDN", () => {
    const s = generateSuggestions({ cdnResult: { provider: 'Not Detected', status: 'unidentified' }, headers: {}, timing: {} });
    const cdnSuggestion = s.find(x => x.title === 'No CDN Signature Identified');
    assert.ok(cdnSuggestion);
    assert.strictEqual(cdnSuggestion.type, 'low');
    assert.ok(/does not prove/i.test(cdnSuggestion.desc));
});

test("Missing main document produces a single capture warning instead of header advice", () => {
    const s = generateSuggestions({ cdnResult: null, headers: {}, timing: {}, mainDocumentCaptured: false });
    assert.strictEqual(s.length, 1);
    assert.ok(/not captured/i.test(s[0].title));
});

/* ── 2. Generic headers are never high-confidence proof ───────────────────── */
for (const [label, headers] of [
    ['x-edge-location alone', { 'x-edge-location': 'usla' }],
    ['cdn-cache alone', { 'cdn-cache': 'HIT' }],
    ['x-check-cacheable alone', { 'x-check-cacheable': 'YES' }],
    ['x-cache TCP_HIT alone', { 'x-cache': 'TCP_HIT' }],
    ['x-cache-remote without Akamai host', { 'x-cache-remote': 'TCP_MISS' }],
    ['x-served-by non-Fastly value', { 'x-served-by': 'web-01' }],
    ['generic varnish via', { via: '1.1 varnish (Varnish/7.1)' }]
]) {
    test(`Generic header does not create a detection: ${label}`, () => {
        const res = detectCdnProvider(headers);
        assert.strictEqual(res.provider, 'Not Detected', JSON.stringify(res.evidence));
    });
}

test("Storage headers identify storage, never a CDN (GCS, S3, OSS, Azure Blob)", () => {
    for (const [headers, expected] of [
        [{ 'x-goog-generation': '1' }, 'Google Cloud Storage'],
        [{ server: 'AmazonS3', 'x-amz-id-2': 'abc' }, 'Amazon S3'],
        [{ 'x-oss-request-id': 'abc' }, 'Alibaba Cloud OSS'],
        [{ 'x-ms-blob-type': 'BlockBlob' }, 'Azure Blob Storage']
    ]) {
        const res = detectCdnProvider(headers);
        assert.strictEqual(res.provider, expected);
        assert.strictEqual(res.category, 'storage');
    }
});

test("CloudFront in front of S3: CloudFront is the delivery layer, S3 the origin", () => {
    const res = detectCdnProvider({ 'x-amz-cf-id': 'abc', 'x-amz-cf-pop': 'BOM78-P3', server: 'AmazonS3' });
    assert.strictEqual(res.provider, 'Amazon CloudFront');
    assert.ok(res.possibleLayers.some(l => l.provider === 'Amazon S3' && l.role === 'origin-storage'));
});

/* ── 3. Google edge vs Google Cloud CDN ───────────────────────────────────── */
test("via: 1.1 google alone is Google Front End (network-only), never Google Cloud CDN", () => {
    const res = detectCdnProvider({ via: '1.1 google' });
    assert.strictEqual(res.provider, 'Google Front End');
    assert.strictEqual(res.status, 'network-only');
    assert.strictEqual(res.confidence, 'medium');
});

test("server: gws (google.com) is not treated as a CDN", () => {
    assert.strictEqual(detectCdnProvider({ server: 'gws' }).provider, 'Not Detected');
});

/* ── 4. Aggregation and conflicts ─────────────────────────────────────────── */
test("Cloudflare in front of Vercel: IP owner decides the outer layer and conflict is reported", () => {
    const res = detectCdnProvider({ 'cf-ray': 'abc-BOM', 'x-vercel-id': 'bom1::xyz' }, { remoteIp: '104.16.1.1' });
    assert.strictEqual(res.provider, 'Cloudflare');
    assert.strictEqual(res.conflict, true);
    assert.ok(res.notes[0].includes('owns the connected IP'));
    assert.ok(res.possibleLayers.some(l => l.provider === 'Vercel'));
});

test("GitHub Pages served through Fastly reports Fastly with GitHub Pages as a layer", () => {
    const res = detectCdnProvider({ server: 'GitHub.com', 'x-github-request-id': 'A:B', 'x-fastly-request-id': 'f00', 'x-served-by': 'cache-bom4741-BOM' });
    assert.strictEqual(res.provider, 'Fastly');
    assert.ok(res.possibleLayers.some(l => l.provider === 'GitHub Pages'));
});

test("Header + CNAME agreement upgrades medium evidence to high", () => {
    const res = detectCdnProvider({ via: '1.1 abc.fastly (fastly)' }, { cnames: ['dualstack.n.sni.global.fastly.net'] });
    assert.strictEqual(res.provider, 'Fastly');
    assert.strictEqual(res.confidence, 'high');
    assert.deepStrictEqual(res.evidenceDetails.map(e => e.source).sort(), ['dns-cname', 'response-header']);
});

test("Every evidence item is explainable (provider, source, key, value, strength, scope, hostname)", () => {
    const res = detectResourceCdn({ 'cf-ray': '8f-BOM' }, 'https://static.example.org/a.js', 'Script', '104.16.2.2', 443, { cnames: ['static.example.org.cdn.cloudflare.net'] });
    assert.ok(res.evidenceDetails.length >= 3);
    for (const ev of res.evidenceDetails) {
        for (const field of ['provider', 'source', 'key', 'matchedValue', 'strength', 'productSpecific', 'hostname']) {
            assert.ok(field in ev, `missing ${field}`);
        }
        assert.strictEqual(ev.hostname, 'static.example.org');
    }
    const ipEv = res.evidenceDetails.find(e => e.source === 'ip-range');
    assert.strictEqual(ipEv.productSpecific, false, "IP ownership is never product-specific");
});

test("IP ownership alone is low confidence, network-only, and cites its data source", () => {
    const res = detectCdnProvider({}, { remoteIp: '151.101.1.1' });
    assert.strictEqual(res.provider, 'Fastly');
    assert.strictEqual(res.confidence, 'low');
    assert.strictEqual(res.status, 'network-only');
    assert.ok(/api\.fastly\.com\/public-ip-list/.test(res.evidenceDetails[0].note));
});

/* ── 5. CNAME and IP intelligence correctness ─────────────────────────────── */
test("DNS-only and mis-attributed CNAMEs are corrected", () => {
    assert.strictEqual(detectCdnFromCname(['myapp.trafficmanager.net']), null, "Traffic Manager is DNS routing, not a CDN");
    assert.strictEqual(detectCdnFromCname(['www.example.com.wscdns.com']).provider, 'Wangsu / CDNetworks', "wscdns.com is Wangsu, not Alibaba");
    assert.strictEqual(detectCdnFromCname(['kunlunfake.com']), null, "Loose kunlun* wildcard removed");
    assert.strictEqual(detectCdnFromCname(['site.googledomains.com']), null, "Registrar domain is not a CDN");
    assert.strictEqual(detectCdnFromCname(['e1234.a.akamaiedge.net']).provider, 'Akamai');
    assert.strictEqual(detectCdnFromCname(['www.example.com.edgekey.net']).provider, 'Akamai');
});

test("IPv6 CIDR matching is exact (including /29 and /31 ranges)", () => {
    assert.strictEqual(detectCdnFromIp('2400:cb00:2049::1').provider, 'Cloudflare', "2400:cb00::/32 was previously missing");
    assert.strictEqual(detectCdnFromIp('2a06:98c7::1').provider, 'Cloudflare', "Inside 2a06:98c0::/29");
    assert.strictEqual(detectCdnFromIp('2a06:98c8::1'), null, "Outside 2a06:98c0::/29");
    assert.strictEqual(detectCdnFromIp('2a04:4e43::1').provider, 'Fastly', "Inside 2a04:4e42::/31");
    assert.strictEqual(detectCdnFromIp('[2606:4700::6810:84e5]').provider, 'Cloudflare', "Bracketed IPv6 accepted");
    assert.strictEqual(detectCdnFromIp('::ffff:104.16.1.1') , null, "IPv4-mapped IPv6 is not compared against IPv4 ranges");
});

test("Fastly IPv4 list matches the published /17, not a broader /16", () => {
    assert.strictEqual(detectCdnFromIp('146.75.10.1').provider, 'Fastly');
    assert.strictEqual(detectCdnFromIp('146.75.200.1'), null);
});

test("IP parser rejects malformed input", () => {
    for (const bad of ['', '1.2.3', '256.1.1.1', '1.2.3.4.5', 'abcd', '1::2::3', 'g::1']) {
        assert.strictEqual(parseIp(bad), null, bad);
    }
    assert.ok(ipInCidr(parseIp('10.0.0.1'), '0.0.0.0/0'));
});

/* ── 6. Cache layers and policy ───────────────────────────────────────────── */
test("Multiple cache-layer headers are all preserved", () => {
    const r = analyzeCacheDetails({ 'cf-cache-status': 'HIT', 'x-cache': 'Miss from cloudfront', 'x-vercel-cache': 'MISS' });
    assert.strictEqual(r.cdnCache.layers.length, 3);
    assert.strictEqual(r.cdnCache.status, 'HIT', "Highest-priority layer is the summary");
    assert.deepStrictEqual(r.cdnCache.layers.map(l => l.status), ['HIT', 'MISS', 'MISS']);
});

test("Multi-tier X-Cache uses the tier closest to the visitor", () => {
    assert.strictEqual(analyzeCacheDetails({ 'x-cache': 'MISS, HIT' }).cdnCache.status, 'HIT');
    assert.strictEqual(analyzeCacheDetails({ 'x-cache': 'HIT, MISS' }).cdnCache.status, 'MISS');
    assert.strictEqual(analyzeCacheDetails({ 'x-cache': 'RefreshHit from cloudfront' }).cdnCache.status, 'REVALIDATED');
    assert.strictEqual(analyzeCacheDetails({ 'x-cache-hits': '0, 3' }).cdnCache.status, 'HIT');
});

test("RFC 9211 Cache-Status header is parsed", () => {
    assert.strictEqual(analyzeCacheDetails({ 'cache-status': '"Netlify Edge"; hit' }).cdnCache.status, 'HIT');
    assert.strictEqual(analyzeCacheDetails({ 'cache-status': '"Netlify Edge"; fwd=miss' }).cdnCache.status, 'MISS');
    assert.strictEqual(analyzeCacheDetails({ 'cache-status': 'ExampleCache; fwd=bypass' }).cdnCache.status, 'BYPASS');
});

test("no-store, no-cache and private are interpreted separately", () => {
    const ns = analyzeCacheDetails({ 'cache-control': 'no-store' });
    const nc = analyzeCacheDetails({ 'cache-control': 'no-cache' });
    const pv = analyzeCacheDetails({ 'cache-control': 'private, max-age=600' });
    const ma0 = analyzeCacheDetails({ 'cache-control': 'max-age=0' });
    assert.strictEqual(ns.policy.status, 'Not Cacheable');
    assert.strictEqual(nc.policy.status, 'Revalidate Required');
    assert.strictEqual(pv.policy.status, 'Private Cacheable', "private overrides max-age for shared caches");
    assert.strictEqual(pv.policy.sharedCacheable, false);
    assert.strictEqual(ma0.policy.status, 'Revalidate Required');
    assert.ok(ns.policy.noStore && !ns.policy.noCache);
    assert.ok(nc.policy.noCache && !nc.policy.noStore);
});

test("Cloudflare DYNAMIC and BYPASS remain distinct and score differently", () => {
    assert.strictEqual(analyzeCacheDetails({ 'cf-cache-status': 'DYNAMIC' }).summary, 'DYNAMIC');
    assert.strictEqual(analyzeCacheDetails({ 'cf-cache-status': 'BYPASS' }).summary, 'BYPASS');
    const d = calculatePerformanceScore({ isHttps: true, cacheStatus: 'DYNAMIC' }).components.cache;
    const b = calculatePerformanceScore({ isHttps: true, cacheStatus: 'BYPASS' }).components.cache;
    assert.notStrictEqual(d, b);
});

/* ── 7. Host aggregation & document vs asset providers ────────────────────── */
test("Per-host aggregation counts identified requests and separates document from asset providers", () => {
    const resources = [
        { url: 'https://site.org/', hostname: 'site.org', resourceType: 'Document', cdn: { provider: 'Not Detected', confidence: 'none' } },
        { url: 'https://cdn.site.org/a.js', hostname: 'cdn.site.org', resourceType: 'Script', cdn: { provider: 'Amazon CloudFront', confidence: 'high', status: 'identified', matchedEvidence: ['x-amz-cf-id'] } },
        { url: 'https://cdn.site.org/b.js', hostname: 'cdn.site.org', resourceType: 'Script', cdn: { provider: 'Amazon CloudFront', confidence: 'high', status: 'identified', matchedEvidence: ['x-amz-cf-id'] } },
        { url: 'https://cdn.site.org/c.js', hostname: 'cdn.site.org', resourceType: 'Script', cdn: { provider: 'Cloudflare', confidence: 'low', status: 'network-only', matchedEvidence: ['remote-ip'] } },
        { url: 'https://img.site.org/x.png', hostname: 'img.site.org', resourceType: 'Image', cdn: { provider: 'Fastly', confidence: 'high', status: 'identified' } }
    ];
    const agg = aggregateHostCdn(resources, 'https://site.org/');
    assert.strictEqual(agg.byHost['cdn.site.org'].cdnCount, 3);
    assert.strictEqual(agg.byHost['cdn.site.org'].provider, 'Amazon CloudFront', "Strongest confidence wins, not first seen");
    assert.deepStrictEqual(Object.keys(agg.byHost['cdn.site.org'].providerCounts).sort(), ['Amazon CloudFront', 'Cloudflare']);
    assert.strictEqual(agg.delivery.documentProvider, 'Not Detected');
    assert.strictEqual(agg.delivery.assetProviders[0].provider, 'Amazon CloudFront');
    assert.strictEqual(agg.delivery.identifiedRequestCount, 4);
    assert.strictEqual(agg.delivery.unidentifiedRequestCount, 1);
});

/* ── 8. DNS resolution: chain, dedupe, concurrency, budget, cancellation ───── */
function fakeFetchFactory({ delayMs = 5, answers = {}, tracker = {} } = {}) {
    tracker.inFlight = 0; tracker.maxInFlight = 0; tracker.calls = [];
    return (url, { signal } = {}) => new Promise((resolve, reject) => {
        const name = new URL(url).searchParams.get('name');
        tracker.calls.push(name);
        tracker.inFlight++; tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight);
        const t = setTimeout(() => {
            tracker.inFlight--;
            resolve({ ok: true, json: async () => ({ Answer: answers[name] || [] }) });
        }, delayMs);
        signal?.addEventListener('abort', () => { clearTimeout(t); tracker.inFlight--; reject(new Error('aborted')); });
    });
}

test("CNAME chain is read from the A-record answer section", async () => {
    const res = await resolveDnsCname('www.example.org', {
        fetch: fakeFetchFactory({ answers: { 'www.example.org': [
            { type: 5, data: 'www.example.org.edgekey.net.' },
            { type: 5, data: 'e1.a.akamaiedge.net.' },
            { type: 1, data: '23.1.1.1' }
        ] } })
    });
    assert.deepStrictEqual(res.cnames, ['www.example.org.edgekey.net', 'e1.a.akamaiedge.net']);
});

test("Host resolution deduplicates, respects concurrency and host caps", async () => {
    const tracker = {};
    const hosts = [];
    for (let i = 0; i < 40; i++) hosts.push(`h${i}.example.org`, `H${i}.EXAMPLE.org.`);
    hosts.push('localhost', '10.0.0.1', 'printer.local');
    const out = await resolveHostCnames(hosts, { concurrency: 4, maxHosts: 25, budgetMs: 5000, fetch: fakeFetchFactory({ tracker }) });
    assert.strictEqual(out.attempted, 25);
    assert.strictEqual(out.skipped.length, 15);
    assert.ok(tracker.maxInFlight <= 4, `max in flight ${tracker.maxInFlight}`);
    assert.strictEqual(new Set(tracker.calls).size, tracker.calls.length, "Each host queried once");
    assert.ok(!tracker.calls.includes('localhost') && !tracker.calls.includes('printer.local'));
});

test("Host resolution stops at the time budget and on cancellation", async () => {
    const slow = fakeFetchFactory({ delayMs: 500 });
    const t0 = Date.now();
    const out = await resolveHostCnames(['a.example.org', 'b.example.org', 'c.example.org'], { concurrency: 1, budgetMs: 120, timeoutMs: 2000, fetch: slow });
    assert.ok(Date.now() - t0 < 450, "Budget enforced");
    assert.strictEqual(out.timedOut, true);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const t1 = Date.now();
    const out2 = await resolveHostCnames(['d.example.org', 'e.example.org'], { concurrency: 1, budgetMs: 5000, signal: controller.signal, fetch: slow });
    assert.ok(Date.now() - t1 < 450, "Cancellation enforced");
    assert.strictEqual(out2.cancelled, true);
    assert.strictEqual(out2.timedOut, false);
});

/* ── 9. Timing & score completeness ───────────────────────────────────────── */
test("TTFB is unavailable when send markers are missing even if header markers exist", () => {
    const requests = new Map([['r', { url: 'https://a.org/', type: 'Document', requestWillBeSentTime: 1000, responseReceivedTime: 1300, loadingFinishedTime: 1400 }]]);
    const m = calculateMetrics({
        mainRequestId: 'r', requests, navigationStartCDP: 1000,
        mainDocumentResponse: { url: 'https://a.org/', timing: { requestTime: 1, dnsStart: -1, dnsEnd: -1, connectStart: -1, connectEnd: -1, sslStart: -1, sslEnd: -1, sendStart: -1, sendEnd: -1, receiveHeadersStart: 250, receiveHeadersEnd: 260 } }
    });
    assert.strictEqual(m.timing.ttfbMs, null);
    assert.ok(/missing/i.test(m.timing.ttfbUnavailableReason));
});

test("Score reports missing components as null and flags insufficient data", () => {
    const s = calculatePerformanceScore({ isHttps: true, timing: { ttfbMs: 100 } });
    assert.strictEqual(s.components.pageLoad, null);
    assert.strictEqual(s.components.cache, null);
    assert.deepStrictEqual(s.missingComponents.sort(), ['cache', 'compression', 'pageLoad']);
    assert.strictEqual(s.insufficientData, true, "35% of weight is not enough for a full score");
    const full = calculatePerformanceScore({ isHttps: true, timing: { ttfbMs: 100, loadEventMs: 900 }, cacheStatus: 'HIT', compression: 'br' });
    assert.strictEqual(full.insufficientData, false);
    assert.strictEqual(full.missingComponents.length, 0);
});

test("Edge PoP comes from the identified provider, not another layer's header", () => {
    const headers = { 'cf-ray': '8f00-BOM', 'x-vercel-id': 'iad1::sanitized' };
    assert.strictEqual(extractEdgeEvidence(headers, 'Cloudflare').popCode, 'BOM');
    assert.strictEqual(extractEdgeEvidence(headers, 'Vercel').popCode, 'IAD');
});

/* ── 10. Representative header fixtures ───────────────────────────────────── */
for (const fx of FIXTURES) {
    test(`Fixture: ${fx.name}`, () => {
        const res = detectCdnProvider(fx.headers, fx.options || {});
        assert.strictEqual(res.provider, fx.expect.provider, JSON.stringify(res.evidence));
        if (fx.expect.confidence) assert.strictEqual(res.confidence, fx.expect.confidence);
        if (fx.expect.status) assert.strictEqual(res.status, fx.expect.status);
        if (fx.expect.cache) assert.strictEqual(analyzeCacheDetails(fx.headers).cdnCache.status, fx.expect.cache);
    });
}

for (const { name, fn } of queue) {
    total++;
    try {
        await fn();
        console.log(`  PASS: [EVID-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [EVID-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Evidence Accuracy tests passed.`);
console.log("=================================================");
