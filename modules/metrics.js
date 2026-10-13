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
    const navStart = (navigationStartCDP && navigationStartCDP > 0)
        ? navigationStartCDP
        : (mainReq && mainReq.requestWillBeSentTime > 0 ? mainReq.requestWillBeSentTime : null);

    // Timing measurements: null represents unavailable / not applicable / not performed.
    // 0 represents a genuinely measured 0ms duration.
    let dnsMs = null;
    let tcpMs = null;
    let tlsMs = null;
    let requestSentMs = null;
    let ttfbMs = null;
    let responseHeadersEndTime = null;
    let downloadMs = null;
    let documentMs = null;

    let reused = false;
    let protocol = "Unknown";
    let remoteIp = null;
    let compression = "Unknown";

    const roundDuration = (value) => {
        if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
        return Math.round(value * 100) / 100;
    };

    if (mainDocumentResponse) {
        // Negotiated HTTP protocol: report only when observed; otherwise Unknown
        if (mainDocumentResponse.protocol && typeof mainDocumentResponse.protocol === 'string' && mainDocumentResponse.protocol.trim()) {
            protocol = mainDocumentResponse.protocol.trim();
        }
        remoteIp = mainDocumentResponse.remoteIPAddress || null;

        // Connection reuse: CDP exposes connectionReused boolean or timing with start offsets of -1
        const timing = mainDocumentResponse.timing;
        reused = Boolean(
            mainDocumentResponse.connectionReused ||
            (timing && timing.dnsStart === -1 && timing.connectStart === -1)
        );

        // Compression: "None" when headers observed without content-encoding; "Unknown" when headers unobserved
        if (mainDocumentResponse.headers && typeof mainDocumentResponse.headers === 'object') {
            const enc = mainDocumentResponse.headers['content-encoding'] ||
                        mainDocumentResponse.headers['Content-Encoding'] ||
                        null;
            compression = enc ? String(enc).trim() : "None";
        }

        if (timing) {
            // Reused connections did not perform DNS, TCP, or TLS phases for this request
            if (reused) {
                dnsMs = null;
                tcpMs = null;
                tlsMs = null;
            } else {
                // DNS Resolution
                if (timing.dnsStart >= 0 && timing.dnsEnd >= 0 && timing.dnsEnd >= timing.dnsStart) {
                    dnsMs = roundDuration(timing.dnsEnd - timing.dnsStart);
                } else {
                    dnsMs = null;
                }

                // TCP Connection (or QUIC transport establishment)
                if (timing.connectStart >= 0 && timing.connectEnd >= 0 && timing.connectEnd >= timing.connectStart) {
                    const transportEnd = (timing.sslStart >= timing.connectStart && timing.sslStart <= timing.connectEnd)
                        ? timing.sslStart
                        : timing.connectEnd;
                    tcpMs = transportEnd >= timing.connectStart
                        ? roundDuration(transportEnd - timing.connectStart)
                        : null;
                } else {
                    tcpMs = null;
                }

                // TLS Handshake
                if (timing.sslStart >= 0 && timing.sslEnd >= 0 && timing.sslEnd >= timing.sslStart) {
                    tlsMs = roundDuration(timing.sslEnd - timing.sslStart);
                } else {
                    tlsMs = null;
                }
            }

            // Request Dispatch (send phase)
            if (timing.sendStart >= 0 && timing.sendEnd >= 0 && timing.sendEnd >= timing.sendStart) {
                requestSentMs = roundDuration(timing.sendEnd - timing.sendStart);
            } else {
                requestSentMs = null;
            }

            // TTFB (Time to First Byte): represents total elapsed duration from request dispatch
            // until the first byte of response headers is received (includes network latency,
            // server processing, and initial response transit; not pure server execution time).
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

        // Fallback for TTFB from lifecycle timestamps if CDP timing was unavailable
        if ((ttfbMs === null || !Number.isFinite(ttfbMs) || ttfbMs < 0) &&
            respRecv !== null && reqSent !== null &&
            Number.isFinite(respRecv) && Number.isFinite(reqSent) &&
            respRecv >= reqSent) {
            ttfbMs = roundDuration(respRecv - reqSent);
        }

        // Content download duration: interval from response header receipt to loading finished
        const downloadStart = responseHeadersEndTime ?? respRecv;
        if (loadFin !== null && downloadStart !== null &&
            Number.isFinite(loadFin) && Number.isFinite(downloadStart) &&
            loadFin >= downloadStart) {
            downloadMs = roundDuration(loadFin - downloadStart);
        } else if (loadFin !== null && respRecv !== null &&
                   Number.isFinite(loadFin) && Number.isFinite(respRecv) &&
                   loadFin >= respRecv) {
            downloadMs = roundDuration(loadFin - respRecv);
        } else {
            downloadMs = null;
        }

        // Main document total request duration
        if (loadFin !== null && navStart !== null &&
            Number.isFinite(loadFin) && Number.isFinite(navStart) &&
            loadFin >= navStart) {
            documentMs = roundDuration(loadFin - navStart);
        } else if (loadFin !== null && reqSent !== null &&
                   Number.isFinite(loadFin) && Number.isFinite(reqSent) &&
                   loadFin >= reqSent) {
            documentMs = roundDuration(loadFin - reqSent);
        } else if (ttfbMs !== null && downloadMs !== null) {
            documentMs = roundDuration(ttfbMs + downloadMs);
        } else {
            documentMs = ttfbMs ?? downloadMs ?? null;
        }
    }

    // Keep null as the canonical sentinel for unmeasured / unavailable metrics
    ttfbMs = (ttfbMs !== null && Number.isFinite(ttfbMs) && ttfbMs >= 0) ? ttfbMs : null;
    downloadMs = (downloadMs !== null && Number.isFinite(downloadMs) && downloadMs >= 0) ? downloadMs : null;
    documentMs = (documentMs !== null && Number.isFinite(documentMs) && documentMs >= 0) ? documentMs : null;

    // Navigation-level lifecycle timings: keep separate from individual resource timings.
    // Return null when event did not fire rather than substituting documentMs or 0.
    const domContentLoadedMs = (domContentTime !== null && navStart !== null &&
        Number.isFinite(domContentTime) && Number.isFinite(navStart) &&
        domContentTime >= navStart)
        ? roundDuration(domContentTime - navStart)
        : null;

    const loadEventMs = (loadEventTime !== null && navStart !== null &&
        Number.isFinite(loadEventTime) && Number.isFinite(navStart) &&
        loadEventTime >= navStart)
        ? roundDuration(loadEventTime - navStart)
        : null;

    const lastActivityMs = (lastActivityTime !== null && navStart !== null &&
        Number.isFinite(lastActivityTime) && Number.isFinite(navStart) &&
        lastActivityTime >= navStart)
        ? roundDuration(lastActivityTime - navStart)
        : null;

    let networkIdleMs = null;
    if (lastActivityMs !== null && loadEventMs !== null) {
        networkIdleMs = Math.max(loadEventMs, lastActivityMs);
    } else {
        networkIdleMs = lastActivityMs ?? loadEventMs ?? null;
    }

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

