/**
 * Representative response-header fixtures.
 *
 * Header names and value formats follow each provider's public documentation and
 * commonly observed responses. All identifiers are sanitized placeholders.
 * These are NOT live captures: before publishing claims about a specific site,
 * add a captured fixture (see README → "Adding verified fixtures").
 */
export const FIXTURES = [
    {
        name: 'Cloudflare-proxied HTML (dynamic)',
        headers: { server: 'cloudflare', 'cf-ray': '8f00000000000000-BOM', 'cf-cache-status': 'DYNAMIC', 'content-type': 'text/html; charset=utf-8' },
        options: { remoteIp: '104.18.0.1' },
        expect: { provider: 'Cloudflare', confidence: 'high', status: 'identified', cache: 'DYNAMIC' }
    },
    {
        name: 'CloudFront static asset hit',
        headers: { 'x-cache': 'Hit from cloudfront', via: '1.1 0000000000000000000000000000000.cloudfront.net (CloudFront)', 'x-amz-cf-pop': 'BOM78-P3', 'x-amz-cf-id': 'SANITIZED==' },
        expect: { provider: 'Amazon CloudFront', confidence: 'high', cache: 'HIT' }
    },
    {
        name: 'Fastly with shield (MISS at shield, HIT at edge)',
        headers: { 'x-served-by': 'cache-iad-kiad7000000-IAD, cache-bom4700-BOM', 'x-cache': 'MISS, HIT', 'x-cache-hits': '0, 1', 'x-timer': 'S1700000000.000000,VS0,VE1', via: '1.1 varnish, 1.1 varnish' },
        options: { remoteIp: '151.101.1.1' },
        expect: { provider: 'Fastly', confidence: 'medium', cache: 'HIT' }
    },
    {
        name: 'Akamai with debug pragma headers',
        headers: { server: 'AkamaiGHost', 'x-cache': 'TCP_MEM_HIT from a23-0-0-0.deploy.akamaitechnologies.com (AkamaiGHost/22.0.0-0) (-)', 'x-check-cacheable': 'YES' },
        expect: { provider: 'Akamai', confidence: 'high', cache: 'HIT' }
    },
    {
        name: 'Vercel edge cache',
        headers: { server: 'Vercel', 'x-vercel-id': 'bom1::iad1::sanitized-0000000000000-000000000000', 'x-vercel-cache': 'HIT' },
        expect: { provider: 'Vercel', confidence: 'high', cache: 'HIT' }
    },
    {
        name: 'Netlify with RFC 9211 Cache-Status',
        headers: { server: 'Netlify', 'x-nf-request-id': '01SANITIZED0000000000000000', 'cache-status': '"Netlify Edge"; fwd=miss' },
        expect: { provider: 'Netlify', confidence: 'high', cache: 'MISS' }
    },
    {
        name: 'Google App Engine / Cloud Run via GFE',
        headers: { server: 'Google Frontend', 'x-cloud-trace-context': 'sanitized', via: '1.1 google' },
        expect: { provider: 'Google Front End', confidence: 'medium', status: 'network-only' }
    },
    {
        name: 'GCS bucket served through GFE',
        headers: { server: 'UploadServer', 'x-goog-generation': '1700000000000000', 'x-goog-metageneration': '1', 'x-guploader-uploadid': 'SANITIZED' },
        expect: { provider: 'Google Cloud Storage', status: 'identified' }
    },
    {
        name: 'Azure Front Door',
        headers: { 'x-azure-ref': '20260101T000000Z-sanitized', 'x-cache': 'TCP_HIT', 'x-fd-int-roxy-purgeid': '0' },
        expect: { provider: 'Azure CDN', confidence: 'high', cache: 'HIT' }
    },
    {
        name: 'Bunny CDN pull zone',
        headers: { server: 'BunnyCDN-DE1-000', 'cdn-pullzone': '000000', 'cdn-uid': 'sanitized', 'cdn-requestid': 'sanitized', 'cdn-cache': 'HIT' },
        expect: { provider: 'BunnyCDN', confidence: 'high', cache: 'HIT' }
    },
    {
        name: 'Shopify storefront behind Cloudflare',
        headers: { server: 'cloudflare', 'cf-ray': '8f00000000000000-SIN', 'cf-cache-status': 'MISS', 'x-shopid': '00000000', 'x-shardid': '000' },
        expect: { provider: 'Cloudflare', confidence: 'high', cache: 'MISS' }
    },
    {
        name: 'Imperva-protected site',
        headers: { 'x-iinfo': '0-00000000-00000000 NNNN CT(0 0 0) RT(0 0) q(0 0 0 -1) r(0 0) U6', 'x-cdn': 'Imperva' },
        expect: { provider: 'Imperva', confidence: 'high' }
    },
    {
        name: 'Plain origin (nginx) — must stay unidentified',
        headers: { server: 'nginx/1.25.3', 'cache-control': 'public, max-age=3600', etag: '"abc"' },
        options: { remoteIp: '203.0.113.10' },
        expect: { provider: 'Not Detected', confidence: 'none', status: 'unidentified' }
    },
    {
        name: 'HTTP/3-capable origin without CDN headers — alt-svc is not CDN proof',
        headers: { server: 'LiteSpeed', 'alt-svc': 'h3=":443"; ma=2592000' },
        expect: { provider: 'Not Detected', status: 'unidentified' }
    }
];
