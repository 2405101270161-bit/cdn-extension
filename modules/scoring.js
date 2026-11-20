export function calculatePerformanceScore(ctx) {
    const {
        isHttps,
        timing = {},
        cacheStatus = 'Unknown',
        headers = {},
        failedRequestCount = 0,
        protocol = 'Unknown'
    } = (ctx || {});

    const loadTime = (timing && Number.isFinite(timing.loadEventMs) && timing.loadEventMs >= 0)
        ? timing.loadEventMs
        : ((timing && Number.isFinite(timing.documentMs) && timing.documentMs >= 0) ? timing.documentMs : null);

    const ttfb = (timing && Number.isFinite(timing.ttfbMs) && timing.ttfbMs >= 0)
        ? timing.ttfbMs
        : null;

    let pageLoadScore = null;
    if (loadTime !== null) {
        if (loadTime > 3500) pageLoadScore = 40;
        else if (loadTime > 2000) pageLoadScore = 65;
        else if (loadTime > 1000) pageLoadScore = 85;
        else if (loadTime > 500) pageLoadScore = 95;
        else pageLoadScore = 100;
    }

    let ttfbScore = null;
    if (ttfb !== null) {
        if (ttfb > 800) ttfbScore = 30;
        else if (ttfb > 400) ttfbScore = 60;
        else if (ttfb > 200) ttfbScore = 85;
        else ttfbScore = 100;
    }

    const CACHE_SCORES = {
        'HIT': 100,
        'REVALIDATED': 85,
        'Cacheable': 75,
        'Service Worker': 75,
        'Memory Cache': 75,
        'Disk Cache': 75,
        'STALE': 70,
        'BYPASS': 60,
        'EXPIRED': 60,
        'Private Cacheable': 60,
        'Revalidate Required': 60,
        'DYNAMIC': 55,
        'MISS': 50,
        'Not Cacheable': 50,
        'No Cache Headers': 40
    };
    let cacheScore = null;
    const normCache = (typeof cacheStatus === 'string' && cacheStatus) ? cacheStatus : 'Unknown';
    if (normCache !== 'Unknown' && normCache !== 'UNKNOWN') {
        cacheScore = CACHE_SCORES[normCache] ?? 50;
    }

    let compressionScore = null;
    let compressionVal = ctx ? ctx.compression : undefined;
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

    const hasHttps = Boolean(isHttps);
    const hasHSTS = Boolean(headers && (headers['strict-transport-security'] || headers['Strict-Transport-Security']));
    const hasCSP = Boolean(headers && (headers['content-security-policy'] || headers['Content-Security-Policy']));
    const basicSecurityScore = (hasHttps ? 40 : 0) + (hasHSTS ? 30 : 0) + (hasCSP ? 30 : 0);

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

    if (isHttps !== undefined && isHttps !== null) {
        weightedSum += basicSecurityScore * 0.10;
        totalWeight += 0.10;
    }

    let penalty = 0;
    if (failedRequestCount > 0 && Number.isFinite(failedRequestCount)) {
        penalty = Math.min(20, Math.max(0, failedRequestCount * 5));
    }

    let rawScore = 75; 
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

    const applicableComponents = {
        pageLoad: pageLoadScore !== null,
        ttfb: ttfbScore !== null,
        cache: cacheScore !== null,
        compression: compressionScore !== null,
        basicSecurity: isHttps !== undefined && isHttps !== null
    };
    const missingComponents = Object.entries(applicableComponents)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);
    const completeness = Math.round(totalWeight * 100) / 100;

    return {
        score: overallScore,
        grade,
        scoreVersion: "2.2",
        completeness,
        insufficientData: completeness < 0.5,
        missingComponents,
        failedRequestPenalty: penalty,
        securityScore: basicSecurityScore,
        // Missing measurements are null (not a neutral 50) so reports never show invented values.
        components: {
            pageLoad: pageLoadScore,
            ttfb: ttfbScore,
            cache: cacheScore,
            compression: compressionScore,
            basicSecurity: applicableComponents.basicSecurity ? basicSecurityScore : null
        },
        weights: { pageLoad: 0.35, ttfb: 0.25, cache: 0.20, compression: 0.10, basicSecurity: 0.10 },
        applicableComponents
    };
}

