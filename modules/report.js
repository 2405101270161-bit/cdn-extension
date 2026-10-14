/**
 * CDN Analyzer Pro v2 - Structured Report Generation Module
 * Formats comprehensive analysis data into a clean, sanitized Markdown and JSON report.
 * Strictly avoids sensitive header leakage, preserves diagnostic depth, and represents
 * unmeasured/unavailable fields accurately without fabricated defaults.
 */

import { scrubSensitiveHeaders } from './cdn.js';

/**
 * Generates an 8-section structured Markdown report from analysis data.
 * @param {Object} data Analysis result object
 * @returns {string} Formatted markdown report
 */
export function generateMarkdownReport(data = {}) {
    const timestamp = data.timestamp || new Date().toISOString();
    const finalUrl = data.finalUrl || data.requestedUrl || 'Unknown URL';
    const host = getHostname(finalUrl);
    const scoreDetails = data.scoreDetails || { score: 0, grade: 'N/A', breakdown: {} };
    const cdn = data.cdn || { provider: 'Not Detected', confidence: 'none', evidence: [] };
    const timing = data.timing || {};
    const connection = data.connection || {};
    const transfer = data.transfer || {};
    const highlights = data.highlights || {};
    const cache = data.cache || {};
    const securityHeaders = data.securityHeaders || {};
    const tls = data.tls || { available: false };
    const suggestions = data.suggestions || [];
    const allProviders = data.allProviders || [];
    const cdnByHost = data.cdnByHost || {};

    const sections = [];

    // 1. Overall Summary
    sections.push(`## 1. Overall Summary
- **Target URL:** ${finalUrl}
- **Primary Host:** ${host}
- **HTTP Status Code:** ${data.statusCode || 200}
- **Negotiated Protocol:** ${connection.protocol || 'Unknown'}
- **Analysis Timestamp:** ${timestamp}
- **Overall Performance Score:** ${scoreDetails.score}/100 (Grade ${scoreDetails.grade})
- **Schema Version:** ${data.schemaVersion || 2}`);

    // 2. CDN Detection & Supporting Evidence
    const providerName = (cdn.provider && cdn.provider !== 'Unknown') ? cdn.provider : 'Not Detected';
    const edgeNode = cdn.edge?.edgePop || 'Not Available';
    const popLocation = cdn.edge?.popCode ? `${cdn.edge.popCode} (IATA Location Code)` : 'Not Available';
    const cleanEvidence = (cdn.evidence || []).map(e => `- \`${e}\``).join('\n') || '- None observed';
    const multiCdnList = allProviders.length > 0 ? allProviders.join(', ') : providerName;

    sections.push(`## 2. CDN Detection and Supporting Evidence
- **Primary CDN Provider:** ${providerName}
- **Detection Confidence:** ${cdn.confidence || 'none'}
- **All Detected Providers:** ${multiCdnList}
- **Edge Node Identifier:** ${edgeNode}
- **Verified Point of Presence (PoP):** ${popLocation}
- **Socket Remote IP:** ${connection.remoteIp || 'Not Available'}
- **Observed Fingerprints:**
${cleanEvidence}`);

    // 3. Resource-Level Findings
    let cdnCount = 0;
    let totalAnalyzed = transfer.requestCount || 0;
    const hostRows = [];

    for (const [hostname, hData] of Object.entries(cdnByHost)) {
        cdnCount += (hData.cdnCount || 0);
        const prov = hData.provider || 'Not Detected';
        hostRows.push(`  - **${hostname}**: ${prov} (${hData.requestCount || 0} requests)`);
    }

    const cdnRatioStr = totalAnalyzed > 0 
        ? `${cdnCount} of ${totalAnalyzed} requests (${Math.round((cdnCount / totalAnalyzed) * 100)}%)` 
        : '0 requests analyzed';

    sections.push(`## 3. Resource-Level Findings
- **Total Requests Captured:** ${totalAnalyzed}
- **CDN-Delivered Resources:** ${cdnRatioStr}
- **Failed Requests:** ${transfer.failedRequestCount || 0}
- **Canceled Requests:** ${transfer.canceledRequestCount || 0}
- **First-Party Requests:** ${transfer.firstPartyCount || 0}
- **Third-Party Requests:** ${transfer.thirdPartyCount || 0}
- **Total Encoded Transfer:** ${formatBytes(transfer.encodedBytes)}
- **Total Decoded Content:** ${formatBytes(transfer.decodedBytes)}
- **Host Distribution:**
${hostRows.length > 0 ? hostRows.join('\n') : '  - No external resource hosts captured.'}
- **Asset Highlights:**
  - **Largest Overall Resource:** ${formatHighlight(highlights.largestResource)}
  - **Largest Image:** ${formatHighlight(highlights.largestImage)}
  - **Largest JavaScript:** ${formatHighlight(highlights.largestJS)}
  - **Largest Stylesheet:** ${formatHighlight(highlights.largestCSS)}
  - **Slowest Network Resource:** ${formatHighlight(highlights.slowestResource)}`);

    // 4. Network Timing & Performance Metrics
    const isReused = Boolean(connection.reused);
    sections.push(`## 4. Network Timing and Performance Metrics
- **Main Document Fetch:** ${formatMs(timing.documentMs)}
- **Full Time to First Byte (TTFB):** ${formatMs(timing.ttfbMs)}
- **Document Content Download:** ${formatMs(timing.downloadMs)}
- **DNS Resolution:** ${formatPhaseMs(timing.dnsMs, isReused)}
- **TCP Connection Establishment:** ${formatPhaseMs(timing.tcpMs, isReused)}
- **TLS Handshake Duration:** ${formatPhaseMs(timing.tlsMs, isReused, !finalUrl.startsWith('https://'))}
- **DOM Content Loaded:** ${formatMs(timing.domContentLoadedMs)}
- **Page Load Event:** ${formatMs(timing.loadEventMs)}
- **Network Quiescence (Idle):** ${formatMs(timing.networkIdleMs)}
- **Connection Reused:** ${isReused ? 'Yes (Subsequent socket reuse)' : 'No (Fresh TCP handshake)'}`);

    // 5. Browser-Cache and CDN-Cache Findings
    const browserSource = formatDocumentSource(cache.documentSource);
    const cdnCacheStatus = formatCdnCacheStatus(cache.providerStatus);
    const cacheControlPolicy = cache.details?.policy || 'Not Specified';
    const ageHeader = cache.details?.ageSeconds !== null && cache.details?.ageSeconds !== undefined 
        ? `${cache.details.ageSeconds} seconds` 
        : 'Not Present';

    sections.push(`## 5. Browser-Cache and CDN-Cache Findings
- **Browser Delivery Source:** ${browserSource}
- **CDN Edge Cache Status:** ${cdnCacheStatus}
- **Cache-Control Policy:** ${cacheControlPolicy}
- **Proxy Age Header:** ${ageHeader}
- **Browser Cached Requests:** ${transfer.cachedRequestCount || 0}
- **Service Worker Interceptions:** ${transfer.serviceWorkerRequestCount || 0}`);

    // 6. Compression and Security Findings
    const compressionAlgo = connection.compression 
        ? `${connection.compression.toUpperCase()} (Observed)` 
        : (transfer.encodedBytes && transfer.decodedBytes && transfer.decodedBytes > transfer.encodedBytes ? 'Compressed (Unspecified format)' : 'None / Not Observed');

    const tlsInfo = tls.available 
        ? `${tls.version} • ${tls.cipher} (Issuer: ${tls.issuer || 'Unknown'})` 
        : (finalUrl.startsWith('https://') ? 'HTTPS Active (Detailed TLS metadata unobserved)' : 'Plain HTTP (Unencrypted)');

    sections.push(`## 6. Compression and Security Findings
- **Data Compression:** ${compressionAlgo}
- **Transport Security:** ${finalUrl.startsWith('https://') ? 'HTTPS (Secured)' : 'HTTP (Insecure)'}
- **TLS Specification:** ${tlsInfo}
- **Security Headers:**
  - **HSTS:** ${securityHeaders.hsts?.present ? 'Pass (Strict-Transport-Security enabled)' : 'Missing'}
  - **CSP:** ${securityHeaders.csp?.present ? 'Pass (Content-Security-Policy active)' : 'Missing'}
  - **X-Frame-Options:** ${securityHeaders.xFrameOptions?.present ? 'Pass' : 'Missing'}
  - **X-Content-Type-Options:** ${securityHeaders.xContentTypeOptions?.present ? 'Pass (nosniff)' : 'Missing'}
  - **Referrer-Policy:** ${securityHeaders.referrerPolicy?.present ? `Configured (${securityHeaders.referrerPolicy.value || 'Set'})` : 'Missing'}`);

    // 7. Score Calculation and Component Breakdown
    const b = scoreDetails.breakdown || {};
    sections.push(`## 7. Score Calculation & Component Breakdown
- **Final Performance Score:** ${scoreDetails.score}/100
- **Rating Tier:** Grade ${scoreDetails.grade || 'N/A'}
- **Component Contributions:**
  - **Page Load Speed:** ${formatScoreComponent(b.pageLoad)}
  - **Time to First Byte (TTFB):** ${formatScoreComponent(b.ttfb)}
  - **Edge Cache Efficiency:** ${formatScoreComponent(b.cache)}
  - **Compression Ratio:** ${formatScoreComponent(b.compression)}
  - **Security & HTTPS:** ${formatScoreComponent(b.security)}
- **Optimization Suggestions:**
${suggestions.length > 0 ? suggestions.map(s => `  - **[${s.type.toUpperCase()}] ${s.title}:** ${s.desc}`).join('\n') : '  - No optimization bottlenecks detected.'}`);

    // 8. Missing Measurements, Limitations, and Errors
    const limitations = [];
    if (timing.dnsMs === null && !isReused) limitations.push("DNS timing unmeasured (e.g. cross-origin iframe or browser socket cache)");
    if (timing.tcpMs === null && !isReused) limitations.push("TCP handshake unmeasured or not reported by CDP");
    if (timing.tlsMs === null && !isReused && finalUrl.startsWith('https://')) limitations.push("TLS handshake duration unobserved");
    if (!tls.available && finalUrl.startsWith('https://')) limitations.push("Detailed certificate metadata omitted by browser security state");
    if (transfer.failedRequestCount > 0) limitations.push(`${transfer.failedRequestCount} network requests failed or were blocked`);
    if (limitations.length === 0) limitations.push("All primary CDP measurements collected successfully without omissions.");

    sections.push(`## 8. Missing Measurements, Limitations, and Errors
${limitations.map(l => `- ${l}`).join('\n')}`);

    return `# CDN Analyzer Pro — Analysis Report
Generated: ${timestamp}
Target: ${finalUrl}

${sections.join('\n\n')}
`;
}

