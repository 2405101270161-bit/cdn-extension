/**
 * CDN Analyzer Pro v2 - CDN Detection & Cache Module
 * Robust signature rules for 16+ CDN providers & full HTTP Cache Status extraction.
 *
 * FIXES APPLIED:
 *  BUG-14: Replaced the mutually-exclusive if/else chain with additive per-provider
 *          scoring. Every provider is evaluated independently; all matches are
 *          collected, sorted by confidence, and the highest-confidence match becomes
 *          the primary `provider`. Additional matches populate `possibleLayers`.
 *  BUG-15: Narrowed the Fastly x-served-by fingerprint — "cache-*" alone is too broad
 *          and matches generic Varnish caches. Now requires at least one additional
 *          Fastly signal (x-fastly-request-id or "fastly" in Via).
 *  BUG-16: Removed `gws` and `ghs` from Google CDN detection. Those are Google's
 *          own origin servers, not Google Cloud CDN edge nodes. Only x-goog-* headers
 *          and an explicit "google" Via value are accepted.
 *  BUG-17: Removed the false "HIT" mapping for Cache-Control: max-age/s-maxage/public.
 *          Those directives declare cacheability policy — they do NOT indicate the
 *          CDN served the response from cache. Now mapped to "Cacheable" (browser/CDN
 *          may cache) or "Not Cacheable". "HIT"/"MISS" are reserved for real CDN status
 *          headers (cf-cache-status, x-cache, etc.).
 */

// Confidence numeric weights for sorting
export const CONF_WEIGHT = { high: 3, medium: 2, low: 1, none: 0 };

const SENSITIVE_HEADER_KEYS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-auth-token',
    'x-api-key'
]);

/**
 * Normalizes header keys to lowercase and cleanly handles duplicate,
 * array-formatted, or malformed header values.
 */
export function normalizeHeaders(rawHeaders = {}) {
    if (!rawHeaders || typeof rawHeaders !== 'object') return {};
    const normalized = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
        if (key === undefined || key === null) continue;
        const lowerKey = String(key).trim().toLowerCase();
        if (!lowerKey) continue;

        let valStr = '';
        if (Array.isArray(value)) {
            valStr = value.map(v => (v !== undefined && v !== null) ? String(v).trim() : '').filter(Boolean).join(', ');
        } else if (value !== undefined && value !== null) {
            valStr = String(value).trim();
        }

        if (normalized[lowerKey]) {
            if (valStr && !normalized[lowerKey].includes(valStr)) {
                normalized[lowerKey] = `${normalized[lowerKey]}, ${valStr}`;
            }
        } else {
            normalized[lowerKey] = valStr;
        }
    }
    return normalized;
}

/**
 * Strips sensitive authorization and cookie headers from responses before
 * exporting or persisting analysis objects.
 */
export function scrubSensitiveHeaders(rawHeaders = {}) {
    const clean = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
        if (!SENSITIVE_HEADER_KEYS.has(String(k).trim().toLowerCase())) {
            clean[k] = v;
        }
    }
    return clean;
}

/**
 * Evaluates a single CDN provider's signal set against the supplied headers.
 * Returns { provider, confidence, evidence } if matched, or null.
 */
function testProvider(name, highSignals, mediumSignals, headers, server, via, xPoweredBy) {
    const evidence = [];
    let confidence = 'none';

    for (const { key, test, label } of highSignals) {
        const val = headers[key];
        if (val !== undefined && (test === undefined || test(val, { server, via, xPoweredBy }))) {
            evidence.push(label ? label(val) : `${key}: ${String(val).slice(0, 32)}`);
            confidence = 'high';
        }
    }

    if (confidence !== 'high') {
        for (const { test, label } of mediumSignals) {
            if (test({ server, via, xPoweredBy })) {
                evidence.push(label);
                confidence = 'medium';
            }
        }
    }

    if (confidence === 'none') return null;
    return { provider: name, confidence, evidence };
}

