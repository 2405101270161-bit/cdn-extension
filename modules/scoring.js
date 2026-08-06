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
    const { isHttps, timing, cacheStatus, headers, failedRequestCount = 0, protocol = 'h2' } = ctx;

    const loadTime = timing.loadEventMs ?? timing.documentMs;
    const ttfb = timing.ttfbMs;
    const compression = headers['content-encoding'] || "None";
    const hasHSTS = !!headers['strict-transport-security'];
    const hasCSP = !!headers['content-security-policy'];

    // 1. Page Load Score (35%)
    // BUG-21 FIX: null loadTime means "not measured" → neutral 50, not penalty 0.
    let pageLoadScore = loadTime === null ? 50 : 100;
    if (loadTime !== null && loadTime > 3500) pageLoadScore = 40;
    else if (loadTime !== null && loadTime > 2000) pageLoadScore = 65;
    else if (loadTime !== null && loadTime > 1000) pageLoadScore = 85;
    else if (loadTime !== null && loadTime > 500) pageLoadScore = 95;

    // 2. TTFB Score (25%)
    // BUG-21 FIX: null ttfb means "not measured" → neutral 50, not penalty 0.
    let ttfbScore = ttfb === null ? 50 : 100;
    if (ttfb !== null && ttfb > 800) ttfbScore = 30;
    else if (ttfb !== null && ttfb > 400) ttfbScore = 60;
    else if (ttfb !== null && ttfb > 200) ttfbScore = 85;

    // 3. Cache Score (20%)
    let cacheScore = 70;
    if (cacheStatus.includes('HIT')) cacheScore = 100;
    else if (cacheStatus.includes('REVALIDATED')) cacheScore = 85;
    else if (cacheStatus.includes('MISS')) cacheScore = 50;
    else if (cacheStatus.includes('BYPASS') || cacheStatus.includes('DYNAMIC')) cacheScore = 60;

    // 4. Compression Score (10%)
    let compressionScore = compression !== "None" ? 100 : 50;

    // 5. Security Checks Score (10%)
    let basicSecurityScore = (isHttps ? 40 : 0) + (hasHSTS ? 30 : 0) + (hasCSP ? 30 : 0);

    // Apply penalty for failed network requests
    let penalty = 0;
    if (failedRequestCount > 0) penalty += Math.min(20, failedRequestCount * 5);

    const overallScore = Math.max(1, Math.min(100, Math.round(
        ((pageLoadScore * 0.35) +
        (ttfbScore * 0.25) +
        (cacheScore * 0.20) +
        (compressionScore * 0.10) +
        (basicSecurityScore * 0.10)) - penalty
    )));

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
        scoreVersion: "2.0",
        completeness: 1.0,
        components: {
            pageLoad: pageLoadScore,
            ttfb: ttfbScore,
            cache: cacheScore,
            compression: compressionScore,
            basicSecurity: basicSecurityScore
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