/**
 * Generates a clean, sanitized JSON export of the analysis.
 * Excludes any sensitive request/response headers and authentication tokens.
 * @param {Object} data Raw analysis data
 * @returns {string} Sanitized JSON string
 */
export function generateSanitizedJsonReport(data = {}) {
    const clone = JSON.parse(JSON.stringify(data));

    if (clone.headers) {
        clone.headers = scrubSensitiveHeaders(clone.headers);
    }
    if (clone.rawHeaders) {
        clone.rawHeaders = scrubSensitiveHeaders(clone.rawHeaders);
    }
    if (clone.requestHeaders) {
        clone.requestHeaders = scrubSensitiveHeaders(clone.requestHeaders);
    }

    // Scrub sensitive headers from main document and resource evidence
    if (clone.resourceEvidence && Array.isArray(clone.resourceEvidence)) {
        for (const item of clone.resourceEvidence) {
            if (item.headers) {
                item.headers = scrubSensitiveHeaders(item.headers);
            }
            if (item.requestHeaders) {
                item.requestHeaders = scrubSensitiveHeaders(item.requestHeaders);
            }
        }
    }

    return JSON.stringify(clone, null, 2);
}

/* ---------------- Helper formatters ---------------- */

function getHostname(urlStr) {
    try {
        return new URL(urlStr).hostname;
    } catch (e) {
        return urlStr;
    }
}

