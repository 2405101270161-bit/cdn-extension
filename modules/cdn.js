import {
    HEADER_SIGNATURES,
    CNAME_SIGNATURES,
    IP_RANGE_SOURCES,
    CATEGORY_PRIORITY,
    KNOWN_LIMITATIONS
} from './providers.js';

export const CONF_WEIGHT = { high: 3, medium: 2, low: 1, none: 0 };
const STRENGTH_SCORE = { high: 3, medium: 2, low: 1 };

export const NOT_DETECTED = 'Not Detected';

const SENSITIVE_HEADER_KEYS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-auth-token',
    'x-api-key'
]);

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

export function scrubSensitiveHeaders(rawHeaders = {}) {
    const clean = {};
    for (const [k, v] of Object.entries(rawHeaders || {})) {
        if (!SENSITIVE_HEADER_KEYS.has(String(k).trim().toLowerCase())) {
            clean[k] = v;
        }
    }
    return clean;
}

function shorten(value, max = 48) {
    const s = String(value ?? '');
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Evidence collection
 * Every evidence item is explainable:
 *   { provider, category, source, key, matchedValue, strength,
 *     productSpecific, hostname, note }
 * ────────────────────────────────────────────────────────────────────────── */

export function collectHeaderEvidence(rawHeaders = {}, hostname = null) {
    const headers = normalizeHeaders(rawHeaders);
    const evidence = [];
    for (const sig of HEADER_SIGNATURES) {
        const value = headers[sig.header];
        if (value === undefined || value === null) continue;
        const str = String(value).trim();
        if (!str) continue;
        if (sig.match && !sig.match.test(str)) continue;
        evidence.push({
            provider: sig.provider,
            category: sig.category,
            source: 'response-header',
            key: sig.header,
            matchedValue: shorten(str),
            strength: sig.strength,
            productSpecific: Boolean(sig.productSpecific),
            hostname,
            note: sig.note || null
        });
    }
    return evidence;
}

export const CDN_CNAME_PATTERNS = CNAME_SIGNATURES;

export function collectCnameEvidence(cnames = [], hostname = null) {
    if (!Array.isArray(cnames)) return [];
    const evidence = [];
    const seen = new Set();
    for (const cname of cnames) {
        if (!cname || typeof cname !== 'string') continue;
        const normalized = cname.trim().toLowerCase().replace(/\.$/, '');
        for (const sig of CNAME_SIGNATURES) {
            if (sig.pattern.test(normalized) && !seen.has(sig.provider)) {
                seen.add(sig.provider);
                evidence.push({
                    provider: sig.provider,
                    category: sig.category,
                    source: 'dns-cname',
                    key: 'CNAME',
                    matchedValue: normalized,
                    strength: 'medium',
                    productSpecific: true,
                    hostname,
                    note: 'Hostname is a DNS alias of a provider-controlled domain'
                });
            }
        }
    }
    return evidence;
}

export function detectCdnFromCname(cnames = []) {
    const ev = collectCnameEvidence(cnames)[0];
    if (!ev) return null;
    return {
        provider: ev.provider,
        cname: ev.matchedValue,
        confidence: 'medium',
        evidence: `dns-cname: ${ev.matchedValue} -> ${ev.provider}`
    };
}

/* ── IP parsing (IPv4 + IPv6, proper CIDR matching) ───────────────────────── */

function parseIpv4(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0n;
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null;
        const n = Number(p);
        if (n > 255) return null;
        value = (value << 8n) | BigInt(n);
    }
    return value;
}

function parseIpv6(ip) {
    let addr = ip.toLowerCase();
    const zone = addr.indexOf('%');
    if (zone !== -1) addr = addr.slice(0, zone);

    // Embedded IPv4 (e.g. ::ffff:1.2.3.4)
    const lastColon = addr.lastIndexOf(':');
    if (addr.includes('.') && lastColon !== -1) {
        const v4 = parseIpv4(addr.slice(lastColon + 1));
        if (v4 === null) return null;
        const hi = Number((v4 >> 16n) & 0xffffn).toString(16);
        const lo = Number(v4 & 0xffffn).toString(16);
        addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
    }

    const halves = addr.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let groups;
    if (halves.length === 2) {
        const fill = 8 - head.length - tail.length;
        if (fill < 0) return null;
        groups = [...head, ...Array(fill).fill('0'), ...tail];
    } else {
        groups = head;
    }
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const g of groups) {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
        value = (value << 16n) | BigInt(parseInt(g, 16));
    }
    return value;
}

