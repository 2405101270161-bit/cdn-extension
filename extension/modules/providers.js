/**
 * Provider fingerprint registry.
 *
 * Every signature declares:
 *   provider        Display name.
 *   category        'cdn' | 'edge' | 'hosting' | 'security' | 'storage'
 *                   'storage' identifies an origin/object store, never a CDN by itself.
 *   header          Lower-case response header name.
 *   match           Optional RegExp tested against the header value. When omitted,
 *                   the header merely needs a non-empty value.
 *   strength        'high' | 'medium' | 'low'
 *   productSpecific true when the evidence identifies the product itself;
 *                   false when it only shows the provider's network/edge ownership.
 *   note            Short human explanation shown in the report.
 *
 * Rules for adding signatures:
 *   - Only use headers/values that are documented by, or uniquely emitted by, the provider.
 *   - Generic names (x-cache, x-edge-location, cdn-cache, x-served-by) are never 'high'.
 *   - Storage headers (x-goog-*, x-amz-request-id, x-oss-*) are 'storage', never 'cdn'.
 */

export const CATEGORY_PRIORITY = {
    cdn: 5,
    security: 4,
    edge: 3,
    hosting: 2,
    storage: 1
};

export const HEADER_SIGNATURES = [
    // ── Cloudflare ────────────────────────────────────────────────────────────
    { provider: 'Cloudflare', category: 'cdn', header: 'cf-ray', strength: 'high', productSpecific: true, note: 'Cloudflare request ID' },
    { provider: 'Cloudflare', category: 'cdn', header: 'cf-cache-status', strength: 'high', productSpecific: true, note: 'Cloudflare cache status' },
    { provider: 'Cloudflare', category: 'cdn', header: 'server', match: /^cloudflare$/i, strength: 'high', productSpecific: true, note: 'Cloudflare edge server banner' },

    // ── Cloudflare R2 (object storage) ───────────────────────────────────────
    { provider: 'Cloudflare R2', category: 'storage', header: 'cf-r2-request-id', strength: 'high', productSpecific: true, note: 'R2 object storage request ID' },
    { provider: 'Cloudflare R2', category: 'storage', header: 'x-amz-meta-cf-r2-structure', strength: 'high', productSpecific: true, note: 'R2 object metadata' },
    { provider: 'Cloudflare R2', category: 'storage', header: 'server', match: /cloudflare-r2/i, strength: 'high', productSpecific: true, note: 'R2 server banner' },

    // ── Amazon CloudFront ────────────────────────────────────────────────────
    { provider: 'Amazon CloudFront', category: 'cdn', header: 'x-amz-cf-id', strength: 'high', productSpecific: true, note: 'CloudFront request ID' },
    { provider: 'Amazon CloudFront', category: 'cdn', header: 'x-amz-cf-pop', strength: 'high', productSpecific: true, note: 'CloudFront edge location' },
    { provider: 'Amazon CloudFront', category: 'cdn', header: 'via', match: /\.cloudfront\.net \(CloudFront\)/i, strength: 'high', productSpecific: true, note: 'CloudFront Via header' },
    { provider: 'Amazon CloudFront', category: 'cdn', header: 'x-cache', match: /\bfrom cloudfront\b/i, strength: 'high', productSpecific: true, note: 'CloudFront X-Cache value' },
    { provider: 'Amazon CloudFront', category: 'cdn', header: 'server', match: /^cloudfront$/i, strength: 'medium', productSpecific: true, note: 'CloudFront server banner' },

    // ── Amazon S3 (object storage) ───────────────────────────────────────────
    { provider: 'Amazon S3', category: 'storage', header: 'server', match: /^AmazonS3$/i, strength: 'high', productSpecific: true, note: 'S3 server banner' },
    { provider: 'Amazon S3', category: 'storage', header: 'x-amz-id-2', strength: 'medium', productSpecific: true, note: 'S3 extended request ID' },

    // ── Fastly ───────────────────────────────────────────────────────────────
    { provider: 'Fastly', category: 'cdn', header: 'x-fastly-request-id', strength: 'high', productSpecific: true, note: 'Fastly request ID' },
    { provider: 'Fastly', category: 'cdn', header: 'fastly-restarts', strength: 'high', productSpecific: true, note: 'Fastly restart counter' },
    { provider: 'Fastly', category: 'cdn', header: 'via', match: /\bfastly\b/i, strength: 'medium', productSpecific: true, note: 'Fastly in Via chain' },
    { provider: 'Fastly', category: 'cdn', header: 'x-served-by', match: /(^|,\s*)cache-[a-z0-9]+-[a-z0-9]+-[A-Z]{3}\b/, strength: 'medium', productSpecific: false, note: 'Fastly-style cache node name (Varnish naming convention)' },
    { provider: 'Fastly', category: 'cdn', header: 'x-timer', match: /^S\d+\.\d+,VS\d+/, strength: 'medium', productSpecific: false, note: 'Fastly/Varnish timer format' },

    // ── Akamai ───────────────────────────────────────────────────────────────
    { provider: 'Akamai', category: 'cdn', header: 'akamai-grn', strength: 'high', productSpecific: true, note: 'Akamai global reference number' },
    { provider: 'Akamai', category: 'cdn', header: 'x-akamai-transformed', strength: 'high', productSpecific: true, note: 'Akamai transformation marker' },
    { provider: 'Akamai', category: 'cdn', header: 'x-akamai-request-id', strength: 'high', productSpecific: true, note: 'Akamai request ID' },
    { provider: 'Akamai', category: 'cdn', header: 'akamai-cache-status', strength: 'high', productSpecific: true, note: 'Akamai cache status' },
    { provider: 'Akamai', category: 'cdn', header: 'server', match: /^AkamaiGHost/i, strength: 'high', productSpecific: true, note: 'Akamai edge server banner' },
    { provider: 'Akamai', category: 'cdn', header: 'x-cache', match: /akamaitechnologies\.com/i, strength: 'high', productSpecific: true, note: 'Akamai X-Cache value' },
    { provider: 'Akamai', category: 'cdn', header: 'x-cache-remote', match: /akamaitechnologies\.com/i, strength: 'high', productSpecific: true, note: 'Akamai parent-tier cache value' },
    { provider: 'Akamai', category: 'cdn', header: 'x-check-cacheable', strength: 'low', productSpecific: false, note: 'Akamai Pragma debug header (generic name)' },
    { provider: 'Akamai', category: 'storage', header: 'server', match: /^AkamaiNetStorage/i, strength: 'medium', productSpecific: true, note: 'Akamai NetStorage origin' },

    // ── Microsoft Azure ──────────────────────────────────────────────────────
    { provider: 'Azure CDN', category: 'cdn', header: 'x-azure-ref', strength: 'high', productSpecific: true, note: 'Azure Front Door / Azure CDN reference' },
    { provider: 'Azure CDN', category: 'cdn', header: 'x-fd-int-roxy-purgeid', strength: 'high', productSpecific: true, note: 'Azure Front Door purge ID' },
    { provider: 'Azure CDN', category: 'cdn', header: 'x-msedge-ref', strength: 'medium', productSpecific: false, note: 'Microsoft edge network reference (not specific to Azure CDN)' },
    { provider: 'Azure Blob Storage', category: 'storage', header: 'x-ms-blob-type', strength: 'high', productSpecific: true, note: 'Azure Blob object' },

    // ── Google ───────────────────────────────────────────────────────────────
    // Google Front End (GFE) fronts Google services, App Engine, Cloud Run, Firebase,
    // Cloud Load Balancing and Cloud CDN. GFE evidence alone does NOT prove Cloud CDN.
    { provider: 'Google Front End', category: 'edge', header: 'via', match: /(^|,\s*)1\.1 google\b/i, strength: 'medium', productSpecific: false, note: 'Google edge (GFE) in Via chain — does not confirm Cloud CDN' },
    { provider: 'Google Front End', category: 'edge', header: 'server', match: /^Google Frontend$/i, strength: 'medium', productSpecific: false, note: 'Google Frontend server banner — does not confirm Cloud CDN' },
    { provider: 'Google Cloud Storage', category: 'storage', header: 'x-goog-generation', strength: 'high', productSpecific: true, note: 'Cloud Storage object generation' },
    { provider: 'Google Cloud Storage', category: 'storage', header: 'x-goog-metageneration', strength: 'high', productSpecific: true, note: 'Cloud Storage metageneration' },
    { provider: 'Google Cloud Storage', category: 'storage', header: 'x-goog-stored-content-encoding', strength: 'high', productSpecific: true, note: 'Cloud Storage stored encoding' },
    { provider: 'Google Cloud Storage', category: 'storage', header: 'x-guploader-uploadid', strength: 'medium', productSpecific: false, note: 'Google upload server ID' },

    // ── Bunny CDN ────────────────────────────────────────────────────────────
    { provider: 'BunnyCDN', category: 'cdn', header: 'server', match: /^BunnyCDN/i, strength: 'high', productSpecific: true, note: 'Bunny edge server banner' },
    { provider: 'BunnyCDN', category: 'cdn', header: 'cdn-pullzone', strength: 'high', productSpecific: true, note: 'Bunny pull zone ID' },
    { provider: 'BunnyCDN', category: 'cdn', header: 'cdn-requestid', strength: 'medium', productSpecific: true, note: 'Bunny request ID' },
    { provider: 'BunnyCDN', category: 'cdn', header: 'cdn-uid', strength: 'medium', productSpecific: true, note: 'Bunny pull zone UID' },
    { provider: 'BunnyCDN', category: 'cdn', header: 'cdn-cache', strength: 'low', productSpecific: false, note: 'Generic CDN-Cache header (used by Bunny)' },

    // ── KeyCDN ───────────────────────────────────────────────────────────────
    { provider: 'KeyCDN', category: 'cdn', header: 'server', match: /^keycdn-engine/i, strength: 'high', productSpecific: true, note: 'KeyCDN server banner' },
    { provider: 'KeyCDN', category: 'cdn', header: 'x-edge-location', strength: 'low', productSpecific: false, note: 'Generic X-Edge-Location header (used by KeyCDN)' },

    // ── Vercel ───────────────────────────────────────────────────────────────
    { provider: 'Vercel', category: 'hosting', header: 'x-vercel-id', strength: 'high', productSpecific: true, note: 'Vercel request ID' },
    { provider: 'Vercel', category: 'hosting', header: 'x-vercel-cache', strength: 'high', productSpecific: true, note: 'Vercel edge cache status' },
    { provider: 'Vercel', category: 'hosting', header: 'server', match: /^Vercel$/i, strength: 'medium', productSpecific: true, note: 'Vercel server banner' },

    // ── Netlify ──────────────────────────────────────────────────────────────
    { provider: 'Netlify', category: 'hosting', header: 'x-nf-request-id', strength: 'high', productSpecific: true, note: 'Netlify request ID' },
    { provider: 'Netlify', category: 'hosting', header: 'x-nf-cache-status', strength: 'high', productSpecific: true, note: 'Netlify cache status' },
    { provider: 'Netlify', category: 'hosting', header: 'server', match: /^Netlify$/i, strength: 'medium', productSpecific: true, note: 'Netlify server banner' },

    // ── Fly.io / Render ──────────────────────────────────────────────────────
    { provider: 'Fly.io', category: 'hosting', header: 'fly-request-id', strength: 'high', productSpecific: true, note: 'Fly.io request ID' },
    { provider: 'Render', category: 'hosting', header: 'rndr-id', strength: 'high', productSpecific: true, note: 'Render request ID' },

    // ── Imperva ──────────────────────────────────────────────────────────────
    { provider: 'Imperva', category: 'security', header: 'x-iinfo', strength: 'high', productSpecific: true, note: 'Imperva/Incapsula request info' },
    { provider: 'Imperva', category: 'security', header: 'x-cdn', match: /imperva|incapsula/i, strength: 'high', productSpecific: true, note: 'Imperva X-CDN value' },

    // ── Sucuri ───────────────────────────────────────────────────────────────
    { provider: 'Sucuri', category: 'security', header: 'x-sucuri-id', strength: 'high', productSpecific: true, note: 'Sucuri firewall node ID' },
    { provider: 'Sucuri', category: 'security', header: 'x-sucuri-cache', strength: 'high', productSpecific: true, note: 'Sucuri cache status' },
    { provider: 'Sucuri', category: 'security', header: 'server', match: /^Sucuri\/Cloudproxy/i, strength: 'high', productSpecific: true, note: 'Sucuri server banner' },

    // ── CDN77 ────────────────────────────────────────────────────────────────
    { provider: 'CDN77', category: 'cdn', header: 'x-77-nzt', strength: 'high', productSpecific: true, note: 'CDN77 request trace' },
    { provider: 'CDN77', category: 'cdn', header: 'x-77-cache', strength: 'high', productSpecific: true, note: 'CDN77 cache status' },
    { provider: 'CDN77', category: 'cdn', header: 'x-77-pop', strength: 'high', productSpecific: true, note: 'CDN77 edge location' },
    { provider: 'CDN77', category: 'cdn', header: 'server', match: /^CDN77/i, strength: 'high', productSpecific: true, note: 'CDN77 server banner' },

    // ── Alibaba Cloud ────────────────────────────────────────────────────────
    { provider: 'Alibaba Cloud CDN', category: 'cdn', header: 'x-swift-savetime', strength: 'high', productSpecific: true, note: 'Alibaba CDN (Swift) cache save time' },
    { provider: 'Alibaba Cloud CDN', category: 'cdn', header: 'x-swift-cachetime', strength: 'high', productSpecific: true, note: 'Alibaba CDN (Swift) cache TTL' },
    { provider: 'Alibaba Cloud OSS', category: 'storage', header: 'x-oss-request-id', strength: 'high', productSpecific: true, note: 'Alibaba OSS request ID' },
    { provider: 'Alibaba Cloud OSS', category: 'storage', header: 'server', match: /^AliyunOSS$/i, strength: 'high', productSpecific: true, note: 'Alibaba OSS server banner' },

    // ── StackPath / Highwinds ────────────────────────────────────────────────
    { provider: 'StackPath', category: 'cdn', header: 'x-hw', strength: 'medium', productSpecific: true, note: 'Highwinds/StackPath trace header' },

    // ── Platforms (served through their own edge or a partner CDN) ──────────
    { provider: 'GitHub Pages', category: 'hosting', header: 'x-github-request-id', strength: 'high', productSpecific: true, note: 'GitHub request ID' },
    { provider: 'GitHub Pages', category: 'hosting', header: 'server', match: /^GitHub\.com$/i, strength: 'high', productSpecific: true, note: 'GitHub server banner' },
    { provider: 'Shopify', category: 'hosting', header: 'x-shopid', strength: 'high', productSpecific: true, note: 'Shopify shop ID' },
    { provider: 'Shopify', category: 'hosting', header: 'x-shardid', strength: 'high', productSpecific: true, note: 'Shopify shard ID' }
];