export function detectCdnProvider(rawHeaders = {}) {
    const headers = normalizeHeaders(rawHeaders);
    const server = (headers['server'] || '').toLowerCase();
    const via = (headers['via'] || '').toLowerCase();
    const xPoweredBy = (headers['x-powered-by'] || '').toLowerCase();

    // ------------------------------------------------------------------ //
    // BUG-14 FIX: Define each provider independently. All are evaluated.  //
    // ------------------------------------------------------------------ //
    const providerDefs = [

        // 1. Cloudflare R2
        {
            name: 'Cloudflare R2',
            high: [
                { key: 'x-amz-meta-cf-r2-structure' },
                { key: 'cf-r2-request-id' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('cloudflare-r2'), label: 'server: cloudflare-r2' }
            ]
        },

        // 2. Cloudflare
        {
            name: 'Cloudflare',
            high: [
                { key: 'cf-ray', label: (v) => `cf-ray: ${v}` },
                { key: 'cf-cache-status', label: (v) => `cf-cache-status: ${v}` },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('cloudflare') && !s.includes('cloudflare-r2'), label: 'server: cloudflare' }
            ]
        },

        // 3. Amazon CloudFront
        {
            name: 'Amazon CloudFront',
            high: [
                { key: 'x-amz-cf-id', label: (v) => `x-amz-cf-id: ${v.slice(0, 16)}...` },
                { key: 'x-amz-cf-pop', label: (v) => `x-amz-cf-pop: ${v}` },
            ],
            medium: [
                { test: ({ via: v, server: s }) => v.includes('cloudfront') || s.includes('cloudfront'), label: 'via/server: cloudfront' }
            ]
        },

        // 4. Fastly — BUG-15 FIX: x-served-by "cache-*" alone is too broad;
        //    require at least one additional Fastly-specific signal.
        {
            name: 'Fastly',
            high: [
                { key: 'x-fastly-request-id', label: (v) => `x-fastly-request-id: ${v.slice(0, 16)}` },
                { key: 'fastly-restarts' },
                {
                    key: 'x-served-by',
                    // BUG-15 FIX: Only treat x-served-by as high-confidence Fastly when
                    // another Fastly signal (via or x-fastly-request-id) also exists.
                    test: (val, { via: v }) =>
                        val.toLowerCase().includes('cache-') &&
                        (v.includes('fastly') || v.includes('varnish') || !!headers['x-fastly-request-id']),
                    label: (v) => `x-served-by: ${v.slice(0, 24)}`
                },
            ],
            medium: [
                { test: ({ via: v, server: s }) => v.includes('fastly') || s.includes('fastly'), label: 'via/server: fastly' }
            ]
        },

        // 5. Akamai
        {
            name: 'Akamai',
            high: [
                { key: 'x-akamai-transformed' },
                { key: 'x-cache-remote' },
                { key: 'akamai-grn', label: (v) => `akamai-grn: ${v}` },
                { key: 'x-akamai-request-id' },
                { key: 'x-check-cacheable' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('akamai') || s.includes('akamaighost') || s.includes('akamainetwork'), label: 'server: akamai' }
            ]
        },

        // 6. Azure CDN / Front Door
        {
            name: 'Azure CDN',
            high: [
                { key: 'x-azure-ref', label: () => 'x-azure-ref present' },
                { key: 'x-fd-int-ro-stat' },
                { key: 'x-ms-ref' },
                { key: 'x-msedge-ref' },
            ],
            medium: [
                { test: ({ server: s, via: v }) => s.includes('azure') || v.includes('azure'), label: 'server/via: azure' }
            ]
        },

        // 7. Google Cloud CDN — BUG-16 FIX: Removed gws/ghs (origin servers).
        {
            name: 'Google Cloud CDN',
            high: [
                { key: 'x-goog-generation' },
                { key: 'x-goog-metageneration' },
                { key: 'x-goog-stored-content-encoding' },
            ],
            medium: [
                // Only match "google" in Via (explicit CDN routing), not the server header.
                // google.com uses "gws" as its origin server which is NOT a CDN.
                { test: ({ via: v }) => v.includes('google'), label: 'via: google' }
            ]
        },

        // 8. BunnyCDN
        {
            name: 'BunnyCDN',
            high: [
                { key: 'b-cache' },
                { key: 'b-ray' },
                { key: 'cdn-cache', label: (v) => `cdn-cache: ${v}` },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('bunnycdn'), label: 'server: bunnycdn' }
            ]
        },

        // 9. KeyCDN
        {
            name: 'KeyCDN',
            high: [
                { key: 'x-edge-location' },
                { key: 'x-keycdn-req' },
                { key: 'x-keycdn-cache' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('keycdn'), label: 'server: keycdn' }
            ]
        },

        // 10. Vercel
        {
            name: 'Vercel',
            high: [
                { key: 'x-vercel-id', label: (v) => `x-vercel-id: ${v}` },
                { key: 'x-vercel-cache', label: (v) => `x-vercel-cache: ${v}` },
            ],
            medium: [
                { test: ({ server: s, xPoweredBy: x }) => s.includes('vercel') || x.includes('vercel'), label: 'server/x-powered-by: vercel' }
            ]
        },

        // 11. Netlify
        {
            name: 'Netlify',
            high: [
                { key: 'x-nf-request-id' },
                { key: 'x-nf-cache-status', label: (v) => `x-nf-cache-status: ${v}` },
            ],
            medium: [
                { test: ({ server: s, xPoweredBy: x }) => s.includes('netlify') || x.includes('netlify'), label: 'server: netlify' }
            ]
        },

        // 12. Imperva / Incapsula
        {
            name: 'Imperva',
            high: [
                { key: 'x-iinfo' },
                { key: 'x-cdn', test: (v) => v.toLowerCase().includes('imperva'), label: () => 'x-cdn: imperva' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('incapsula') || s.includes('imperva'), label: 'server: incapsula' }
            ]
        },

        // 13. Sucuri
        {
            name: 'Sucuri',
            high: [
                { key: 'x-sucuri-id' },
                { key: 'x-sucuri-cache', label: (v) => `x-sucuri-cache: ${v}` },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('sucuri'), label: 'server: sucuri' }
            ]
        },

        // 14. CDN77
        {
            name: 'CDN77',
            high: [
                { key: 'x-77-pop' },
                { key: 'x-77-cache' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('cdn77'), label: 'server: cdn77' }
            ]
        },

        // 15. Alibaba CDN
        {
            name: 'Alibaba CDN',
            high: [
                { key: 'x-swift-savetime' },
                { key: 'x-swift-cachetime' },
                { key: 'x-oss-request-id' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('alibabacloud') || s.includes('alysa'), label: 'server: alibaba' }
            ]
        },

        // 16. StackPath
        {
            name: 'StackPath',
            high: [
                { key: 'x-sp-url' },
                { key: 'x-sp-wave' },
            ],
            medium: []
        },

        // 17. Edgio / Layer0
        {
            name: 'Edgio / Layer0',
            high: [
                { key: 'x-edg-c-info' },
                { key: 'x-l0-c-info' },
            ],
            medium: []
        },

        // 18. GitHub Pages
        {
            name: 'GitHub Pages',
            high: [
                { key: 'x-github-request-id' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('github.com') || s.includes('githubusercontent'), label: 'server: github' }
            ]
        },

        // 19. Shopify
        {
            name: 'Shopify CDN',
            high: [
                { key: 'x-shopid' },
                { key: 'x-shardid' },
            ],
            medium: [
                { test: ({ server: s }) => s.includes('shopify'), label: 'server: shopify' }
            ]
        },
    ];

    // ------------------------------------------------------------------ //
    // BUG-14 FIX: Evaluate every provider independently, collect matches. //
    // ------------------------------------------------------------------ //
    const matches = [];

    for (const def of providerDefs) {
        const result = testProvider(
            def.name,
            def.high,
            def.medium,
            headers,
            server,
            via,
            xPoweredBy
        );
        if (result) {
            matches.push(result);
        }
    }

    // Sort by confidence weight descending
    matches.sort((a, b) => (CONF_WEIGHT[b.confidence] || 0) - (CONF_WEIGHT[a.confidence] || 0));

    let provider = 'Not Detected';
    let confidence = 'none';
    let evidence = [];
    const possibleLayers = [];

    if (matches.length > 0) {
        const primary = matches[0];
        provider = primary.provider;
        confidence = primary.confidence;
        evidence = primary.evidence;

        // Populate layered CDN information
        for (let i = 1; i < matches.length; i++) {
            possibleLayers.push({
                provider: matches[i].provider,
                confidence: matches[i].confidence,
                evidence: matches[i].evidence
            });
        }
    }

    console.log("[CDN Debug] server =", server, "| via =", via);
    console.log("[CDN Debug] All matches:", matches.map(m => `${m.provider}(${m.confidence})`).join(', ') || 'none');
    console.log("[CDN Debug] Primary:", provider, "(", confidence, ")");

    return {
        provider,
        confidence,
        evidence,
        possibleLayers
    };
}