export function parseIp(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const ip = raw.trim().replace(/^\[|\]$/g, '');
    if (ip.includes(':')) {
        const v = parseIpv6(ip);
        return v === null ? null : { version: 6, value: v, text: ip.toLowerCase() };
    }
    const v = parseIpv4(ip);
    return v === null ? null : { version: 4, value: v, text: ip };
}

export function ipInCidr(parsedIp, cidr) {
    const slash = cidr.indexOf('/');
    if (slash === -1 || !parsedIp) return false;
    const base = parseIp(cidr.slice(0, slash));
    const bits = parseInt(cidr.slice(slash + 1), 10);
    if (!base || base.version !== parsedIp.version || !Number.isInteger(bits)) return false;
    const width = parsedIp.version === 4 ? 32 : 128;
    if (bits < 0 || bits > width) return false;
    if (bits === 0) return true;
    const shift = BigInt(width - bits);
    return (parsedIp.value >> shift) === (base.value >> shift);
}

export const CDN_IP_RANGES = IP_RANGE_SOURCES;

export function collectIpEvidence(remoteIp, hostname = null) {
    const parsed = parseIp(remoteIp);
    if (!parsed) return [];
    for (const src of IP_RANGE_SOURCES) {
        const list = parsed.version === 4 ? src.ipv4 : src.ipv6;
        for (const cidr of (list || [])) {
            if (ipInCidr(parsed, cidr)) {
                return [{
                    provider: src.provider,
                    category: src.category,
                    source: 'ip-range',
                    key: 'remote-ip',
                    matchedValue: `${parsed.text} in ${cidr}`,
                    strength: 'low',
                    productSpecific: false,
                    hostname,
                    note: `Network ownership only (published range, ${src.source}, retrieved ${src.retrieved})`
                }];
            }
        }
    }
    return [];
}

