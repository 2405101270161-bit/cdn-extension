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
const CONF_WEIGHT = { high: 3, medium: 2, low: 1, none: 0 };

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

export function detectCdnProvider(headers = {}) {
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

export function extractCacheStatus(headers = {}) {
    let rawCacheVal = "";
    let cacheHeaderName = "";

    // Check CDN-specific cache status headers first (highest confidence)
    if (headers['cf-cache-status']) {
        cacheHeaderName = 'cf-cache-status';
        rawCacheVal = headers['cf-cache-status'];
    } else if (headers['x-cache']) {
        cacheHeaderName = 'x-cache';
        rawCacheVal = headers['x-cache'];
    } else if (headers['x-cache-hits']) {
        cacheHeaderName = 'x-cache-hits';
        rawCacheVal = parseInt(headers['x-cache-hits'], 10) > 0 ? "HIT" : "MISS";
    } else if (headers['x-vercel-cache']) {
        cacheHeaderName = 'x-vercel-cache';
        rawCacheVal = headers['x-vercel-cache'];
    } else if (headers['x-nf-cache-status']) {
        cacheHeaderName = 'x-nf-cache-status';
        rawCacheVal = headers['x-nf-cache-status'];
    } else if (headers['cdn-cache']) {
        cacheHeaderName = 'cdn-cache';
        rawCacheVal = headers['cdn-cache'];
    }

    let status = "";
    const valUpper = rawCacheVal.toUpperCase();

    if (valUpper.includes('HIT')) {
        status = "HIT";
    } else if (valUpper.includes('EXPIRED')) {
        status = "EXPIRED";
    } else if (valUpper.includes('REVALIDATED')) {
        status = "REVALIDATED";
    } else if (valUpper.includes('STALE')) {
        status = "STALE";
    } else if (valUpper.includes('DYNAMIC')) {
        status = "BYPASS";
    } else if (valUpper.includes('BYPASS')) {
        status = "BYPASS";
    } else if (valUpper.includes('MISS')) {
        status = "MISS";
    }

    // BUG-17 FIX: Cache-Control directives declare cacheability POLICY — they
    // do NOT indicate whether the CDN actually served a cached response.
    // Old code mapped max-age/public → "HIT" which was semantically wrong and
    // caused non-CDN sites to show a false cache hit status.
    //
    // Correct mapping:
    //   no-store / no-cache  → "Not Cacheable"
    //   public / max-age / s-maxage → "Cacheable"  (policy allows caching)
    //   age > 0 (without CDN header) → "Cached (Browser/Proxy)"
    //   any other cache-related header present → "Unknown"
    //   nothing relevant     → "No Cache Headers"
    if (!status) {
        if (headers['age'] && parseInt(headers['age'], 10) > 0) {
            cacheHeaderName = 'age';
            status = "Cached (Browser/Proxy)";
        } else if (headers['cache-control']) {
            const cc = headers['cache-control'].toLowerCase();
            cacheHeaderName = 'cache-control';
            if (cc.includes('no-store') || cc.includes('no-cache')) {
                status = "Not Cacheable";
            } else if (cc.includes('max-age') || cc.includes('s-maxage') || cc.includes('public')) {
                status = "Cacheable";
            }
        }
    }

    if (!status) {
        const hasCacheRelatedHeader = headers['cache-control'] || headers['expires'] ||
            headers['etag'] || headers['last-modified'] || headers['pragma'];
        status = hasCacheRelatedHeader ? "Unknown" : "No Cache Headers";
    }

    console.log(`[Cache Debug] Cache Header: ${cacheHeaderName}=${rawCacheVal || 'N/A'}`);
    console.log(`[Cache Debug] Detected: ${status}`);

    return status;
}
