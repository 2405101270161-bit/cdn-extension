/**
 * CDN Analyzer Pro v2 - CDP Orchestration & Background Tab Module
 * Manages background tab creation, debugger attachment, CDP event capture, and strict cleanup.
 *
 * FIXES APPLIED:
 *  BUG-02: Buffer Network.responseReceivedExtraInfo events that arrive before
 *          requestWillBeSent has created the map entry. Merge at entry creation
 *          time and again at finishAnalysis.
 *  BUG-03: mainRequestId is only assigned from type === 'Document' requests.
 *          Removed the unsafe `|| !mainRequestId` fallback that caused any
 *          first-arriving request (favicon, prefetch) to steal the main ID.
 *  BUG-05: Network.loadingFailed no longer marks a request as failed when a
 *          responseReceived event already recorded an HTTP status < 400. This
 *          fixes "Failed=1 while HTTP Status=200".
 *  BUG-07: navigationStartCDP is only set from Document-type requests so that
 *          all relative timings (domContentLoaded, loadEvent) use the correct
 *          epoch baseline.
 */

import { detectCdnProvider, extractCacheStatus } from './cdn.js';
import { analyzeSecurity } from './security.js';
import { analyzeResources } from './resources.js';
import { calculateMetrics } from './metrics.js';
import { calculatePerformanceScore, generateSuggestions } from './scoring.js';

export async function executeCdpAnalysis(targetUrl, notifyProgress) {
    let tempTabId = null;
    let debuggerAttached = false;

    try {
        notifyProgress("Validating URL...");
        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
            throw new Error("Invalid URL scheme. Please enter a valid http:// or https:// website URL.");
        }

        notifyProgress("Creating Background Analysis Tab...");
        const bgTab = await chrome.tabs.create({
            url: 'about:blank',
            active: false
        });
        tempTabId = bgTab.id;

        if (!tempTabId) {
            throw new Error("Failed to create background tab for analysis.");
        }

        notifyProgress("Connecting Chrome Debugger...");
        await chrome.debugger.attach({ tabId: tempTabId }, "1.3");
        debuggerAttached = true;

        notifyProgress("Loading Website...");
        const rawReport = await captureCdpEvents(tempTabId, targetUrl, notifyProgress);

        notifyProgress("Generating Report...");
        return {
            success: true,
            data: rawReport
        };

    } catch (err) {
        console.error("[CDP Engine v2] Error during analysis:", err);
        return {
            success: false,
            error: err.message || "Background analysis failed."
        };
    } finally {
        if (debuggerAttached && tempTabId) {
            await chrome.debugger.detach({ tabId: tempTabId }).catch(() => {});
        }
        if (tempTabId) {
            await chrome.tabs.remove(tempTabId).catch(() => {});
        }
    }
}

function cdpSend(tabId, method, params = {}, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        let isDone = false;
        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                reject(new Error(`CDP command ${method} timed out`));
            }
        }, timeoutMs);

        chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(result);
        });
    });
}