export function detectCdnFromIp(remoteIp) {
    const ev = collectIpEvidence(remoteIp)[0];
    if (!ev) return null;
    return {
        provider: ev.provider,
        ip: parseIp(remoteIp).text,
        confidence: 'low',
        evidence: `remote-ip: ${ev.matchedValue} (${ev.provider} published range)`
    };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Evidence aggregation and conflict handling
 * ────────────────────────────────────────────────────────────────────────── */

export function formatEvidence(ev) {
    const sourceLabel = ev.source === 'response-header' ? '' : ev.source === 'dns-cname' ? 'dns-cname: ' : 'remote-ip: ';
    const value = ev.source === 'response-header' ? `${ev.key}: ${ev.matchedValue}` : ev.matchedValue;
    const scope = ev.productSpecific ? 'product-specific' : 'network/edge ownership only';
    return `${sourceLabel}${value} (${ev.strength}, ${scope})`;
}

function summarizeProvider(provider, items) {
    const sources = new Set(items.map(e => e.source));
    const hasProductSpecific = items.some(e => e.productSpecific);
    const hasHighProduct = items.some(e => e.strength === 'high' && e.productSpecific);
    const hasMediumOrHigh = items.some(e => e.strength === 'high' || e.strength === 'medium');
    const onlyGenericLow = items.every(e => e.source === 'response-header' && e.strength === 'low' && !e.productSpecific);

    let confidence = 'low';
    if (hasHighProduct) confidence = 'high';
    else if (hasMediumOrHigh) confidence = 'medium';

    // Independent sources (e.g. header + CNAME) corroborate each other.
    if (confidence === 'medium' && hasProductSpecific &&
        sources.has('dns-cname') && sources.has('response-header')) {
        confidence = 'high';
    }

    const score = items.reduce((s, e) => s + (STRENGTH_SCORE[e.strength] || 0), 0);
    const category = items.reduce((best, e) =>
        (CATEGORY_PRIORITY[e.category] || 0) > (CATEGORY_PRIORITY[best] || 0) ? e.category : best,
        items[0].category);

    return {
        provider,
        category,
        confidence,
        score,
        productSpecific: hasProductSpecific,
        supportingOnly: onlyGenericLow,
        sources: Array.from(sources),
        evidenceDetails: items,
        evidence: items.map(formatEvidence)
    };
}

const METHOD_BY_SOURCE = {
    'response-header': 'response-header-inspection',
    'dns-cname': 'dns-cname-inspection',
    'ip-range': 'ip-range-fallback'
};

/**
 * Combine evidence from every source into one transparent verdict.
 *  - Generic low-strength header hints never create a detection on their own.
 *  - Storage/origin providers never outrank a delivery provider.
 *  - When two delivery providers both have high-confidence evidence, the one that owns
 *    the connected IP is the outer layer; otherwise CDN > security > edge > hosting.
 *    The conflict is always reported.
 */
export function aggregateEvidence(allEvidence = [], options = {}) {
    const byProvider = new Map();
    for (const ev of allEvidence) {
        if (!byProvider.has(ev.provider)) byProvider.set(ev.provider, []);
        byProvider.get(ev.provider).push(ev);
    }

    const candidates = [];
    for (const [provider, items] of byProvider.entries()) {
        const summary = summarizeProvider(provider, items);
        if (summary.supportingOnly) continue;
        candidates.push(summary);
    }

    const ipOwner = allEvidence.find(e => e.source === 'ip-range')?.provider || null;

    const rank = (c) => [
        c.category === 'storage' ? 0 : 1,
        CONF_WEIGHT[c.confidence] || 0,
        c.provider === ipOwner ? 1 : 0,
        CATEGORY_PRIORITY[c.category] || 0,
        c.score
    ];
    candidates.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) {
            if (ra[i] !== rb[i]) return rb[i] - ra[i];
        }
        return 0;
    });

    const notes = [];
    if (candidates.length === 0) {
        return {
            provider: NOT_DETECTED,
            status: 'unidentified',
            category: null,
            confidence: 'none',
            evidence: [],
            evidenceDetails: [],
            allEvidence,
            possibleLayers: [],
            detectionMethod: 'none',
            conflict: false,
            notes: ['No provider-specific CDN signature was found. This does not prove the content is served directly from origin.'],
            limitations: KNOWN_LIMITATIONS.slice()
        };
    }

    const primary = candidates[0];
    const others = candidates.slice(1);
    const conflicting = others.filter(c => c.category !== 'storage' && c.confidence === 'high' && primary.confidence === 'high');
    if (conflicting.length > 0) {
        notes.push(`Multiple delivery providers have high-confidence evidence (${[primary.provider, ...conflicting.map(c => c.provider)].join(', ')}). ` +
            (primary.provider === ipOwner
                ? `${primary.provider} owns the connected IP, so it is reported as the outer layer.`
                : `${primary.provider} is reported as the outer layer by category priority; the exact layering cannot be confirmed.`));
    }
    if (primary.provider === 'Google Front End') {
        notes.push('Google Front End evidence shows Google edge infrastructure. It does not confirm the Google Cloud CDN product.');
    }
    if (!primary.productSpecific) {
        notes.push(`Evidence for ${primary.provider} shows network/edge ownership only, not a specific CDN product.`);
    }

    const bestSource = ['response-header', 'dns-cname', 'ip-range'].find(s => primary.sources.includes(s));

    return {
        provider: primary.provider,
        status: primary.productSpecific ? 'identified' : 'network-only',
        category: primary.category,
        confidence: primary.confidence,
        evidence: primary.evidence,
        evidenceDetails: primary.evidenceDetails,
        allEvidence,
        possibleLayers: others.map(c => ({
            provider: c.provider,
            category: c.category,
            role: c.category === 'storage' ? 'origin-storage' : 'additional-layer',
            confidence: c.confidence,
            evidence: c.evidence,
            evidenceDetails: c.evidenceDetails
        })),
        detectionMethod: METHOD_BY_SOURCE[bestSource] || 'none',
        conflict: conflicting.length > 0,
        notes,
        limitations: []
    };
}

export function detectCdnProvider(rawHeaders = {}, options = {}) {
    const hostname = options.hostname || options.dnsInfo?.hostname || null;
    const cnames = options.cnames || (options.dnsInfo && options.dnsInfo.cnames) || [];
    const evidence = [
        ...collectHeaderEvidence(rawHeaders, hostname),
        ...collectCnameEvidence(cnames, hostname),
        ...collectIpEvidence(options.remoteIp, hostname)
    ];
    const result = aggregateEvidence(evidence, options);
    result.dnsInfo = options.dnsInfo || null;
    return result;
}