/**
 * CNAME targets that indicate a provider. Only hostnames controlled by the
 * provider are listed; DNS-only services (e.g. Azure Traffic Manager) are excluded.
 */
export const CNAME_SIGNATURES = [
    { pattern: /(?:^|\.)cdn\.cloudflare\.net$/i, provider: 'Cloudflare', category: 'cdn' },
    { pattern: /(?:^|\.)cloudfront\.net$/i, provider: 'Amazon CloudFront', category: 'cdn' },
    { pattern: /(?:^|\.)(?:fastly\.net|fastlylb\.net)$/i, provider: 'Fastly', category: 'cdn' },
    { pattern: /(?:^|\.)(?:akamaiedge\.net|akamai\.net|akamaized\.net|akamaihd\.net|edgekey\.net|edgesuite\.net|akamaitechnologies\.com)$/i, provider: 'Akamai', category: 'cdn' },
    { pattern: /(?:^|\.)(?:azureedge\.net|azurefd\.net)$/i, provider: 'Azure CDN', category: 'cdn' },
    { pattern: /(?:^|\.)(?:ghs\.googlehosted\.com|googlehosted\.com)$/i, provider: 'Google Front End', category: 'edge' },
    { pattern: /(?:^|\.)b-cdn\.net$/i, provider: 'BunnyCDN', category: 'cdn' },
    { pattern: /(?:^|\.)kxcdn\.com$/i, provider: 'KeyCDN', category: 'cdn' },
    { pattern: /(?:^|\.)(?:vercel-dns\.com|vercel-dns-\d+\.com)$/i, provider: 'Vercel', category: 'hosting' },
    { pattern: /(?:^|\.)netlify\.app$/i, provider: 'Netlify', category: 'hosting' },
    { pattern: /(?:^|\.)incapdns\.net$/i, provider: 'Imperva', category: 'security' },
    { pattern: /(?:^|\.)sucuri\.net$/i, provider: 'Sucuri', category: 'security' },
    { pattern: /(?:^|\.)(?:cdn77\.org|r\.worldcdn\.net)$/i, provider: 'CDN77', category: 'cdn' },
    { pattern: /(?:^|\.)alikunlun\.(?:com|net)$/i, provider: 'Alibaba Cloud CDN', category: 'cdn' },
    { pattern: /(?:^|\.)wscdns\.com$/i, provider: 'Wangsu / CDNetworks', category: 'cdn' },
    { pattern: /(?:^|\.)cdngc\.net$/i, provider: 'Wangsu / CDNetworks', category: 'cdn' },
    { pattern: /(?:^|\.)(?:stackpathdns\.com|hwcdn\.net)$/i, provider: 'StackPath', category: 'cdn' },
    { pattern: /(?:^|\.)gcdn\.co$/i, provider: 'Gcore', category: 'cdn' },
    { pattern: /(?:^|\.)(?:edgecastcdn\.net|llnwd\.net|edgio\.net)$/i, provider: 'Edgio (legacy Edgecast/Limelight)', category: 'cdn' },
    { pattern: /(?:^|\.)github\.io$/i, provider: 'GitHub Pages', category: 'hosting' },
    { pattern: /(?:^|\.)myshopify\.com$/i, provider: 'Shopify', category: 'hosting' }
];