/**
 * Decomposes cache evidence into distinct, explicit categories:
 *  A. Browser HTTP cache (memory, disk, prefetch from CDP)
 *  B. Service-worker responses
 *  C. CDN or intermediary edge cache status (cf-cache-status, x-cache, etc.)
 *  D. Cache policy (Cache-Control, Age, Expires)
 *  E. Summary status for backwards compatibility
 *
 * Never infers a CDN cache HIT from Age or Cache-Control max-age/public.
 */
export function analyzeCacheDetails(rawHeaders = {}, cdpContext = {}) {
    const headers = normalizeHeaders(rawHeaders);

    // A. Browser HTTP Cache Evidence
    const fromDiskCache = Boolean(cdpContext && cdpContext.fromDiskCache);
    const fromMemoryCache = Boolean(cdpContext && (cdpContext.fromMemoryCache || cdpContext.servedFromCache));
    const fromPrefetchCache = Boolean(cdpContext && cdpContext.fromPrefetchCache);
    const browserCacheType = fromDiskCache ? 'disk' : (fromMemoryCache ? 'memory' : (fromPrefetchCache ? 'prefetch' : null));
    const browserCache = {
        servedFromCache: Boolean(browserCacheType),
        type: browserCacheType,
        evidence: browserCacheType ? `cdp:from-${browserCacheType}-cache` : null
    };

    // B. Service-Worker responses (not CDN hits)
    const fromServiceWorker = Boolean(cdpContext && cdpContext.fromServiceWorker);
    const serviceWorker = {
        fulfilledByServiceWorker: fromServiceWorker,
        evidence: fromServiceWorker ? 'cdp:fromServiceWorker' : null
    };

    // C. CDN or Intermediary Edge Cache Status
    let cdnStatus = "NONE";
    let cdnHeader = null;
    let cdnRawVal = null;
    let cdnEvidence = null;

    if (headers['cf-cache-status']) {
        cdnHeader = 'cf-cache-status';
        cdnRawVal = String(headers['cf-cache-status']).trim();
    } else if (headers['x-cache']) {
        cdnHeader = 'x-cache';
        cdnRawVal = String(headers['x-cache']).trim();
    } else if (headers['x-cache-hits']) {
        cdnHeader = 'x-cache-hits';
        cdnRawVal = String(headers['x-cache-hits']).trim();
    } else if (headers['x-vercel-cache']) {
        cdnHeader = 'x-vercel-cache';
        cdnRawVal = String(headers['x-vercel-cache']).trim();
    } else if (headers['x-nf-cache-status']) {
        cdnHeader = 'x-nf-cache-status';
        cdnRawVal = String(headers['x-nf-cache-status']).trim();
    } else if (headers['cdn-cache']) {
        cdnHeader = 'cdn-cache';
        cdnRawVal = String(headers['cdn-cache']).trim();
    } else if (headers['x-akamai-cache-status']) {
        cdnHeader = 'x-akamai-cache-status';
        cdnRawVal = String(headers['x-akamai-cache-status']).trim();
    }

    if (cdnHeader && cdnRawVal) {
        cdnEvidence = `${cdnHeader}: ${cdnRawVal}`;
        const valUpper = cdnRawVal.toUpperCase();

        if (cdnHeader === 'x-cache-hits') {
            const hits = parseInt(cdnRawVal, 10);
            cdnStatus = (!isNaN(hits) && hits > 0) ? "HIT" : "MISS";
        } else if (valUpper.includes('HIT')) {
            if (valUpper.includes('REFRESH') || valUpper.includes('REVALIDATED')) {
                cdnStatus = "REVALIDATED";
            } else {
                cdnStatus = "HIT";
            }
        } else if (valUpper.includes('EXPIRED')) {
            cdnStatus = "EXPIRED";
        } else if (valUpper.includes('REVALIDATED')) {
            cdnStatus = "REVALIDATED";
        } else if (valUpper.includes('STALE') || valUpper.includes('UPDATING')) {
            cdnStatus = "STALE";
        } else if (valUpper.includes('BYPASS') || valUpper.includes('DYNAMIC')) {
            cdnStatus = "BYPASS";
        } else if (valUpper.includes('MISS')) {
            cdnStatus = "MISS";
        } else {
            cdnStatus = "UNKNOWN";
        }
    }

    const cdnCache = {
        status: cdnStatus,
        header: cdnHeader,
        rawValue: cdnRawVal,
        evidence: cdnEvidence
    };

    // D. Cache Policy (Cache-Control, Expires, Age)
    const cacheControl = headers['cache-control'] ? String(headers['cache-control']).toLowerCase() : null;
    const pragma = headers['pragma'] ? String(headers['pragma']).toLowerCase() : null;
    const expires = headers['expires'] || null;
    const ageRaw = headers['age'] || null;
    let ageSeconds = null;
    if (ageRaw && /^\d+$/.test(String(ageRaw).trim())) {
        ageSeconds = parseInt(String(ageRaw).trim(), 10);
    }

    let policyStatus = "No Cache Directives";
    const directives = [];
    if (cacheControl) {
        directives.push(...cacheControl.split(',').map(s => s.trim()).filter(Boolean));
        if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
            policyStatus = "Not Cacheable";
        } else if (cacheControl.includes('max-age') || cacheControl.includes('s-maxage') || cacheControl.includes('public')) {
            policyStatus = "Cacheable";
        } else if (cacheControl.includes('private')) {
            policyStatus = "Private Cacheable";
        }
    } else if (expires) {
        policyStatus = "Cacheable (Expires)";
    }

    const cachePolicy = {
        status: policyStatus,
        cacheControl,
        directives,
        expires,
        ageSeconds,
        hasValidation: Boolean(headers['etag'] || headers['last-modified'])
    };

    // E. Backwards-compatible summary status
    let summary = "Unknown";
    if (cdnCache.status !== "NONE" && cdnCache.status !== "UNKNOWN") {
        summary = cdnCache.status;
    } else if (serviceWorker.fulfilledByServiceWorker) {
        summary = "Service Worker";
    } else if (browserCache.servedFromCache) {
        summary = browserCache.type === 'memory' ? "Memory Cache" : "Disk Cache";
    } else if (policyStatus === "Not Cacheable") {
        summary = "Not Cacheable";
    } else if (policyStatus.startsWith("Cacheable")) {
        summary = "Cacheable";
    } else if (cacheControl || expires || ageRaw || headers['etag'] || headers['last-modified'] || pragma) {
        summary = "Unknown";
    } else {
        summary = "No Cache Headers";
    }

    return {
        browserCache,
        serviceWorker,
        cdnCache,
        policy: cachePolicy,
        summary
    };
}