/* ──────────────────────────────────────────────────────────────────────────
 * DNS-over-HTTPS CNAME resolution
 * ────────────────────────────────────────────────────────────────────────── */

const DOH_ENDPOINTS = [
    (host) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    (host) => `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`
];

export function isResolvableHostname(hostname) {
    if (!hostname || typeof hostname !== 'string') return false;
    const h = hostname.trim().toLowerCase().replace(/\.$/, '');
    if (!h || h.length > 253 || !h.includes('.')) return false;
    if (!/^[a-z0-9.-]+$/.test(h)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
    if (/\.(?:local|localhost|internal|test|invalid|example)$/.test(h)) return false;
    return true;
}

/**
 * Resolve the CNAME chain for one hostname. An A query is used because resolvers
 * return the full alias chain in the answer section. Timers are always cleared.
 */
export async function resolveDnsCname(hostname, opts = {}) {
    if (!isResolvableHostname(hostname)) return null;
    const cleanHost = hostname.trim().toLowerCase().replace(/\.$/, '');
    const timeoutMs = opts.timeoutMs || 2000;
    const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) return null;

    for (const endpoint of DOH_ENDPOINTS) {
        if (opts.signal?.aborted) return null;
        const controller = new AbortController();
        const onOuterAbort = () => controller.abort();
        if (opts.signal) opts.signal.addEventListener('abort', onOuterAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(endpoint(cleanHost), {
                headers: { accept: 'application/dns-json' },
                signal: controller.signal
            });
            if (!res || !res.ok) continue;
            const data = await res.json();
            const answers = Array.isArray(data?.Answer) ? data.Answer : [];
            const cnames = answers
                .filter(rec => rec && rec.type === 5 && rec.data)
                .map(rec => String(rec.data).trim().toLowerCase().replace(/\.$/, ''));
            return {
                hostname: cleanHost,
                cnames,
                primaryCname: cnames[0] || null,
                resolver: new URL(endpoint(cleanHost)).hostname
            };
        } catch (e) {
            // try the next resolver
        } finally {
            clearTimeout(timer);
            if (opts.signal) opts.signal.removeEventListener('abort', onOuterAbort);
        }
    }
    return null;
}

/**
 * Resolve many hostnames with deduplication, a concurrency limit, a host cap,
 * an overall time budget and cancellation.
 */
