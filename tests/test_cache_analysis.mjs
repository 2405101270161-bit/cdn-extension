import assert from 'node:assert';
import { analyzeCacheDetails, extractCacheStatus } from '../extension/modules/cdn.js';

console.log("=================================================");
console.log("Test Suite: Cache Analysis");
console.log("=================================================");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  PASS: [CACHE-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [CACHE-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

test("Browser disk cache evidence identified without false CDN HIT attribution", () => {
    const res = analyzeCacheDetails({
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'max-age=3600'
    }, {
        fromDiskCache: true,
        fromMemoryCache: false,
        fromServiceWorker: false
    });

    assert.strictEqual(res.browserCache.servedFromCache, true);
    assert.strictEqual(res.browserCache.type, 'disk');
    assert.strictEqual(res.cdnCache.status, 'NONE');
    assert.strictEqual(res.summary, 'Disk Cache');
});

test("Browser memory cache evidence identified from CDP flags", () => {
    const res = analyzeCacheDetails({
        'content-type': 'application/javascript'
    }, {
        fromDiskCache: false,
        fromMemoryCache: true,
        fromServiceWorker: false
    });

    assert.strictEqual(res.browserCache.servedFromCache, true);
    assert.strictEqual(res.browserCache.type, 'memory');
    assert.strictEqual(res.cdnCache.status, 'NONE');
    assert.strictEqual(res.summary, 'Memory Cache');
});

test("Service worker fulfilled response is not classified as CDN cache HIT", () => {
    const res = analyzeCacheDetails({
        'content-type': 'text/html'
    }, {
        fromDiskCache: false,
        fromMemoryCache: false,
        fromServiceWorker: true
    });

    assert.strictEqual(res.serviceWorker.fulfilledByServiceWorker, true);
    assert.strictEqual(res.cdnCache.status, 'NONE', "Must not classify SW response as CDN cache");
    assert.strictEqual(res.summary, 'Service Worker');
});

test("CDN cache HIT extracted from provider headers", () => {
    const cf = analyzeCacheDetails({ 'cf-cache-status': 'HIT' });
    assert.strictEqual(cf.cdnCache.status, 'HIT');
    assert.strictEqual(cf.cdnCache.header, 'cf-cache-status');
    assert.strictEqual(cf.summary, 'HIT');

    const cfront = analyzeCacheDetails({ 'x-cache': 'Hit from cloudfront' });
    assert.strictEqual(cfront.cdnCache.status, 'HIT');
    assert.strictEqual(cfront.cdnCache.header, 'x-cache');
    assert.strictEqual(cfront.summary, 'HIT');

    const vercel = analyzeCacheDetails({ 'x-vercel-cache': 'HIT' });
    assert.strictEqual(vercel.cdnCache.status, 'HIT');

    const hits = analyzeCacheDetails({ 'x-cache-hits': '4' });
    assert.strictEqual(hits.cdnCache.status, 'HIT');
});

test("CDN cache MISS extracted from provider headers", () => {
    const cf = analyzeCacheDetails({ 'cf-cache-status': 'MISS' });
    assert.strictEqual(cf.cdnCache.status, 'MISS');
    assert.strictEqual(cf.summary, 'MISS');

    const cfront = analyzeCacheDetails({ 'x-cache': 'Miss from cloudfront' });
    assert.strictEqual(cfront.cdnCache.status, 'MISS');
    assert.strictEqual(cfront.summary, 'MISS');

    const vercel = analyzeCacheDetails({ 'x-vercel-cache': 'MISS' });
    assert.strictEqual(vercel.cdnCache.status, 'MISS');

    const hits = analyzeCacheDetails({ 'x-cache-hits': '0' });
    assert.strictEqual(hits.cdnCache.status, 'MISS');
});

test("CDN cache BYPASS and DYNAMIC statuses extracted", () => {
    const cfBypass = analyzeCacheDetails({ 'cf-cache-status': 'BYPASS' });
    assert.strictEqual(cfBypass.cdnCache.status, 'BYPASS');
    assert.strictEqual(cfBypass.summary, 'BYPASS');

    const cfDynamic = analyzeCacheDetails({ 'cf-cache-status': 'DYNAMIC' });
    assert.strictEqual(cfDynamic.cdnCache.status, 'DYNAMIC', "DYNAMIC is distinct from BYPASS");
    assert.strictEqual(cfDynamic.summary, 'DYNAMIC');
});

test("CDN cache EXPIRED, REVALIDATED, and STALE statuses preserved", () => {
    const expired = analyzeCacheDetails({ 'cf-cache-status': 'EXPIRED' });
    assert.strictEqual(expired.cdnCache.status, 'EXPIRED');

    const reval = analyzeCacheDetails({ 'cf-cache-status': 'REVALIDATED' });
    assert.strictEqual(reval.cdnCache.status, 'REVALIDATED');

    const stale = analyzeCacheDetails({ 'cf-cache-status': 'STALE' });
    assert.strictEqual(stale.cdnCache.status, 'STALE');

    const refreshHit = analyzeCacheDetails({ 'x-cache': 'RefreshHit from cloudfront' });
    assert.strictEqual(refreshHit.cdnCache.status, 'REVALIDATED');
});

test("Cache-Control policy declares cacheability, not proof of CDN cache hit", () => {
    const cacheablePolicy = analyzeCacheDetails({
        'cache-control': 'public, max-age=86400, s-maxage=604800'
    });
    assert.strictEqual(cacheablePolicy.cdnCache.status, 'NONE');
    assert.strictEqual(cacheablePolicy.policy.status, 'Cacheable');
    assert.strictEqual(cacheablePolicy.summary, 'Cacheable');

    const uncacheablePolicy = analyzeCacheDetails({
        'cache-control': 'no-store, no-cache, must-revalidate'
    });
    assert.strictEqual(uncacheablePolicy.policy.status, 'Not Cacheable');
    assert.strictEqual(uncacheablePolicy.summary, 'Not Cacheable');
});

test("Age header indicates proxy transit duration, not CDN edge cache status", () => {
    const ageResp = analyzeCacheDetails({
        'age': '300',
        'cache-control': 'public, max-age=600'
    });
    assert.strictEqual(ageResp.cdnCache.status, 'NONE', "Must not infer CDN HIT from Age header");
    assert.strictEqual(ageResp.policy.ageSeconds, 300);
    assert.strictEqual(ageResp.policy.status, 'Cacheable');
});

test("Ambiguous or uninformative headers report Unknown", () => {
    const unk = analyzeCacheDetails({
        'pragma': 'no-cache'
    });
    assert.strictEqual(unk.cdnCache.status, 'NONE');
    assert.strictEqual(unk.summary, 'Unknown');
});

test("Response with no cache-related headers reports No Cache Headers", () => {
    const none = analyzeCacheDetails({
        'server': 'nginx',
        'content-type': 'text/html'
    });
    assert.strictEqual(none.cdnCache.status, 'NONE');
    assert.strictEqual(none.summary, 'No Cache Headers');
    assert.strictEqual(extractCacheStatus({ 'server': 'nginx' }), 'No Cache Headers');
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Cache Analysis tests passed.`);
console.log("=================================================");