export function extractCacheStatus(headers = {}, cdpContext = {}) {
    const analysis = analyzeCacheDetails(headers, cdpContext);
    return analysis.summary;
}

/**
 * Extracts edge-server / Point of Presence (PoP) identifiers and network-level
 * remote IP records from response headers and connection metadata.
 * Edge identification is kept strictly separate from CDN provider identification.
 * Does NOT infer city or PoP from an IP address alone.
 */
export function extractEdgeEvidence(rawHeaders = {}, providerName = '', remoteIp = null, remotePort = null) {
    const headers = normalizeHeaders(rawHeaders);
    let edgePop = null;
    let popCode = null;
    let evidenceSource = null;
    let requestIdentifier = null;

    // 1. Cloudflare: cf-ray (format: <hash>-<POP_IATA_CODE>)
    if (headers['cf-ray']) {
        const cfRay = String(headers['cf-ray']).trim();
        requestIdentifier = cfRay;
        const lastDash = cfRay.lastIndexOf('-');
        if (lastDash !== -1 && lastDash < cfRay.length - 1) {
            const suffix = cfRay.substring(lastDash + 1).trim();
            if (/^[A-Za-z]{3,4}$/.test(suffix)) {
                edgePop = suffix.toUpperCase();
                popCode = edgePop;
                evidenceSource = 'cf-ray';
            }
        }
        if (!evidenceSource) {
            evidenceSource = 'cf-ray';
            edgePop = cfRay;
        }
    }

    // 2. Amazon CloudFront: x-amz-cf-pop (e.g. IAD89-C1) and x-amz-cf-id
    if (headers['x-amz-cf-pop']) {
        edgePop = String(headers['x-amz-cf-pop']).trim();
        evidenceSource = 'x-amz-cf-pop';
        const m = edgePop.match(/^([A-Za-z]{3})/);
        if (m) {
            popCode = m[1].toUpperCase();
        }
    }
    if (headers['x-amz-cf-id']) {
        requestIdentifier = String(headers['x-amz-cf-id']).trim();
        if (!evidenceSource) evidenceSource = 'x-amz-cf-id';
    }

    // 3. Fastly: x-served-by (e.g. cache-iad-kiad12345-IAD) and x-fastly-request-id
    if (headers['x-served-by']) {
        const rawServed = String(headers['x-served-by']).trim();
        evidenceSource = 'x-served-by';
        const hops = rawServed.split(',').map(s => s.trim()).filter(Boolean);
        const lastHop = hops[hops.length - 1] || rawServed;
        edgePop = lastHop;
        const m = lastHop.match(/-([A-Za-z]{3,4})$/);
        if (m) {
            popCode = m[1].toUpperCase();
        }
    }
    if (headers['x-fastly-request-id']) {
        requestIdentifier = String(headers['x-fastly-request-id']).trim();
        if (!evidenceSource) evidenceSource = 'x-fastly-request-id';
    }

    // 4. Akamai: akamai-grn, x-akamai-request-id, x-akamai-transformed
    if (headers['akamai-grn']) {
        requestIdentifier = String(headers['akamai-grn']).trim();
        evidenceSource = 'akamai-grn';
        edgePop = requestIdentifier;
    } else if (headers['x-akamai-request-id']) {
        requestIdentifier = String(headers['x-akamai-request-id']).trim();
        if (!evidenceSource) {
            evidenceSource = 'x-akamai-request-id';
            edgePop = requestIdentifier;
        }
    }

    // 5. Vercel: x-vercel-id (e.g. iad1::iad1::...)
    if (headers['x-vercel-id']) {
        const vercelId = String(headers['x-vercel-id']).trim();
        requestIdentifier = vercelId;
        const parts = vercelId.split('::');
        if (parts[0]) {
            edgePop = parts[0].trim();
            evidenceSource = 'x-vercel-id';
            const m = edgePop.match(/^([A-Za-z]{3})/);
            if (m) popCode = m[1].toUpperCase();
        }
    }

    // 6. CDN77: x-77-pop
    if (headers['x-77-pop']) {
        edgePop = String(headers['x-77-pop']).trim();
        evidenceSource = 'x-77-pop';
    }

    // 7. KeyCDN: x-edge-location
    if (headers['x-edge-location']) {
        edgePop = String(headers['x-edge-location']).trim();
        evidenceSource = 'x-edge-location';
    }

    // 8. BunnyCDN: b-ray
    if (headers['b-ray']) {
        edgePop = String(headers['b-ray']).trim();
        evidenceSource = 'b-ray';
    }

    const isAvailable = Boolean(edgePop);

    return {
        edgePop: edgePop || null,
        popCode: popCode || null,
        remoteIp: remoteIp ? String(remoteIp).trim() : null,
        remotePort: Number.isInteger(remotePort) ? remotePort : (remotePort ? parseInt(remotePort, 10) : null),
        evidenceSource: evidenceSource || (remoteIp ? 'socket-remote-ip' : null),
        requestIdentifier: requestIdentifier || null,
        availability: isAvailable ? 'available' : 'unavailable',
        confidence: isAvailable ? 'high' : (remoteIp ? 'low' : 'none'),
        limitations: isAvailable ? [] : ['Edge/PoP identifier not exposed in response headers']
    };
}