export async function resolveHostCnames(hostnames = [], opts = {}) {
    const {
        concurrency = 6,
        maxHosts = 30,
        budgetMs = 3500,
        timeoutMs = 2000,
        signal = null,
        fetch: fetchImpl
    } = opts;

    const unique = Array.from(new Set(
        (hostnames || [])
            .filter(Boolean)
            .map(h => String(h).trim().toLowerCase().replace(/\.$/, ''))
            .filter(isResolvableHostname)
    ));
    const queue = unique.slice(0, maxHosts);
    const skipped = unique.slice(maxHosts);
    const results = new Map();

    const budgetController = new AbortController();
    const onOuterAbort = () => budgetController.abort();
    if (signal) {
        if (signal.aborted) budgetController.abort();
        else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const budgetTimer = setTimeout(() => budgetController.abort(), budgetMs);

    try {
        let index = 0;
        const worker = async () => {
            while (index < queue.length && !budgetController.signal.aborted) {
                const host = queue[index++];
                const info = await resolveDnsCname(host, {
                    timeoutMs,
                    signal: budgetController.signal,
                    fetch: fetchImpl
                });
                if (info) results.set(host, info);
            }
        };
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, worker);
        await Promise.all(workers);
    } finally {
        clearTimeout(budgetTimer);
        if (signal) signal.removeEventListener('abort', onOuterAbort);
    }

    const unresolved = queue.filter(h => !results.has(h));
    return {
        results,
        attempted: queue.length,
        resolved: results.size,
        unresolved,
        skipped,
        timedOut: budgetController.signal.aborted && !(signal && signal.aborted),
        cancelled: Boolean(signal && signal.aborted)
    };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Cache analysis
 * ────────────────────────────────────────────────────────────────────────── */

const CACHE_STATUS_HEADERS = [
    'cf-cache-status',
    'x-vercel-cache',
    'x-nf-cache-status',
    'akamai-cache-status',
    'x-akamai-cache-status',
    'x-sucuri-cache',
    'x-77-cache',
    'cdn-cache',
    'x-cache',
    'x-cache-remote',
    'x-cache-hits',
    'x-proxy-cache',
    'cache-status'
];

function classifyCacheToken(token) {
    const v = String(token || '').trim().toUpperCase();
    if (!v) return 'UNKNOWN';
    if (v.includes('DYNAMIC')) return 'DYNAMIC';
    if (v.includes('BYPASS')) return 'BYPASS';
    if (v.includes('REFRESH') || v.includes('REVALIDATED')) return 'REVALIDATED';
    if (v.includes('EXPIRED')) return 'EXPIRED';
    if (v.includes('STALE') || v.includes('UPDATING')) return 'STALE';
    if (v.includes('HIT')) return 'HIT';
    if (v.includes('MISS')) return 'MISS';
    return 'UNKNOWN';
}

/** RFC 9211 Cache-Status: `"Netlify Edge"; hit, Origin; fwd=miss` → closest-to-client is last. */
function classifyRfc9211(value) {
    const entries = String(value).split(',').map(s => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (!last) return 'UNKNOWN';
    const params = last.split(';').slice(1).map(p => p.trim().toLowerCase());
    if (params.includes('hit')) return 'HIT';
    const fwd = params.find(p => p.startsWith('fwd='));
    if (fwd) {
        const reason = fwd.slice(4);
        if (reason === 'bypass') return 'BYPASS';
        if (reason === 'stale') return 'REVALIDATED';
        if (reason.includes('miss')) return 'MISS';
        return 'MISS';
    }
    return 'UNKNOWN';
}

export function classifyCacheHeader(header, rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) return 'UNKNOWN';
    if (header === 'cache-status') return classifyRfc9211(value);
    if (header === 'x-cache-hits') {
        const counts = value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (counts.length === 0) return 'UNKNOWN';
        return counts[counts.length - 1] > 0 || counts.some(n => n > 0) ? 'HIT' : 'MISS';
    }
    // Multi-tier values ("MISS, HIT") list tiers from origin side to client side;
    // the last token is the edge closest to the visitor.
    const tokens = value.split(',').map(s => s.trim()).filter(Boolean);
    if (tokens.length > 1 && tokens.every(t => /^[A-Za-z_ -]+$/.test(t) && t.length < 24)) {
        return classifyCacheToken(tokens[tokens.length - 1]);
    }
    return classifyCacheToken(value);
}

function parseCacheControl(cacheControl) {
    const directives = cacheControl
        ? cacheControl.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    const map = {};
    for (const d of directives) {
        const eq = d.indexOf('=');
        const name = (eq === -1 ? d : d.slice(0, eq)).trim().toLowerCase();
        const val = eq === -1 ? true : d.slice(eq + 1).trim().replace(/^"|"$/g, '');
        map[name] = val;
    }
    const num = (v) => (v === undefined || v === true) ? null : (/^\d+$/.test(String(v)) ? parseInt(v, 10) : null);
    return {
        directives,
        noStore: 'no-store' in map,
        noCache: 'no-cache' in map,
        isPrivate: 'private' in map,
        isPublic: 'public' in map,
        maxAge: num(map['max-age']),
        sMaxAge: num(map['s-maxage']),
        immutable: 'immutable' in map,
        mustRevalidate: 'must-revalidate' in map
    };
}

export function analyzeCacheDetails(rawHeaders = {}, cdpContext = {}) {
    const headers = normalizeHeaders(rawHeaders);

    const fromDiskCache = Boolean(cdpContext && cdpContext.fromDiskCache);
    const fromMemoryCache = Boolean(cdpContext && (cdpContext.fromMemoryCache || cdpContext.servedFromCache));
    const fromPrefetchCache = Boolean(cdpContext && cdpContext.fromPrefetchCache);
    const browserCacheType = fromDiskCache ? 'disk' : (fromMemoryCache ? 'memory' : (fromPrefetchCache ? 'prefetch' : null));
    const browserCache = {
        servedFromCache: Boolean(browserCacheType),
        type: browserCacheType,
        evidence: browserCacheType ? `cdp:from-${browserCacheType}-cache` : null
    };

    const fromServiceWorker = Boolean(cdpContext && cdpContext.fromServiceWorker);
    const serviceWorker = {
        fulfilledByServiceWorker: fromServiceWorker,
        evidence: fromServiceWorker ? 'cdp:fromServiceWorker' : null
    };

    // Preserve every cache-layer header instead of keeping only one.
    const layers = [];
    for (const header of CACHE_STATUS_HEADERS) {
        const raw = headers[header];
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        layers.push({
            header,
            rawValue: String(raw).trim(),
            status: classifyCacheHeader(header, raw),
            evidence: `${header}: ${String(raw).trim()}`
        });
    }
    const primaryLayer = layers.find(l => l.status !== 'UNKNOWN') || layers[0] || null;

    const cdnCache = {
        status: primaryLayer ? primaryLayer.status : 'NONE',
        header: primaryLayer ? primaryLayer.header : null,
        rawValue: primaryLayer ? primaryLayer.rawValue : null,
        evidence: primaryLayer ? primaryLayer.evidence : null,
        layers
    };

    const cacheControl = headers['cache-control'] ? String(headers['cache-control']).toLowerCase() : null;
    const pragma = headers['pragma'] ? String(headers['pragma']).toLowerCase() : null;
    const expires = headers['expires'] || null;
    const ageRaw = headers['age'] || null;
    let ageSeconds = null;
    if (ageRaw && /^\d+$/.test(String(ageRaw).trim())) {
        ageSeconds = parseInt(String(ageRaw).trim(), 10);
    }

    const cc = parseCacheControl(cacheControl);
    let policyStatus = 'No Cache Directives';
    if (cacheControl) {
        if (cc.noStore) {
            policyStatus = 'Not Cacheable';
        } else if (cc.noCache) {
            policyStatus = 'Revalidate Required';
        } else if (cc.isPrivate) {
            policyStatus = 'Private Cacheable';
        } else if ((cc.sMaxAge !== null && cc.sMaxAge > 0) || (cc.maxAge !== null && cc.maxAge > 0) || cc.isPublic) {
            policyStatus = 'Cacheable';
        } else if (cc.maxAge === 0 || cc.sMaxAge === 0) {
            policyStatus = 'Revalidate Required';
        }
    } else if (expires) {
        policyStatus = 'Cacheable (Expires)';
    }

    const cachePolicy = {
        status: policyStatus,
        cacheControl,
        directives: cc.directives,
        noStore: cc.noStore,
        noCache: cc.noCache,
        isPrivate: cc.isPrivate,
        isPublic: cc.isPublic,
        maxAge: cc.maxAge,
        sMaxAge: cc.sMaxAge,
        sharedCacheable: !cc.noStore && !cc.isPrivate,
        expires,
        ageSeconds,
        hasValidation: Boolean(headers['etag'] || headers['last-modified'])
    };

    let summary;
    if (cdnCache.status !== 'NONE' && cdnCache.status !== 'UNKNOWN') {
        summary = cdnCache.status;
    } else if (serviceWorker.fulfilledByServiceWorker) {
        summary = 'Service Worker';
    } else if (browserCache.servedFromCache) {
        summary = browserCache.type === 'memory' ? 'Memory Cache' : 'Disk Cache';
    } else if (['Not Cacheable', 'Revalidate Required', 'Private Cacheable'].includes(policyStatus)) {
        summary = policyStatus;
    } else if (policyStatus.startsWith('Cacheable')) {
        summary = 'Cacheable';
    } else if (cacheControl || expires || ageRaw || headers['etag'] || headers['last-modified'] || pragma || layers.length) {
        summary = 'Unknown';
    } else {
        summary = 'No Cache Headers';
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
    return analyzeCacheDetails(headers, cdpContext).summary;
}

const EDGE_HEADER_PROVIDER = {
    'cf-ray': 'Cloudflare',
    'x-amz-cf-pop': 'Amazon CloudFront',
    'x-amz-cf-id': 'Amazon CloudFront',
    'x-served-by': 'Fastly',
    'x-fastly-request-id': 'Fastly',
    'akamai-grn': 'Akamai',
    'x-akamai-request-id': 'Akamai',
    'x-vercel-id': 'Vercel',
    'x-77-pop': 'CDN77'
};

export function extractEdgeEvidence(rawHeaders = {}, providerName = '', remoteIp = null, remotePort = null) {
    const allHeaders = normalizeHeaders(rawHeaders);
    // When a provider was identified, ignore edge headers that belong to a different
    // provider so the reported PoP is the identified provider's edge.
    const hasKnownProvider = providerName && providerName !== NOT_DETECTED &&
        Object.keys(allHeaders).some(k => EDGE_HEADER_PROVIDER[k] === providerName);
    const headers = {};
    for (const [k, v] of Object.entries(allHeaders)) {
        const owner = EDGE_HEADER_PROVIDER[k];
        if (hasKnownProvider && owner && owner !== providerName) continue;
        headers[k] = v;
    }
    let edgePop = null;
    let popCode = null;
    let evidenceSource = null;
    let requestIdentifier = null;

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
    }

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

    if (headers['x-served-by']) {
        const rawServed = String(headers['x-served-by']).trim();
        evidenceSource = 'x-served-by';
        const hops = rawServed.split(',').map(s => s.trim()).filter(Boolean);
        const lastHop = hops[hops.length - 1] || rawServed;
        edgePop = lastHop;
        const m = lastHop.match(/-([A-Za-z]{3,4})$/) || lastHop.match(/cache-([a-z0-9]+)-([A-Za-z]{3,4})/i);
        if (m) {
            popCode = (m[2] || m[1]).toUpperCase();
        }
    }
    if (headers['x-fastly-request-id']) {
        requestIdentifier = String(headers['x-fastly-request-id']).trim();
        if (!evidenceSource) evidenceSource = 'x-fastly-request-id';
    }

    if (headers['akamai-grn']) {
        requestIdentifier = String(headers['akamai-grn']).trim();
        evidenceSource = 'akamai-grn';
    } else if (headers['x-akamai-request-id']) {
        requestIdentifier = String(headers['x-akamai-request-id']).trim();
        if (!evidenceSource) {
            evidenceSource = 'x-akamai-request-id';
        }
    }

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

    if (headers['x-77-pop']) {
        edgePop = String(headers['x-77-pop']).trim();
        evidenceSource = 'x-77-pop';
    }

    if (headers['x-edge-location'] && !edgePop) {
        edgePop = String(headers['x-edge-location']).trim();
        evidenceSource = 'x-edge-location';
    }

    if (headers['b-ray'] && !edgePop) {
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


export function detectResourceCdn(rawHeaders = {}, url = '', resourceType = 'Other', remoteIp = null, remotePort = null, options = {}) {
    const headers = normalizeHeaders(rawHeaders);

    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch (e) {
        hostname = url || '';
    }

    const detection = detectCdnProvider(headers, {
        remoteIp,
        hostname,
        cnames: options.cnames || [],
        dnsInfo: options.dnsInfo || null
    });
    const edge = extractEdgeEvidence(headers, detection.provider, remoteIp, remotePort);
    const isDetected = detection.provider && detection.provider !== NOT_DETECTED;

    return {
        provider: isDetected ? detection.provider : NOT_DETECTED,
        status: detection.status,
        category: detection.category,
        confidence: detection.confidence,
        matchedEvidence: detection.evidence || [],
        evidenceDetails: detection.evidenceDetails || [],
        detectionMethod: isDetected ? detection.detectionMethod : 'none',
        conflict: detection.conflict,
        notes: detection.notes || [],
        hostname,
        url,
        resourceType,
        edge,
        possibleLayers: detection.possibleLayers || [],
        limitations: isDetected ? [] : ['No provider-specific CDN signature found for this request (not proof of direct origin delivery)']
    };
}

function isIdentified(provider) {
    return Boolean(provider) && provider !== NOT_DETECTED && provider !== 'Unknown';
}

/**
 * Per-host aggregation. Each host records how many requests matched each provider,
 * and the host's provider is the one with the strongest confidence (ties broken by
 * request count) — every count is kept so the choice is explainable.
 */
export function aggregateHostCdn(resourcesList = [], mainUrl = '') {
    let mainHost = '';
    try {
        if (mainUrl) mainHost = new URL(mainUrl).hostname;
    } catch (e) {}

    const byHost = {};
    const allProvidersSet = new Set();
    const assetProviderMap = new Map();
    let identifiedRequestCount = 0;
    let totalRequestCount = 0;
    let documentProvider = null;

    for (const res of resourcesList) {
        if (!res) continue;
        const host = res.hostname || (res.url ? (() => { try { return new URL(res.url).hostname; } catch (e) { return ''; } })() : '');
        if (!host) continue;
        totalRequestCount++;

        if (!byHost[host]) {
            byHost[host] = {
                hostname: host,
                provider: NOT_DETECTED,
                confidence: 'none',
                status: 'unidentified',
                isCdn: false,
                isMainHost: host === mainHost,
                requestCount: 0,
                cdnCount: 0,
                encodedBytes: 0,
                remoteIps: [],
                edgePops: [],
                resourceTypes: [],
                evidence: [],
                detectedProviders: [],
                providerCounts: {},
                cnames: res.cnames || []
            };
        }

        const hostEntry = byHost[host];
        hostEntry.requestCount++;
        hostEntry.encodedBytes += (res.encodedDataLength || 0);

        const type = res.resourceType || res.type || 'Other';
        if (!hostEntry.resourceTypes.includes(type)) hostEntry.resourceTypes.push(type);

        const remoteIp = res.remoteIPAddress || res.edge?.remoteIp;
        if (remoteIp && !hostEntry.remoteIps.includes(remoteIp)) hostEntry.remoteIps.push(remoteIp);

        const edgePop = res.edge?.edgePop;
        if (edgePop && !hostEntry.edgePops.includes(edgePop)) hostEntry.edgePops.push(edgePop);

        const provider = res.cdn?.provider;
        const confidence = res.cdn?.confidence || 'none';
        if (!isIdentified(provider)) continue;

        identifiedRequestCount++;
        hostEntry.cdnCount++;
        allProvidersSet.add(provider);
        if (!hostEntry.detectedProviders.includes(provider)) hostEntry.detectedProviders.push(provider);

        const pc = hostEntry.providerCounts[provider] || { count: 0, bestConfidence: 'none', status: res.cdn?.status || 'identified' };
        pc.count++;
        if ((CONF_WEIGHT[confidence] || 0) > (CONF_WEIGHT[pc.bestConfidence] || 0)) pc.bestConfidence = confidence;
        hostEntry.providerCounts[provider] = pc;

        for (const ev of (res.cdn?.matchedEvidence || [])) {
            if (!hostEntry.evidence.includes(ev) && hostEntry.evidence.length < 12) hostEntry.evidence.push(ev);
        }

        const isDocument = String(type).toLowerCase() === 'document';
        if (isDocument && host === mainHost && !documentProvider) {
            documentProvider = provider;
        }
        if (!isDocument) {
            const ap = assetProviderMap.get(provider) || { provider, requestCount: 0, hosts: [] };
            ap.requestCount++;
            if (!ap.hosts.includes(host)) ap.hosts.push(host);
            assetProviderMap.set(provider, ap);
        }
    }

    for (const hostEntry of Object.values(byHost)) {
        const ranked = Object.entries(hostEntry.providerCounts).sort((a, b) => {
            const cw = (CONF_WEIGHT[b[1].bestConfidence] || 0) - (CONF_WEIGHT[a[1].bestConfidence] || 0);
            return cw !== 0 ? cw : b[1].count - a[1].count;
        });
        if (ranked.length > 0) {
            const [provider, info] = ranked[0];
            hostEntry.provider = provider;
            hostEntry.confidence = info.bestConfidence;
            hostEntry.status = info.status;
            hostEntry.isCdn = true;
        }
    }

    const allProviders = Array.from(allProvidersSet);
    const mainHostProvider = (mainHost && byHost[mainHost]) ? byHost[mainHost].provider : NOT_DETECTED;

    return {
        byHost,
        allProviders,
        mainHostProvider,
        crossHostCdnCount: allProviders.length,
        delivery: {
            documentProvider: documentProvider || NOT_DETECTED,
            assetProviders: Array.from(assetProviderMap.values()).sort((a, b) => b.requestCount - a.requestCount),
            identifiedRequestCount,
            unidentifiedRequestCount: totalRequestCount - identifiedRequestCount,
            totalRequestCount
        }
    };
}