export function generateSuggestions(ctx) {
    const {
        cdnResult,
        timing = {},
        cacheStatus,
        headers = {},
        resourceHighlights,
        isHttps = null,
        mainDocumentCaptured = true,
        contentType = null
    } = ctx || {};
    const suggestions = [];

    const normHeaders = {};
    for (const [k, v] of Object.entries(headers || {})) {
        normHeaders[k.toLowerCase()] = String(v);
    }

    if (!mainDocumentCaptured) {
        suggestions.push({
            title: "Main Document Response Not Captured",
            type: "medium",
            desc: "The page's main HTML response was not observed, so CDN, cache, compression and header checks for the document could not be evaluated. Re-run the analysis; if it persists, the site may block automated loads or redirect to a non-HTTP scheme."
        });
        return suggestions;
    }

    const provider = cdnResult?.provider || "Not Detected";
    const status = cdnResult?.status || (provider === "Not Detected" ? 'unidentified' : 'identified');
    if (status === 'unidentified') {
        suggestions.push({
            title: "No CDN Signature Identified",
            type: "low",
            desc: "No provider-specific CDN headers, CNAME alias or published edge IP range were observed for the main document. This does not prove the page is served directly from origin — some CDNs hide identifying headers. If you operate this site and it is not behind a CDN, an edge network can reduce latency for distant visitors."
        });
    } else if (status === 'network-only') {
        suggestions.push({
            title: "CDN Product Not Confirmed",
            type: "low",
            desc: `The response came from ${provider} network infrastructure, but no product-specific header confirmed which CDN service (if any) is in use.`
        });
    }

    if (cacheStatus && (cacheStatus.includes('MISS') || cacheStatus === 'No Cache Headers')) {
        suggestions.push({
            title: "Improve Edge Cache Hit Ratio",
            type: "medium",
            desc: "The main document returned a cache MISS or has no caching headers. If this content is shareable, allow shared caching with Cache-Control (for example s-maxage) so edge caches can serve it."
        });
    }

    const ct = String(contentType || normHeaders['content-type'] || '').toLowerCase();
    const isText = !ct || /text\/|json|javascript|xml|svg/.test(ct);
    const encoding = (normHeaders['content-encoding'] || '').toLowerCase();
    const hasCompression = /gzip|br|deflate|zstd/.test(encoding);
    if (isText && !hasCompression) {
        suggestions.push({
            title: "Enable HTTP Text Compression (Brotli / Gzip)",
            type: "high",
            desc: "The main document was delivered without Brotli, Gzip or Zstandard encoding. Compressing HTML, JS and CSS typically reduces their transfer size substantially."
        });
    }

    if (Number.isFinite(timing.ttfbMs) && timing.ttfbMs > 400) {
        suggestions.push({
            title: "Reduce Server Response Time (TTFB)",
            type: "high",
            desc: `Waiting for the server response took ${Math.round(timing.ttfbMs)} ms. Review server-side processing, application caching, or edge caching for this document.`
        });
    }

    if (isHttps !== false && !normHeaders['strict-transport-security']) {
        suggestions.push({
            title: "Enable HTTP Strict Transport Security (HSTS)",
            type: "low",
            desc: "Missing Strict-Transport-Security header. HSTS makes browsers use HTTPS automatically and prevents protocol downgrade."
        });
    }

    if (!normHeaders['content-security-policy']) {
        suggestions.push({
            title: "Implement Content Security Policy (CSP)",
            type: "medium",
            desc: "Missing Content-Security-Policy header. CSP restricts which scripts may run and mitigates cross-site scripting (XSS)."
        });
    }

    if (resourceHighlights && resourceHighlights.slowestResource && resourceHighlights.slowestResource.durationMs > 1000) {
        const url = String(resourceHighlights.slowestResource.url || '');
        suggestions.push({
            title: "Optimize Slowest Network Resource",
            type: "medium",
            desc: `The request for ${url.length > 60 ? url.slice(0, 60) + '…' : url} took ${resourceHighlights.slowestResource.durationMs} ms to load.`
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            title: "No Issues Found in Checked Areas",
            type: "good",
            desc: "CDN evidence, cache, compression, security header and latency checks found nothing to improve for the main document."
        });
    }

    return suggestions;
}