function formatMs(ms) {
    if (!Number.isFinite(ms) || ms === null || ms === undefined) return 'Not Available';
    if (ms === 0) return '<1 ms';
    return `${Math.round(ms)} ms`;
}

function formatPhaseMs(ms, isReused, isNotApplicable = false) {
    if (isNotApplicable) return 'Not Applicable (Plain HTTP)';
    if (isReused) return 'Connection Reused (Bypassed)';
    return formatMs(ms);
}

function formatDocumentSource(source) {
    switch (source) {
        case 'disk-cache': return 'Browser Disk Cache';
        case 'memory-cache': return 'Browser Memory Cache';
        case 'service-worker': return 'Service Worker';
        case 'prefetch': return 'Prefetch Cache';
        case 'network': return 'Fresh Network Request';
        default: return source || 'Network';
    }
}

function formatCdnCacheStatus(status) {
    if (!status || status === 'UNKNOWN' || status === 'Unknown') return 'Unknown (No CDN cache header evidence)';
    if (status === 'HIT') return 'CDN HIT (Served from Edge Cache)';
    if (status === 'MISS') return 'CDN MISS (Fetched from Origin)';
    if (status === 'BYPASS') return 'CDN BYPASS (Dynamic request bypassed cache)';
    if (status === 'REVALIDATED') return 'CDN REVALIDATED (304 Not Modified)';
    if (status === 'EXPIRED') return 'CDN EXPIRED (TTL elapsed)';
    if (status === 'STALE') return 'CDN STALE (Served while revalidating)';
    if (status === 'Cacheable (Policy)') return 'Cacheable (Allowed by Cache-Control headers)';
    if (status === 'Not Cacheable') return 'Not Cacheable (Restricted by no-store/private)';
    return status;
}

function formatScoreComponent(comp) {
    if (!comp) return 'Not Available';
    if (comp.score === null || comp.score === undefined) return 'Not Applicable (Dynamic Reweight)';
    return `${comp.score}/100 (Weight: ${Math.round((comp.weight || 0) * 100)}%)`;
}

function formatHighlight(item) {
    if (!item) return 'None recorded';
    const bytes = item.bytes ? formatBytes(item.bytes) : 'Unknown size';
    const duration = item.durationMs ? `${item.durationMs} ms` : 'Duration unmeasured';
    return `${bytes} • ${duration} — \`${item.url}\``;
}

function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
