/**
 * CDN Analyzer Pro v2 - Metrics Module
 * Calculates network phase timings (DNS, TCP, TLS, TTFB, Download, DOM, Load, Idle)
 *
 * FIXES APPLIED:
 *  BUG-09: TTFB fallback changed from fabricated 50ms to null. The UI's
 *          formatDuration(null) displays "Not Available" instead of a fake value.
 *  BUG-10: downloadMs fallback changed from fabricated 10ms to null for the
 *          same reason.
 */

export function calculateMetrics(data) {
    const {
        mainRequestId,
        requests,
        mainDocumentResponse,
        navigationStartCDP,
        domContentTime,
        loadEventTime,
        lastActivityTime
    } = data;

    const mainReq = requests.get(mainRequestId);
    const navStart = navigationStartCDP || (mainReq ? mainReq.requestWillBeSentTime : 0);

    let dnsMs = 0;
    let tcpMs = 0;
    let tlsMs = 0;
    let requestSentMs = 0;
    let ttfbMs = null;
    let responseHeadersEndTime = null;
    let downloadMs = null;
    let documentMs = null;
    let reused = false;
    const isHttpDoc = (mainReq && mainReq.url && mainReq.url.startsWith('http://')) || (mainDocumentResponse && mainDocumentResponse.url && mainDocumentResponse.url.startsWith('http://'));
    let protocol = isHttpDoc ? "http/1.1" : "h2";
    let remoteIp = null;
    let compression = "None";

    const roundDuration = (value) => {
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.round(value * 100) / 100;
    };

    if (mainDocumentResponse) {
        if (mainDocumentResponse.protocol) {
            protocol = mainDocumentResponse.protocol;
        }
        remoteIp = mainDocumentResponse.remoteIPAddress || null;
        reused = !!mainDocumentResponse.connectionReused;

        if (mainDocumentResponse.headers) {
            compression = mainDocumentResponse.headers['content-encoding'] ||
                mainDocumentResponse.headers['Content-Encoding'] || "None";
        }

        const timing = mainDocumentResponse.timing;
        if (timing) {
            if (reused) {
                dnsMs = 0;
                tcpMs = 0;
                tlsMs = 0;
            } else {
                if (timing.dnsStart >= 0 && timing.dnsEnd >= 0 && timing.dnsEnd >= timing.dnsStart) {
                    dnsMs = roundDuration(timing.dnsEnd - timing.dnsStart) ?? 0;
                }
                if (timing.connectStart >= 0 && timing.connectEnd >= 0) {
                    const transportEnd = (timing.sslStart >= timing.connectStart) ? timing.sslStart : timing.connectEnd;
                    tcpMs = transportEnd >= timing.connectStart ? (roundDuration(transportEnd - timing.connectStart) ?? 0) : 0;
                }
                if (timing.sslStart >= 0 && timing.sslEnd >= 0 && timing.sslEnd >= timing.sslStart) {
                    tlsMs = roundDuration(timing.sslEnd - timing.sslStart) ?? 0;
                }
            }

            requestSentMs = (timing.sendEnd >= 0 && timing.sendStart >= 0)
                ? (roundDuration(timing.sendEnd - timing.sendStart) ?? 0) : 0;

            if (timing.receiveHeadersStart >= 0) {
                ttfbMs = roundDuration(timing.receiveHeadersStart);
            }
            if (timing.receiveHeadersEnd >= 0 && timing.requestTime >= 0) {
                responseHeadersEndTime = (timing.requestTime * 1000) + timing.receiveHeadersEnd;
            }
        }
    }

    if (mainReq) {
        const respRecv = mainReq.responseReceivedTime;
        const loadFin = mainReq.loadingFinishedTime;
        const reqSent = mainReq.requestWillBeSentTime;

        if ((ttfbMs === null || !Number.isFinite(ttfbMs) || ttfbMs <= 0) && respRecv && reqSent && respRecv >= reqSent) {
            ttfbMs = roundDuration(respRecv - reqSent);
        }

        const downloadStart = responseHeadersEndTime ?? respRecv;
        if (loadFin && respRecv && loadFin >= respRecv) {
            downloadMs = roundDuration(loadFin - respRecv);
        } else if (downloadStart && loadFin && loadFin >= downloadStart) {
            downloadMs = roundDuration(loadFin - downloadStart);
        } else if (mainDocumentResponse && mainDocumentResponse.timing && mainDocumentResponse.timing.receiveHeadersEnd >= 0 && mainDocumentResponse.timing.receiveHeadersStart >= 0) {
            downloadMs = roundDuration(Math.max(1, mainDocumentResponse.timing.receiveHeadersEnd - mainDocumentResponse.timing.receiveHeadersStart));
        } else {
            // Cannot determine download time from available timestamps — leave null.
            downloadMs = null;
        }

        if (loadFin && navStart && loadFin >= navStart) {
            documentMs = roundDuration(loadFin - navStart);
        } else {
            // Cannot determine documentMs from loadingFinished — approximate from
            // whatever timing we have; the null sentinel block below cleans up.
            documentMs = (ttfbMs != null && downloadMs != null)
                ? roundDuration(ttfbMs + downloadMs)
                : null;
        }
    } else {
        // BUG-09/BUG-10 FIX: When mainReq is absent we have no timing data.
        // Leave ttfbMs and downloadMs as null rather than inventing values.
        ttfbMs = ttfbMs ?? null;
        downloadMs = downloadMs ?? null;
        documentMs = documentMs ?? null;
    }

    // BUG-09/BUG-10 FIX: Keep null as the canonical sentinel for "not measured".
    // Downstream consumers (scoring.js, popup.js) already handle null gracefully:
    //   - formatDuration(null)  → "Not Available"
    //   - scoring: null TTFB   → neutral score (handled in scoring.js BUG-21 fix)
    ttfbMs = (ttfbMs !== null && Number.isFinite(ttfbMs) && ttfbMs > 0) ? ttfbMs : null;
    downloadMs = (downloadMs !== null && Number.isFinite(downloadMs) && downloadMs >= 0) ? downloadMs : null;
    // documentMs: only compute when at least ttfb is known; otherwise null.
    if (documentMs === null || !Number.isFinite(documentMs) || documentMs <= 0) {
        documentMs = (ttfbMs !== null && downloadMs !== null) ? (ttfbMs + downloadMs) : (ttfbMs ?? downloadMs ?? null);
    }

    const domContentLoadedMs = domContentTime && navStart ? roundDuration(domContentTime - navStart) : documentMs;
    const loadEventMs = loadEventTime && navStart ? roundDuration(loadEventTime - navStart) : domContentLoadedMs;
    const lastActivityMs = lastActivityTime && navStart ? roundDuration(lastActivityTime - navStart) : null;
    const networkIdleMs = lastActivityMs !== null && loadEventMs !== null
        ? Math.max(loadEventMs, lastActivityMs)
        : (lastActivityMs ?? loadEventMs);

    return {
        timing: {
            dnsMs,
            tcpMs,
            tlsMs,
            requestSentMs,
            ttfbMs,
            downloadMs,
            documentMs,
            domContentLoadedMs,
            loadEventMs,
            networkIdleMs
        },
        connection: {
            reused,
            protocol,
            remoteIp,
            compression
        }
    };
}
