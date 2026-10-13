/**
 * CDN Analyzer Pro v2 - Performance Scoring & Suggestions Module
 * Performance Score v2.0 Algorithm & Optimization Recommendations
 *
 * FIXES APPLIED:
 *  BUG-21: calculatePerformanceScore now handles null ttfb and null loadTime
 *          (produced by metrics.js after BUG-09/10 fixes). Previously a null
 *          value started the component at 0 (full penalty). Now null means
 *          "not measured" and yields a neutral score of 50 for that component
 *          so the overall score is not unfairly penalised for missing data.
 */

export function calculatePerformanceScore(ctx) {
    const {
        isHttps,
        timing = {},
        cacheStatus = 'Unknown',
        headers = {},
        failedRequestCount = 0,
        protocol = 'Unknown'
    } = (ctx || {});

    // Guard all timing inputs against undefined, NaN, and negative values
    const loadTime = (timing && Number.isFinite(timing.loadEventMs) && timing.loadEventMs >= 0)
        ? timing.loadEventMs
        : ((timing && Number.isFinite(timing.documentMs) && timing.documentMs >= 0) ? timing.documentMs : null);

    const ttfb = (timing && Number.isFinite(timing.ttfbMs) && timing.ttfbMs >= 0)
        ? timing.ttfbMs
        : null;

    // 1. Page Load Score (Weight: 35) - only scored when measurement is available
    let pageLoadScore = null;
    if (loadTime !== null) {
        if (loadTime > 3500) pageLoadScore = 40;
        else if (loadTime > 2000) pageLoadScore = 65;
        else if (loadTime > 1000) pageLoadScore = 85;
        else if (loadTime > 500) pageLoadScore = 95;
        else pageLoadScore = 100;
    }

    // 2. TTFB Score (Weight: 25) - only scored when measurement is available
    let ttfbScore = null;
    if (ttfb !== null) {
        if (ttfb > 800) ttfbScore = 30;
        else if (ttfb > 400) ttfbScore = 60;
        else if (ttfb > 200) ttfbScore = 85;
        else ttfbScore = 100;
    }

    // 3. Cache Score (Weight: 20) - only scored when cache evidence is available
    let cacheScore = null;
    const normCache = (typeof cacheStatus === 'string' && cacheStatus) ? cacheStatus : 'Unknown';
    if (normCache !== 'Unknown') {
        if (normCache.includes('HIT')) cacheScore = 100;
        else if (normCache.includes('REVALIDATED')) cacheScore = 85;
        else if (normCache.includes('Cacheable')) cacheScore = 75;
        else if (normCache.includes('BYPASS') || normCache.includes('DYNAMIC')) cacheScore = 60;
        else if (normCache.includes('MISS')) cacheScore = 50;
        else if (normCache.includes('Not Cacheable')) cacheScore = 50;
        else if (normCache === 'No Cache Headers') cacheScore = 40;
        else cacheScore = 50;
    }

    // 4. Compression Score (Weight: 10)
    // Only scored if compression was observed (either explicitly passed in ctx.compression,
    // or via content-encoding in headers). If unobserved / missing, do NOT penalize.
    let compressionScore = null;
    let compressionVal = ctx.compression;
    if (!compressionVal && headers && typeof headers === 'object') {
        if ('content-encoding' in headers || 'Content-Encoding' in headers) {
            compressionVal = headers['content-encoding'] || headers['Content-Encoding'];
        }
    }

    if (compressionVal && compressionVal !== 'Unknown') {
        if (String(compressionVal).toLowerCase() !== 'none') {
            compressionScore = 100;
        } else {
            compressionScore = 50;
        }
    }

    // 5. Basic Security Score (Weight: 10) - kept conceptually separate in results
    const hasHttps = Boolean(isHttps);
    const hasHSTS = Boolean(headers && (headers['strict-transport-security'] || headers['Strict-Transport-Security']));
    const hasCSP = Boolean(headers && (headers['content-security-policy'] || headers['Content-Security-Policy']));
    const basicSecurityScore = (hasHttps ? 40 : 0) + (hasHSTS ? 30 : 0) + (hasCSP ? 30 : 0);

    // Dynamic reweighting across applicable components so missing data is never penalized
    let totalWeight = 0;
    let weightedSum = 0;

    if (pageLoadScore !== null) {
        weightedSum += pageLoadScore * 0.35;
        totalWeight += 0.35;
    }
    if (ttfbScore !== null) {
        weightedSum += ttfbScore * 0.25;
        totalWeight += 0.25;
    }
    if (cacheScore !== null) {
        weightedSum += cacheScore * 0.20;
        totalWeight += 0.20;
    }
    if (compressionScore !== null) {
        weightedSum += compressionScore * 0.10;
        totalWeight += 0.10;
    }
    // Security check is applicable whenever security metadata is provided
    if (isHttps !== undefined && isHttps !== null) {
        weightedSum += basicSecurityScore * 0.10;
        totalWeight += 0.10;
    }

    let penalty = 0;
    if (failedRequestCount > 0 && Number.isFinite(failedRequestCount)) {
        penalty = Math.min(20, Math.max(0, failedRequestCount * 5));
    }

    let rawScore = 75; // Neutral baseline if no applicable components
    if (totalWeight > 0) {
        rawScore = (weightedSum / totalWeight) - penalty;
    }

    const overallScore = Math.max(1, Math.min(100, Math.round(Number.isFinite(rawScore) ? rawScore : 75)));

    let grade = 'A+';
    if (overallScore >= 95) grade = 'A+';
    else if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B';
    else if (overallScore >= 70) grade = 'C';
    else if (overallScore >= 60) grade = 'D';
    else grade = 'F';

    return {
        score: overallScore,
        grade,
        scoreVersion: "2.1",
        completeness: Math.round(totalWeight * 100) / 100,
        securityScore: basicSecurityScore,
        components: {
            pageLoad: pageLoadScore ?? 50,
            ttfb: ttfbScore ?? 50,
            cache: cacheScore ?? 50,
            compression: compressionScore ?? 50,
            basicSecurity: basicSecurityScore
        },
        applicableComponents: {
            pageLoad: pageLoadScore !== null,
            ttfb: ttfbScore !== null,
            cache: cacheScore !== null,
            compression: compressionScore !== null,
            basicSecurity: isHttps !== undefined && isHttps !== null
        }
    };
}

