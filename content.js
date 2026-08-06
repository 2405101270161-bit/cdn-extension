/**
 * CDN Analyzer Pro v2.0 - Content Script Helper
 * Extracts client-side Navigation Timing API entries as an auxiliary fallback
 * when DevTools Protocol metrics are complemented by window context.
 *
 * DEPRECATED FOR PRIMARY NETWORK TIMING. This script reads
 * window.performance from whatever tab happens to be active, not the
 * background tab that background.js drives via CDP, so its numbers can
 * reflect a different (possibly cached) page load than the one being
 * measured. background.js never sends GET_PAGE_PERFORMANCE_METRICS to this
 * script and never merges its output — all network metrics come
 * exclusively from the CDP pipeline in background.js. This file is kept
 * only in case a future non-authoritative diagnostic use is added; it must
 * not be wired back into the measurement/scoring pipeline.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PAGE_PERFORMANCE_METRICS') {
        const metrics = getPagePerformanceMetrics();
        sendResponse(metrics);
        return true;
    }
});

function getPagePerformanceMetrics() {
    try {
        const navEntries = performance.getEntriesByType("navigation");
        const nav = navEntries && navEntries.length > 0 ? navEntries[0] : null;

        if (!nav) {
            return {
                success: false,
                error: "Navigation timing API is unavailable on active page."
            };
        }

        const isConnectionReused = (nav.connectStart === nav.connectEnd) || 
                                   (nav.domainLookupStart === nav.domainLookupEnd && nav.domainLookupStart > 0);

        const dnsTime = isConnectionReused ? 0 : Math.max(0, Math.round(nav.domainLookupEnd - nav.domainLookupStart));
        const tcpTime = isConnectionReused ? 0 : Math.max(0, Math.round(nav.connectEnd - nav.connectStart));
        let tlsTime = 0;
        if (!isConnectionReused && nav.secureConnectionStart && nav.secureConnectionStart > 0 && nav.connectEnd > nav.secureConnectionStart) {
            tlsTime = Math.max(0, Math.round(nav.connectEnd - nav.secureConnectionStart));
        }

        let ttfb = 0;
        if (nav.responseStart && nav.requestStart && nav.responseStart >= nav.requestStart) {
            ttfb = Math.max(0, Math.round(nav.responseStart - nav.requestStart));
        }

        let downloadTime = 0;
        if (nav.responseEnd && nav.responseStart && nav.responseEnd >= nav.responseStart) {
            downloadTime = Math.max(0, Math.round(nav.responseEnd - nav.responseStart));
        }

        const domContentLoaded = Math.max(0, Math.round(nav.domContentLoadedEventEnd - nav.startTime));
        const loadEvent = Math.max(0, Math.round(nav.loadEventEnd - nav.startTime));

        return {
            success: true,
            data: {
                pageUrl: window.location.href,
                dnsTime,
                tcpTime,
                tlsTime,
                ttfb,
                downloadTime,
                domContentLoaded,
                loadEvent,
                isConnectionReused,
                transferSize: nav.transferSize || 0,
                encodedBodySize: nav.encodedBodySize || 0,
                decodedBodySize: nav.decodedBodySize || 0,
                nextHopProtocol: nav.nextHopProtocol || ""
            }
        };

    } catch (err) {
        return {
            success: false,
            error: err.message || "Failed to read performance entries from page."
        };
    }
}