function captureCdpEvents(tabId, targetUrl, notifyProgress) {
    return new Promise(async (resolve, reject) => {
        let isResolved = false;

        const requests = new Map();

        // BUG-02 FIX: Side-buffer for ExtraInfo events that arrive before
        // requestWillBeSent has created the corresponding map entry.
        const extraInfoBuffer = new Map();

        let mainRequestId = null;
        let mainNavigationStart = null;
        let mainDocumentResponse = null;
        let mainExtraHeadersStore = null;
        let domContentTime = null;
        let loadEventTime = null;
        let lastActivityTime = null;
        let requestedUrl = targetUrl;
        let finalUrl = targetUrl;
        let navigationStartCDP = null;

        const timeoutTimer = setTimeout(() => {
            finishAnalysis("Navigation timed out (8s ceiling reached)");
        }, 8000);

        let idleTimer = null;
        let postLoadCapTimer = null;
        let domContentCapTimer = null;

        function scheduleCompletionAfterLoad() {
            if (!postLoadCapTimer) {
                postLoadCapTimer = setTimeout(() => {
                    finishAnalysis("Post-load ceiling reached (1.0s after page load)");
                }, 1000);
            }
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                finishAnalysis("Network quiescence after page load");
            }, 400);
        }

        function cleanupListeners() {
            chrome.debugger.onEvent.removeListener(cdpEventListener);
            chrome.debugger.onDetach.removeListener(detachListener);
            chrome.tabs.onRemoved.removeListener(tabRemovedListener);
        }

        function detachListener(source, reason) {
            if (source.tabId === tabId) {
                console.warn(`[CDP Engine v2] Debugger detached for tab ${tabId}: ${reason}`);
                cleanupListeners();
                if (mainDocumentResponse) {
                    finishAnalysis("Debugger detached after main document response");
                } else if (!isResolved) {
                    isResolved = true;
                    reject(new Error(`Debugger detached unexpectedly: ${reason || 'Target closed or navigated'}`));
                }
            }
        }

        function tabRemovedListener(removedTabId) {
            if (removedTabId === tabId) {
                console.warn(`[CDP Engine v2] Background tab ${tabId} closed prematurely.`);
                cleanupListeners();
                if (mainDocumentResponse) {
                    finishAnalysis("Analysis tab closed after main document response");
                } else if (!isResolved) {
                    isResolved = true;
                    reject(new Error("Background analysis tab was closed before completion."));
                }
            }
        }

        function finishAnalysis(reason = "complete") {
            if (isResolved) return;
            isResolved = true;

            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (idleTimer) clearTimeout(idleTimer);
            if (postLoadCapTimer) clearTimeout(postLoadCapTimer);
            if (domContentCapTimer) clearTimeout(domContentCapTimer);

            cleanupListeners();

            // BUG-02 FIX: At analysis completion, flush any remaining buffered
            // ExtraInfo events into their map entries (handles cases where
            // ExtraInfo arrived after loadingFinished but before we resolved).
            for (const [bufferedId, bufferedHeaders] of extraInfoBuffer.entries()) {
                const reqData = requests.get(bufferedId);
                if (reqData && !reqData.rawResponseHeaders) {
                    reqData.rawResponseHeaders = bufferedHeaders;
                }
            }
            extraInfoBuffer.clear();

            try {
                notifyProgress("Calculating DNS, TCP, TLS, and TTFB...");
                const metricsResult = calculateMetrics({
                    mainRequestId,
                    requests,
                    mainDocumentResponse,
                    navigationStartCDP,
                    domContentTime,
                    loadEventTime,
                    lastActivityTime
                });

                notifyProgress("Detecting CDN...");
                const rawHeaders = {};
                if (mainDocumentResponse && mainDocumentResponse.headers) {
                    for (const [k, v] of Object.entries(mainDocumentResponse.headers)) {
                        rawHeaders[k.toLowerCase()] = String(v);
                    }
                }
                const mainReq = requests.get(mainRequestId);
                if (mainReq && mainReq.rawResponseHeaders) {
                    for (const [k, v] of Object.entries(mainReq.rawResponseHeaders)) {
                        rawHeaders[k.toLowerCase()] = String(v);
                    }
                }
                if (mainExtraHeadersStore) {
                    for (const [k, v] of Object.entries(mainExtraHeadersStore)) {
                        rawHeaders[k.toLowerCase()] = String(v);
                    }
                }

                const cdnResult = detectCdnProvider(rawHeaders);
                const cacheProviderStatus = extractCacheStatus(rawHeaders);

                notifyProgress("Checking Security Headers...");
                const securityResult = analyzeSecurity(finalUrl, mainDocumentResponse, rawHeaders);

                notifyProgress("Building Waterfall...");
                const resourcesResult = analyzeResources(finalUrl, requests);

                const scoreDetails = calculatePerformanceScore({
                    isHttps: securityResult.isHttps,
                    timing: metricsResult.timing,
                    cacheStatus: cacheProviderStatus,
                    headers: rawHeaders,
                    failedRequestCount: resourcesResult.failedRequestCount,
                    protocol: metricsResult.connection.protocol
                });

                const suggestions = generateSuggestions({
                    targetUrl,
                    cdnResult,
                    timing: metricsResult.timing,
                    cacheStatus: cacheProviderStatus,
                    headers: rawHeaders,
                    tls: securityResult.tls,
                    resourceHighlights: resourcesResult.highlights
                });

                const documentSource = mainDocumentResponse ? (
                    mainDocumentResponse.fromDiskCache ? 'disk-cache' :
                    mainDocumentResponse.fromServiceWorker ? 'service-worker' :
                    mainDocumentResponse.fromPrefetchCache ? 'prefetch' : 'network'
                ) : 'network';

                resolve({
                    schemaVersion: 2,
                    requestedUrl,
                    finalUrl,
                    statusCode: mainDocumentResponse ? mainDocumentResponse.status : 200,
                    timing: metricsResult.timing,
                    connection: metricsResult.connection,
                    transfer: {
                        requestCount: resourcesResult.requestCount,
                        failedRequestCount: resourcesResult.failedRequestCount,
                        encodedBytes: resourcesResult.encodedBytes,
                        firstPartyCount: resourcesResult.firstPartyCount,
                        thirdPartyCount: resourcesResult.thirdPartyCount,
                        breakdown: resourcesResult.breakdown
                    },
                    highlights: resourcesResult.highlights,
                    tls: securityResult.tls,
                    securityHeaders: securityResult.headers,
                    cdn: cdnResult,
                    cache: {
                        documentSource,
                        providerStatus: cacheProviderStatus
                    },
                    scoreDetails,
                    suggestions,
                    timestamp: new Date().toISOString()
                });
            } catch (err) {
                reject(err);
            }
        }

        function cdpEventListener(source, method, params) {
            if (source.tabId !== tabId) return;

            const now = performance.now();
            lastActivityTime = params.timestamp ? params.timestamp * 1000 : now;

            if (method === 'Page.domContentEventFired') {
                domContentTime = params.timestamp * 1000;
                notifyProgress("Capturing Network Requests...");
                if (!domContentCapTimer) {
                    domContentCapTimer = setTimeout(() => {
                        finishAnalysis("2.5s cap after DOMContentLoaded");
                    }, 2500);
                }
                if (loadEventTime) scheduleCompletionAfterLoad();

            } else if (method === 'Page.loadEventFired') {
                loadEventTime = params.timestamp * 1000;
                scheduleCompletionAfterLoad();

            } else if (method === 'Network.requestWillBeSent') {
                const reqId = params.requestId;
                const eventTimeMs = params.timestamp * 1000;

                // BUG-03 FIX: Only assign mainRequestId from Document-type
                // requests. The old `|| !mainRequestId` fallback caused
                // favicons, prefetches, and other early requests to steal the
                // main document slot before the real Document request arrived.
                if (params.type === 'Document') {
                    mainRequestId = reqId;
                    // BUG-07 FIX: Only anchor navigationStartCDP to the Document
                    // request so that domContentLoaded/loadEvent deltas are correct.
                    if (!navigationStartCDP) {
                        navigationStartCDP = eventTimeMs;
                    }
                    if (params.redirectResponse) {
                        finalUrl = params.request.url;
                    } else {
                        requestedUrl = params.request.url;
                        finalUrl = params.request.url;
                    }
                }

                const entry = {
                    url: params.request.url,
                    type: params.type,
                    requestWillBeSentTime: eventTimeMs,
                    response: null,
                    responseReceivedTime: null,
                    loadingFinishedTime: null,
                    encodedDataLength: 0,
                    rawResponseHeaders: null,
                    failed: false
                };

                // BUG-02 FIX: If ExtraInfo arrived before this request was
                // registered, pull it from the buffer and attach it now.
                if (extraInfoBuffer.has(reqId)) {
                    entry.rawResponseHeaders = extraInfoBuffer.get(reqId);
                    extraInfoBuffer.delete(reqId);
                    // Also update the main document ExtraInfo store if applicable.
                    if (params.type === 'Document') {
                        mainExtraHeadersStore = entry.rawResponseHeaders;
                    }
                }

                requests.set(reqId, entry);

            } else if (method === 'Network.responseReceived') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);
                if (reqData) {
                    reqData.response = params.response;
                    reqData.responseReceivedTime = params.timestamp * 1000;
                }
                if (reqId === mainRequestId || (params.type === 'Document' && !mainDocumentResponse)) {
                    mainRequestId = reqId;
                    mainDocumentResponse = params.response;
                    if (params.response && params.response.url) {
                        finalUrl = params.response.url;
                    }
                }

            } else if (method === 'Network.responseReceivedExtraInfo') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);

                if (reqData) {
                    // Request entry exists — attach headers directly.
                    reqData.rawResponseHeaders = params.headers || null;
                    if (reqId === mainRequestId || reqData.type === 'Document') {
                        mainExtraHeadersStore = params.headers || null;
                    }
                } else {
                    // BUG-02 FIX: requestWillBeSent has not fired yet for this
                    // requestId. Buffer the headers — they will be merged when
                    // requestWillBeSent fires (above) or at finishAnalysis.
                    if (params.headers) {
                        extraInfoBuffer.set(reqId, params.headers);
                    }
                }

            } else if (method === 'Network.loadingFinished') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);
                if (reqData) {
                    reqData.loadingFinishedTime = params.timestamp * 1000;
                    reqData.encodedDataLength = params.encodedDataLength || 0;
                }
                if (loadEventTime) scheduleCompletionAfterLoad();

            } else if (method === 'Network.loadingFailed') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);
                if (reqData) {
                    // BUG-05 FIX: Only mark as truly failed when:
                    //   (a) The request was explicitly cancelled/aborted by the browser
                    //       (params.canceled or net::ERR_ABORTED) — these are benign
                    //       navigational artifacts and must NOT be counted.
                    //   (b) The request has no prior response recorded at all, meaning
                    //       it failed at the network level before any response arrived.
                    //   (c) The request has a prior response but with HTTP status >= 400.
                    //
                    // This prevents streaming/media resources that finish normally
                    // from being counted as failures ("Failed=1, HTTP Status=200").
                    const isCanceled = params.canceled || params.errorText === 'net::ERR_ABORTED';
                    if (isCanceled) {
                        // Benign browser-cancelled request — not a real failure.
                        reqData.failed = false;
                    } else {
                        const existingStatus = reqData.response ? reqData.response.status : null;
                        if (existingStatus !== null && existingStatus < 400) {
                            // A valid HTTP response was already received — this loadingFailed
                            // is for a resource that completed (e.g. SSE stream closed, media
                            // range request). Do not count as failed.
                            reqData.failed = false;
                        } else {
                            // Genuine network failure with no prior successful response.
                            reqData.failed = true;
                        }
                    }
                }
                if (loadEventTime) scheduleCompletionAfterLoad();
            }
        }

        chrome.debugger.onEvent.addListener(cdpEventListener);
        chrome.debugger.onDetach.addListener(detachListener);
        chrome.tabs.onRemoved.addListener(tabRemovedListener);

        try {
            await cdpSend(tabId, "Network.enable");
            await cdpSend(tabId, "Page.enable");

            notifyProgress("Navigating to Target Site...");
            mainNavigationStart = performance.now();
            await cdpSend(tabId, "Page.navigate", { url: targetUrl });
        } catch (err) {
            console.warn("[CDP Engine v2] Page.navigate returned error:", err.message);
            if (mainDocumentResponse || requests.size > 0) {
                if (!idleTimer) {
                    idleTimer = setTimeout(() => {
                        finishAnalysis("Completed following navigation warning");
                    }, 1500);
                }
            } else {
                cleanupListeners();
                reject(err);
            }
        }
    });
}