export function generateSuggestions(ctx) {
    const { targetUrl, cdnResult, timing, cacheStatus, headers = {}, tls, resourceHighlights } = ctx;
    const suggestions = [];

    const normHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
        normHeaders[k.toLowerCase()] = String(v);
    }

    // 1. CDN Optimization
    const provider = cdnResult?.provider || "Not Detected";
    if (provider === "Not Detected" || provider === "Unknown / not detected" || provider === "Unknown") {
        suggestions.push({
            title: "Route Traffic Through Edge CDN Network",
            type: "high",
            desc: "No major Content Delivery Network edge headers were detected. Serving assets directly from an origin server increases TTFB and latency for global visitors."
        });
    }

    // 2. Cache Optimization
    if (cacheStatus && (cacheStatus.includes('MISS') || cacheStatus === 'No Cache Headers')) {
        suggestions.push({
            title: "Improve Edge Cache Hit Ratio",
            type: "medium",
            desc: "The primary document response returned a Cache MISS status or lacks caching headers. Ensure Cache-Control edge directives allow proxy caching for static content."
        });
    }

    // 3. Compression Optimization
    const encoding = (normHeaders['content-encoding'] || '').toLowerCase();
    const hasCompression = encoding.includes('gzip') || encoding.includes('br') || encoding.includes('deflate') || encoding.includes('zstd');
    if (!hasCompression) {
        suggestions.push({
            title: "Enable Modern HTTP Text Compression (Brotli / Gzip)",
            type: "high",
            desc: "The server delivered text content without Brotli or Gzip encoding. Enabling compression can reduce HTML, JS, and CSS payload sizes by 60%–80%."
        });
    }

    // 4. TTFB Optimization
    if (timing.ttfbMs && timing.ttfbMs > 400) {
        suggestions.push({
            title: "Optimize Origin Server Response Time (TTFB)",
            type: "high",
            desc: `Time to First Byte was measured at ${timing.ttfbMs}ms. Consider optimizing database queries, server-side caching, or upgrading origin server specs.`
        });
    }

    // 5. Security Header Recommendations
    if (!normHeaders['strict-transport-security']) {
        suggestions.push({
            title: "Enable HTTP Strict Transport Security (HSTS)",
            type: "low",
            desc: "Missing Strict-Transport-Security header. HSTS forces browsers to establish HTTPS connections automatically, preventing downgrade attacks."
        });
    }

    if (!normHeaders['content-security-policy']) {
        suggestions.push({
            title: "Implement Content Security Policy (CSP)",
            type: "medium",
            desc: "Missing Content-Security-Policy header. CSP restricts unauthorized scripts and mitigates cross-site scripting (XSS) vulnerabilities."
        });
    }

    // 6. Resource Optimization
    if (resourceHighlights && resourceHighlights.slowestResource && resourceHighlights.slowestResource.durationMs > 1000) {
        suggestions.push({
            title: "Optimize Slowest Network Resource",
            type: "medium",
            desc: `The request for ${resourceHighlights.slowestResource.url.slice(0, 60)}... took ${resourceHighlights.slowestResource.durationMs}ms to load.`
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            title: "Excellent Network & Delivery Setup",
            type: "good",
            desc: "All major CDN, cache, compression, security header, and latency checks passed optimal performance thresholds."
        });
    }

    return suggestions;
}
