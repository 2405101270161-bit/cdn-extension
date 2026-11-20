export function parseServerTiming(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return [];
    const entries = [];
    const parts = headerValue.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const subParts = trimmed.split(';').map(s => s.trim());
        const name = subParts[0];
        if (!name) continue;
        let dur = null;
        let desc = null;
        for (let i = 1; i < subParts.length; i++) {
            const [k, v] = subParts[i].split('=').map(s => s.trim());
            if (k && k.toLowerCase() === 'dur' && v) {
                const parsed = parseFloat(v.replace(/["']/g, ''));
                if (Number.isFinite(parsed)) dur = parsed;
            } else if (k && k.toLowerCase() === 'desc' && v) {
                desc = v.replace(/["']/g, '');
            }
        }
        entries.push({ name, dur, desc });
    }
    return entries;
}

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

    let dnsMs = null;
    let tcpMs = null;
    let tlsMs = null;
    let requestSentMs = null;
    let ttfbMs = null;
    let responseHeadersEndTime = null;
    let downloadMs = null;
    let documentMs = null;
    let ttfbSource = null;
    let ttfbUnavailableReason = mainDocumentResponse ? 'CDP detailed timing was not provided for the main document' : 'Main document response was not captured';

    let reused = false;
    let protocol = "Unknown";
    let remoteIp = null;
    let compression = "Unknown";

    const roundDuration = (value) => {
        if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
        return Math.round(value * 100) / 100;
    };

    if (mainDocumentResponse) {

        if (mainDocumentResponse.protocol && typeof mainDocumentResponse.protocol === 'string' && mainDocumentResponse.protocol.trim()) {
            protocol = mainDocumentResponse.protocol.trim();
        }
        remoteIp = mainDocumentResponse.remoteIPAddress || null;

        const timing = mainDocumentResponse.timing;
        reused = Boolean(
            mainDocumentResponse.connectionReused ||
            (timing && timing.dnsStart === -1 && timing.connectStart === -1)
        );

        if (mainDocumentResponse.headers && typeof mainDocumentResponse.headers === 'object') {
            const enc = mainDocumentResponse.headers['content-encoding'] ||
                        mainDocumentResponse.headers['Content-Encoding'] ||
                        null;
            compression = enc ? String(enc).trim() : "None";
        }

        if (timing) {

            if (reused) {
                dnsMs = null;
                tcpMs = null;
                tlsMs = null;
            } else {

                if (timing.dnsStart >= 0 && timing.dnsEnd >= 0 && timing.dnsEnd >= timing.dnsStart) {
                    dnsMs = roundDuration(timing.dnsEnd - timing.dnsStart);
                } else {
                    dnsMs = null;
                }

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

                if (timing.sslStart >= 0 && timing.sslEnd >= 0 && timing.sslEnd >= timing.sslStart) {
                    tlsMs = roundDuration(timing.sslEnd - timing.sslStart);
                } else {
                    tlsMs = null;
                }
            }

            if (timing.sendStart >= 0 && timing.sendEnd >= 0 && timing.sendEnd >= timing.sendStart) {
                requestSentMs = roundDuration(timing.sendEnd - timing.sendStart);
            } else {
                requestSentMs = null;
            }

            // TTFB (DevTools "Waiting for server response") requires both the request-sent
            // and response-headers markers. If either is missing, TTFB is unavailable —
            // it is never estimated from other events.
            const sendEnd = (timing.sendEnd >= 0)
                ? timing.sendEnd
                : ((timing.sendStart >= 0) ? timing.sendStart : null);

            const receiveHeadersStart = (timing.receiveHeadersStart >= 0)
                ? timing.receiveHeadersStart
                : ((timing.receiveHeadersEnd >= 0) ? timing.receiveHeadersEnd : null);

            if (receiveHeadersStart !== null && sendEnd !== null && receiveHeadersStart >= sendEnd) {
                ttfbMs = roundDuration(receiveHeadersStart - sendEnd);
                ttfbSource = 'cdp-timing';
            } else {
                ttfbUnavailableReason = 'CDP timing is missing request-sent or response-header markers';
            }

            const headersEndOffset = (timing.receiveHeadersEnd >= 0)
                ? timing.receiveHeadersEnd
                : receiveHeadersStart;

            if (headersEndOffset !== null && timing.requestTime >= 0) {
                responseHeadersEndTime = (timing.requestTime * 1000) + headersEndOffset;
            }
        }
    }

    let serverTiming = [];
    if (mainDocumentResponse?.headers && typeof mainDocumentResponse.headers === 'object') {
        const rawServerTiming = mainDocumentResponse.headers['server-timing'] ||
                                mainDocumentResponse.headers['Server-Timing'] ||
                                null;
        if (rawServerTiming) {
            serverTiming = parseServerTiming(String(rawServerTiming));
        }
    }

    let totalRequestMs = null;
    if (mainReq) {
        const respRecv = mainReq.responseReceivedTime;
        const loadFin = mainReq.loadingFinishedTime;
        const reqSent = mainReq.requestWillBeSentTime;

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

        const timing = mainDocumentResponse?.timing;
        const reqStart = (timing && timing.requestTime >= 0) ? (timing.requestTime * 1000) : reqSent;
        if (loadFin !== null && reqStart !== null &&
            Number.isFinite(loadFin) && Number.isFinite(reqStart) &&
            loadFin >= reqStart) {
            totalRequestMs = roundDuration(loadFin - reqStart);
        }

        if (loadFin !== null && navStart !== null &&
            Number.isFinite(loadFin) && Number.isFinite(navStart) &&
            loadFin >= navStart) {
            documentMs = roundDuration(loadFin - navStart);
        } else if (loadFin !== null && reqSent !== null &&
                   Number.isFinite(loadFin) && Number.isFinite(reqSent) &&
                   loadFin >= reqSent) {
            documentMs = roundDuration(loadFin - reqSent);
        } else {
            // Not substituted from partial phases (TTFB or download alone is not the document time).
            documentMs = null;
        }
    }

    ttfbMs = (ttfbMs !== null && Number.isFinite(ttfbMs) && ttfbMs >= 0) ? ttfbMs : null;
    downloadMs = (downloadMs !== null && Number.isFinite(downloadMs) && downloadMs >= 0) ? downloadMs : null;
    documentMs = (documentMs !== null && Number.isFinite(documentMs) && documentMs >= 0) ? documentMs : null;
    totalRequestMs = (totalRequestMs !== null && Number.isFinite(totalRequestMs) && totalRequestMs >= 0) ? totalRequestMs : null;

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
            serverWaitingMs: ttfbMs,
            ttfbSource: ttfbMs !== null ? ttfbSource : null,
            ttfbUnavailableReason: ttfbMs !== null ? null : ttfbUnavailableReason,
            downloadMs,
            totalRequestMs,
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
        },
        serverTiming
    };
}

export function calculateTransferSpeed(bytes, durationMs) {
    if (!bytes || !Number.isFinite(bytes) || bytes <= 0 ||
        !durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
        return null;
    }
    return (bytes / durationMs) * 1000;
}

export function formatTransferSpeed(bytesPerSec) {
    if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
        return "Not Available";
    }
    if (bytesPerSec >= 1024 * 1024) {
        return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}