/**
 * Runs provider detection and edge evidence extraction against an individual resource.
 */
export function detectResourceCdn(rawHeaders = {}, url = '', resourceType = 'Other', remoteIp = null, remotePort = null) {
    const headers = normalizeHeaders(rawHeaders);
    const detection = detectCdnProvider(headers);
    const edge = extractEdgeEvidence(headers, detection.provider, remoteIp, remotePort);

    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch (e) {
        hostname = url || '';
    }

    const isDetected = detection.provider &&
        detection.provider !== 'Not Detected' &&
        detection.provider !== 'Unknown';

    return {
        provider: isDetected ? detection.provider : 'Not Detected',
        confidence: detection.confidence,
        matchedEvidence: detection.evidence || [],
        detectionMethod: isDetected ? 'response-header-inspection' : 'none',
        hostname,
        url,
        resourceType,
        edge,
        possibleLayers: detection.possibleLayers || [],
        limitations: isDetected ? [] : ['No definitive CDN provider signature found in response headers']
    };
}

/**
 * Groups per-resource CDN and edge detections by hostname, supporting multi-CDN
 * delivery architectures and preserving independent evidence per host.
 */
export function aggregateHostCdn(resourcesList = [], mainUrl = '') {
    let mainHost = '';
    try {
        if (mainUrl) mainHost = new URL(mainUrl).hostname;
    } catch (e) {}

    const byHost = {};
    const allProvidersSet = new Set();

    for (const res of resourcesList) {
        if (!res) continue;
        const host = res.hostname || (res.url ? (() => { try { return new URL(res.url).hostname; } catch(e){ return ''; } })() : '');
        if (!host) continue;

        if (!byHost[host]) {
            byHost[host] = {
                hostname: host,
                provider: 'Not Detected',
                confidence: 'none',
                isCdn: false,
                isMainHost: host === mainHost,
                requestCount: 0,
                encodedBytes: 0,
                remoteIps: [],
                edgePops: [],
                resourceTypes: [],
                evidence: [],
                detectedProviders: []
            };
        }

        const hostEntry = byHost[host];
        hostEntry.requestCount++;
        hostEntry.encodedBytes += (res.encodedDataLength || 0);

        const type = res.resourceType || res.type || 'Other';
        if (!hostEntry.resourceTypes.includes(type)) {
            hostEntry.resourceTypes.push(type);
        }

        const remoteIp = res.remoteIPAddress || res.edge?.remoteIp;
        if (remoteIp && !hostEntry.remoteIps.includes(remoteIp)) {
            hostEntry.remoteIps.push(remoteIp);
        }

        const edgePop = res.edge?.edgePop;
        if (edgePop && !hostEntry.edgePops.includes(edgePop)) {
            hostEntry.edgePops.push(edgePop);
        }

        const provider = res.cdn?.provider;
        const confidence = res.cdn?.confidence || 'none';
        if (provider && provider !== 'Not Detected' && provider !== 'Unknown') {
            allProvidersSet.add(provider);
            if (!hostEntry.detectedProviders.includes(provider)) {
                hostEntry.detectedProviders.push(provider);
            }

            const weightCurrent = CONF_WEIGHT[hostEntry.confidence] || 0;
            const weightNew = CONF_WEIGHT[confidence] || 0;
            if (weightNew > weightCurrent || hostEntry.provider === 'Not Detected') {
                hostEntry.provider = provider;
                hostEntry.confidence = confidence;
                hostEntry.isCdn = true;
            }
            if (res.cdn?.matchedEvidence) {
                for (const ev of res.cdn.matchedEvidence) {
                    if (!hostEntry.evidence.includes(ev)) {
                        hostEntry.evidence.push(ev);
                    }
                }
            }
        }
    }

    const allProviders = Array.from(allProvidersSet);
    const mainHostProvider = (mainHost && byHost[mainHost]) ? byHost[mainHost].provider : 'Not Detected';

    return {
        byHost,
        allProviders,
        mainHostProvider,
        crossHostCdnCount: allProviders.length
    };
}