/**
 * Published edge IP ranges. Ownership is supporting evidence only: an IP inside a
 * provider's range shows whose network answered, not which product was used.
 */
export const IP_RANGE_SOURCES = [
    {
        provider: 'Cloudflare',
        category: 'cdn',
        source: 'https://www.cloudflare.com/ips-v4 , https://www.cloudflare.com/ips-v6',
        retrieved: '2026-11-20',
        ipv4: [
            '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
            '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
            '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
            '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
        ],
        ipv6: [
            '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
            '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
        ]
    },
    {
        provider: 'Fastly',
        category: 'cdn',
        source: 'https://api.fastly.com/public-ip-list',
        retrieved: '2026-11-20',
        ipv4: [
            '23.235.32.0/20', '43.249.72.0/22', '90.98.0.0/17', '90.98.128.0/18',
            '103.244.50.0/24', '103.245.222.0/23', '103.245.224.0/24', '104.156.80.0/20',
            '140.248.64.0/18', '140.248.128.0/17', '146.75.0.0/17', '151.101.0.0/16',
            '157.52.64.0/18', '167.82.0.0/17', '167.82.128.0/20', '167.82.160.0/20',
            '167.82.224.0/20', '172.111.64.0/18', '185.31.16.0/22', '199.27.72.0/21',
            '199.232.0.0/16'
        ],
        ipv6: ['2a04:4e40::/32', '2a04:4e42::/31', '2a04:4e44::/32']
    }
];

export const KNOWN_LIMITATIONS = [
    'Some CDNs hide or remove identifying headers.',
    'CNAME records may be invisible because of DNS flattening, direct A/AAAA records, or custom hostnames.',
    "A cloud provider's IP range shows network ownership, not a specific CDN product.",
    'HTTP/3 (QUIC) is a transport protocol and does not prove CDN usage.',
    'The HTML document, images, scripts, fonts and APIs may each use a different delivery provider.',
    'No CDN signature found is not the same as no CDN present.'
];
