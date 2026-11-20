import {
    detectCdnProvider,
    extractCacheStatus,
    analyzeCacheDetails,
    detectResourceCdn,
    extractEdgeEvidence,
    aggregateHostCdn,
    scrubSensitiveHeaders,
    resolveHostCnames
} from './cdn.js';
import { analyzeSecurity } from './security.js';
import { analyzeResources } from './resources.js';
import { calculateMetrics, calculateTransferSpeed, formatTransferSpeed } from './metrics.js';
import { calculatePerformanceScore, generateSuggestions } from './scoring.js';

export function sanitizeErrorMessage(rawError) {
    if (!rawError) return "Unknown analysis error.";
    let msg = typeof rawError === 'string' ? rawError : (rawError.message || String(rawError));

    msg = msg.replace(/(https?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, '$1');

    msg = msg.replace(/([?&](?:token|key|api_key|apikey|secret|password|auth|access_token|session)=)[^&\s]+/gi, '$1[REDACTED]');

    if (msg.includes('net::ERR_NAME_NOT_RESOLVED')) {
        return "Domain name could not be resolved. Please verify the URL.";
    }
    if (msg.includes('net::ERR_CONNECTION_REFUSED')) {
        return "Connection refused by host server. Please verify the URL and port.";
    }
    if (msg.includes('net::ERR_CONNECTION_TIMED_OUT') || msg.includes('Navigation timed out')) {
        return "Navigation timed out while waiting for server response.";
    }
    if (msg.includes('net::ERR_CERT_') || msg.includes('net::ERR_SSL_')) {
        return "The site's TLS certificate or HTTPS configuration was rejected by Chrome.";
    }
    if (msg.includes('net::ERR_INTERNET_DISCONNECTED') || msg.includes('net::ERR_NETWORK_CHANGED')) {
        return "No internet connection was available during the analysis.";
    }
    if (msg.includes('net::ERR_BLOCKED_BY_CLIENT') || msg.includes('net::ERR_BLOCKED_BY_ADMINISTRATOR')) {
        return "The page load was blocked by another extension or by browser policy.";
    }
    if (/net::ERR_[A-Z_]+/.test(msg) && !/\s/.test(msg.trim())) {
        return `The page could not be loaded (${msg.trim()}).`;
    }
    if (msg.includes('Cannot attach to this target') || msg.includes('Another debugger is already attached')) {
        return "Could not attach debugger to analysis tab. Another debugger may be active.";
    }

    return msg;
}

export async function executeCdpAnalysis(targetUrl, notifyProgress, cancelToken = null) {
    let tempTabId = null;
    let debuggerAttached = false;
    let isCleanedUp = false;

    async function cleanup() {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (cancelToken && cancelToken.tabId === tempTabId) {
            cancelToken.tabId = null;
        }
        if (debuggerAttached && tempTabId) {
            debuggerAttached = false;
            await chrome.debugger.detach({ tabId: tempTabId }).catch(() => {});
        }
        if (tempTabId) {
            const tid = tempTabId;
            tempTabId = null;
            await chrome.tabs.remove(tid).catch(() => {});
        }
    }

    try {
        if (cancelToken?.isCancelled) {
            throw new Error("Analysis was cancelled.");
        }

        notifyProgress("Validating URL...");
        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
            throw new Error("Invalid URL scheme. Please enter a valid http:// or https:// website URL.");
        }

        if (cancelToken?.isCancelled) {
            throw new Error("Analysis was cancelled.");
        }

        notifyProgress("Creating Background Analysis Tab...");
        let bgTab;
        try {
            bgTab = await chrome.tabs.create({
                url: 'about:blank',
                active: false
            });
        } catch (tabErr) {
            throw new Error("Failed to create background tab: " + tabErr.message);
        }

        tempTabId = bgTab?.id;
        if (cancelToken) {
            cancelToken.tabId = tempTabId;
        }

        if (cancelToken?.isCancelled) {
            throw new Error("Analysis was cancelled.");
        }

        if (!tempTabId) {
            throw new Error("Failed to create background tab for analysis.");
        }

        notifyProgress("Connecting Chrome Debugger...");
        try {
            await chrome.debugger.attach({ tabId: tempTabId }, "1.3");
            debuggerAttached = true;
        } catch (attachErr) {
            throw new Error("Failed to attach Chrome debugger: " + attachErr.message);
        }

        if (cancelToken?.isCancelled) {
            throw new Error("Analysis was cancelled.");
        }

        notifyProgress("Loading Website...");
        const rawReport = await captureCdpEvents(tempTabId, targetUrl, notifyProgress, cancelToken);

        if (cancelToken?.isCancelled) {
            throw new Error("Analysis was cancelled.");
        }

        notifyProgress("Generating Report...");
        return {
            success: true,
            data: rawReport
        };

    } catch (err) {
        if (cancelToken?.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: "Analysis was cancelled."
            };
        }
        console.error("[CDP Engine v2] Error during analysis:", err);
        return {
            success: false,
            error: sanitizeErrorMessage(err.message || "Background analysis failed.")
        };
    } finally {
        await cleanup();
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

        try {
            chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);
                if (chrome.runtime && chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                resolve(result);
            });
        } catch (err) {
            if (!isDone) {
                isDone = true;
                clearTimeout(timer);
                reject(err);
            }
        }
    });
}

function captureCdpEvents(tabId, targetUrl, notifyProgress, cancelToken = null) {
    return new Promise(async (resolve, reject) => {
        let isResolved = false;

        const requests = new Map();

        const extraInfoBuffer = new Map();

        let mainRequestId = null;
        let mainFrameId = null;
        let isMainDocumentLocked = false;
        let mainNavigationStart = null;
        let mainDocumentResponse = null;
        let mainExtraHeadersStore = null;
        let mainDocumentErrorText = null;
        let domContentTime = null;
        let loadEventTime = null;
        let lastActivityTime = null;
        let requestedUrl = targetUrl;
        let finalUrl = targetUrl;
        let navigationStartCDP = null;

        let idleTimer = null;
        let postLoadCapTimer = null;
        let domContentCapTimer = null;

        function clearAllTimers() {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (idleTimer) clearTimeout(idleTimer);
            if (postLoadCapTimer) clearTimeout(postLoadCapTimer);
            if (domContentCapTimer) clearTimeout(domContentCapTimer);
        }

        const timeoutTimer = setTimeout(() => {
            finishAnalysis("Navigation timed out (8s ceiling reached)");
        }, 8000);

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
            if (cancelToken) {
                cancelToken.onCancel = null;
            }
        }

        function abortAnalysis(err) {
            if (isResolved) return;
            isResolved = true;
            clearAllTimers();
            cleanupListeners();
            requests.clear();
            extraInfoBuffer.clear();
            reject(err instanceof Error ? err : new Error(String(err)));
        }

        if (cancelToken) {
            cancelToken.onCancel = () => {
                abortAnalysis(new Error("Analysis cancelled"));
            };
        }

        function detachListener(source, reason) {
            if (source.tabId === tabId) {
                console.warn(`[CDP Engine v2] Debugger detached for tab ${tabId}: ${reason}`);
                if (mainDocumentResponse) {
                    finishAnalysis("Debugger detached after main document response");
                } else {
                    abortAnalysis(new Error(`Debugger detached unexpectedly: ${reason || 'Target closed or navigated'}`));
                }
            }
        }

        function tabRemovedListener(removedTabId) {
            if (removedTabId === tabId) {
                console.warn(`[CDP Engine v2] Background tab ${tabId} closed prematurely.`);
                if (mainDocumentResponse) {
                    finishAnalysis("Analysis tab closed after main document response");
                } else {
                    abortAnalysis(new Error("Background analysis tab was closed before completion."));
                }
            }
        }

        async function finishAnalysis(reason = "complete") {
            const finishReason = reason;
            if (isResolved) return;
            if (cancelToken?.isCancelled) {
                abortAnalysis(new Error("Analysis cancelled"));
                return;
            }
            isResolved = true;

            clearAllTimers();
            cleanupListeners();

            for (const [bufferedId, bufferedHeaders] of extraInfoBuffer.entries()) {
                const reqData = requests.get(bufferedId);
                if (reqData && !reqData.rawResponseHeaders) {
                    reqData.rawResponseHeaders = bufferedHeaders;
                }
            }
            extraInfoBuffer.clear();

            // Only a Document response may stand in for the main document. A script or
            // image response is never reported as the page's response.
            if (!mainDocumentResponse && requests.size > 0) {
                for (const [id, req] of requests.entries()) {
                    if (req.response && req.type === 'Document') {
                        mainRequestId = id;
                        mainDocumentResponse = req.response;
                        if (req.response.url) finalUrl = req.response.url;
                        break;
                    }
                }
            }
            const mainDocumentCaptured = Boolean(mainDocumentResponse);
            // A navigation that failed outright (DNS failure, refused, TLS error…) is an error,
            // not an analysis of Chrome's own error page.
            if (!mainDocumentCaptured && mainDocumentErrorText) {
                requests.clear();
                extraInfoBuffer.clear();
                reject(new Error(mainDocumentErrorText));
                return;
            }
            const warnings = [];
            if (!mainDocumentCaptured) {
                warnings.push('The main document response was not captured. Status code, CDN, cache and header results for the document are unavailable.');
            }
            if (finishReason && /timed out|cap after DOMContentLoaded/i.test(finishReason)) {
                warnings.push(`Capture ended early: ${finishReason}. Late requests may be missing.`);
            }

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

                const mainHost = (() => { try { return new URL(finalUrl).hostname.toLowerCase(); } catch (e) { return null; } })();

                // Resolve CNAME chains for the document host and every unique resource host
                // (deduplicated, concurrency-limited, time-budgeted and cancellable).
                notifyProgress("Resolving DNS aliases...");
                const hostSet = new Set();
                if (mainHost) hostSet.add(mainHost);
                for (const req of requests.values()) {
                    if (!req.url || !/^https?:\/\//i.test(req.url)) continue;
                    try { hostSet.add(new URL(req.url).hostname.toLowerCase()); } catch (e) {}
                }
                const dnsController = new AbortController();
                if (cancelToken) {
                    cancelToken.onCancel = () => dnsController.abort();
                }
                let dnsBatch = { results: new Map(), attempted: 0, resolved: 0, unresolved: [], skipped: [], timedOut: false, cancelled: false };
                try {
                    dnsBatch = await resolveHostCnames(Array.from(hostSet), {
                        concurrency: 6,
                        maxHosts: 30,
                        budgetMs: 3500,
                        timeoutMs: 2000,
                        signal: dnsController.signal
                    });
                } catch (e) {}
                if (cancelToken) cancelToken.onCancel = null;
                if (cancelToken?.isCancelled) {
                    throw new Error("Analysis cancelled");
                }
                const dnsInfo = mainHost ? (dnsBatch.results.get(mainHost) || null) : null;

                const mainRemoteIp = metricsResult.connection?.remoteIp || (mainDocumentResponse ? mainDocumentResponse.remoteIPAddress : null);
                const cdnResult = mainDocumentCaptured
                    ? detectCdnProvider(rawHeaders, { dnsInfo, remoteIp: mainRemoteIp, hostname: mainHost })
                    : detectCdnProvider({}, { dnsInfo, hostname: mainHost });
                if (dnsInfo) {
                    cdnResult.dns = dnsInfo;
                }
                const mainCacheDetails = analyzeCacheDetails(rawHeaders, mainDocumentResponse);
                const cacheProviderStatus = mainCacheDetails.summary;

                const resourceEvidenceList = [];
                for (const [reqId, req] of requests.entries()) {
                    if (!req.url || !/^https?:\/\//i.test(req.url)) continue;

                    const mergedHeaders = {};
                    if (req.response && req.response.headers) {
                        for (const [k, v] of Object.entries(req.response.headers)) {
                            mergedHeaders[k.toLowerCase()] = String(v);
                        }
                    }
                    if (req.rawResponseHeaders) {
                        for (const [k, v] of Object.entries(req.rawResponseHeaders)) {
                            mergedHeaders[k.toLowerCase()] = String(v);
                        }
                    }

                    const cleanHeaders = scrubSensitiveHeaders(mergedHeaders);
                    const remoteIp = req.response?.remoteIPAddress || null;
                    const remotePort = req.response?.remotePort || null;
                    const protocol = req.response?.protocol || null;
                    const statusCode = Number.isInteger(req.response?.status) ? req.response.status : null;
                    let reqHost = '';
                    try { reqHost = new URL(req.url).hostname.toLowerCase(); } catch (e) {}
                    const hostDns = dnsBatch.results.get(reqHost) || null;

                    const resourceCdn = detectResourceCdn(cleanHeaders, req.url, req.type, remoteIp, remotePort, {
                        cnames: hostDns ? hostDns.cnames : [],
                        dnsInfo: hostDns
                    });
                    const resourceCacheDetails = analyzeCacheDetails(cleanHeaders, req.response);
                    const resourceCache = resourceCacheDetails.summary;

                    resourceEvidenceList.push({
                        requestId: reqId,
                        url: req.url,
                        hostname: resourceCdn.hostname,
                        cnames: hostDns ? hostDns.cnames : [],
                        resourceType: req.type || 'Other',
                        statusCode,
                        protocol,
                        remoteIPAddress: remoteIp,
                        remotePort,
                        encodedDataLength: req.encodedDataLength || 0,
                        failed: req.failed || false,
                        canceled: req.canceled || false,
                        redirects: req.redirects || [],
                        headers: cleanHeaders,
                        cdn: resourceCdn,
                        edge: resourceCdn.edge,
                        cacheStatus: resourceCache,
                        cacheDetails: resourceCacheDetails
                    });
                }

                const hostAnalysis = aggregateHostCdn(resourceEvidenceList, finalUrl);

                const mainRemotePort = mainDocumentResponse ? mainDocumentResponse.remotePort : null;
                const mainEdge = extractEdgeEvidence(rawHeaders, cdnResult.provider, mainRemoteIp, mainRemotePort);
                cdnResult.edge = mainEdge;
                cdnResult.byHost = hostAnalysis.byHost;
                cdnResult.allProviders = hostAnalysis.allProviders;

                notifyProgress("Checking Security Headers...");
                const securityResult = analyzeSecurity(finalUrl, mainDocumentResponse, rawHeaders);

                notifyProgress("Building Waterfall...");
                const resourcesResult = analyzeResources(finalUrl, requests);

                const scoreDetails = calculatePerformanceScore({
                    isHttps: securityResult.isHttps,
                    timing: metricsResult.timing,
                    cacheStatus: cacheProviderStatus,
                    headers: rawHeaders,
                    compression: metricsResult.connection.compression,
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
                    resourceHighlights: resourcesResult.highlights,
                    isHttps: securityResult.isHttps,
                    mainDocumentCaptured,
                    contentType: mainDocumentResponse ? (mainDocumentResponse.mimeType || null) : null
                });

                const documentSource = mainDocumentResponse ? (
                    mainDocumentResponse.fromDiskCache ? 'disk-cache' :
                    (mainDocumentResponse.fromMemoryCache || mainReq?.servedFromCache) ? 'memory-cache' :
                    mainDocumentResponse.fromServiceWorker ? 'service-worker' :
                    mainDocumentResponse.fromPrefetchCache ? 'prefetch' : 'network'
                ) : 'unknown';

                const docBytes = mainReq?.encodedDataLength || (mainDocumentResponse ? (mainDocumentResponse.encodedDataLength || 0) : 0);
                const docDuration = metricsResult.timing.downloadMs || metricsResult.timing.documentMs;
                const documentTransferSpeed = calculateTransferSpeed(docBytes, docDuration);

                const totalBytes = resourcesResult.encodedBytes;
                const totalDuration = metricsResult.timing.loadEventMs || metricsResult.timing.networkIdleMs || metricsResult.timing.documentMs;
                const pageTransferSpeed = calculateTransferSpeed(totalBytes, totalDuration);

                const finalResult = {
                    schemaVersion: 2,
                    requestedUrl,
                    finalUrl,
                    // Never report HTTP 200 for a response that was not captured.
                    statusCode: (mainDocumentResponse && Number.isInteger(mainDocumentResponse.status)) ? mainDocumentResponse.status : null,
                    mainDocumentCaptured,
                    warnings,
                    finishReason,
                    timing: metricsResult.timing,
                    connection: metricsResult.connection,
                    serverTiming: metricsResult.serverTiming || [],
                    transfer: {
                        requestCount: resourcesResult.requestCount,
                        failedRequestCount: resourcesResult.failedRequestCount,
                        canceledRequestCount: resourcesResult.canceledRequestCount,
                        cachedRequestCount: resourcesResult.cachedRequestCount,
                        serviceWorkerRequestCount: resourcesResult.serviceWorkerRequestCount,
                        encodedBytes: resourcesResult.encodedBytes,
                        decodedBytes: resourcesResult.decodedBytes,
                        firstPartyCount: resourcesResult.firstPartyCount,
                        thirdPartyCount: resourcesResult.thirdPartyCount,
                        documentTransferSpeed,
                        pageTransferSpeed,
                        documentTransferSpeedFormatted: formatTransferSpeed(documentTransferSpeed),
                        pageTransferSpeedFormatted: formatTransferSpeed(pageTransferSpeed),
                        breakdown: resourcesResult.breakdown
                    },
                    highlights: resourcesResult.highlights,
                    tls: securityResult.tls,
                    securityHeaders: securityResult.headers,
                    cdn: cdnResult,
                    cdnByHost: hostAnalysis.byHost,
                    allProviders: hostAnalysis.allProviders,
                    delivery: hostAnalysis.delivery,
                    dnsSummary: {
                        attempted: dnsBatch.attempted,
                        resolved: dnsBatch.resolved,
                        unresolved: dnsBatch.unresolved,
                        skipped: dnsBatch.skipped,
                        timedOut: dnsBatch.timedOut
                    },
                    resourceEvidence: resourceEvidenceList,
                    cache: {
                        documentSource,
                        providerStatus: cacheProviderStatus,
                        details: mainCacheDetails
                    },
                    scoreDetails,
                    suggestions,
                    timestamp: new Date().toISOString()
                };
                requests.clear();
                extraInfoBuffer.clear();
                resolve(finalResult);
            } catch (err) {
                requests.clear();
                extraInfoBuffer.clear();
                reject(err);
            }
        }

        function cdpEventListener(source, method, params) {
            if (source.tabId !== tabId) return;
            if (isResolved || cancelToken?.isCancelled) return;

            const now = performance.now();
            lastActivityTime = params.timestamp ? params.timestamp * 1000 : now;

            if (method === 'Page.frameNavigated') {
                if (params.frame && !params.frame.parentId) {
                    mainFrameId = params.frame.id;
                }
            } else if (method === 'Page.domContentEventFired') {
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
                const isMainFrameDoc = (params.type === 'Document') && (!mainFrameId || !params.frameId || params.frameId === mainFrameId);

                if (isMainFrameDoc && (!isMainDocumentLocked || reqId === mainRequestId)) {
                    mainRequestId = reqId;
                    if (!mainFrameId && params.frameId) {
                        mainFrameId = params.frameId;
                    }
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

                let entry = requests.get(reqId);
                if (entry) {
                    if (params.redirectResponse) {
                        if (!entry.redirects) entry.redirects = [];
                        entry.redirects.push({
                            url: entry.url,
                            status: params.redirectResponse.status,
                            headers: params.redirectResponse.headers || {},
                            remoteIPAddress: params.redirectResponse.remoteIPAddress || null
                        });
                    }
                    entry.url = params.request.url;
                    entry.type = params.type || entry.type;
                } else {
                    entry = {
                        url: params.request.url,
                        type: params.type,
                        requestWillBeSentTime: eventTimeMs,
                        response: null,
                        responseReceivedTime: null,
                        loadingFinishedTime: null,
                        encodedDataLength: 0,
                        rawResponseHeaders: null,
                        failed: false,
                        redirects: []
                    };

                    if (params.redirectResponse) {
                        entry.redirects.push({
                            url: params.redirectResponse.url || params.request.url,
                            status: params.redirectResponse.status,
                            headers: params.redirectResponse.headers || {},
                            remoteIPAddress: params.redirectResponse.remoteIPAddress || null
                        });
                    }

                    if (extraInfoBuffer.has(reqId)) {
                        entry.rawResponseHeaders = extraInfoBuffer.get(reqId);
                        extraInfoBuffer.delete(reqId);

                        if (params.type === 'Document' && (reqId === mainRequestId || isMainFrameDoc)) {
                            mainExtraHeadersStore = entry.rawResponseHeaders;
                        }
                    }

                    requests.set(reqId, entry);
                }

            } else if (method === 'Network.responseReceived') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);
                if (reqData) {
                    reqData.response = params.response;
                    reqData.responseReceivedTime = params.timestamp * 1000;
                }
                const isMainDocReq = (reqId === mainRequestId) || (!mainDocumentResponse && params.type === 'Document' && (!mainFrameId || !params.frameId || params.frameId === mainFrameId));
                if (isMainDocReq && !isMainDocumentLocked) {
                    mainRequestId = reqId;
                    mainDocumentResponse = params.response;
                    if (params.response && params.response.url) {
                        finalUrl = params.response.url;
                    }
                    const status = params.response?.status || 200;
                    if (status < 300 || status >= 400) {
                        isMainDocumentLocked = true;
                    }
                }

            } else if (method === 'Network.responseReceivedExtraInfo') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);

                if (reqData) {

                    reqData.rawResponseHeaders = params.headers || null;
                    if (reqId === mainRequestId) {
                        mainExtraHeadersStore = params.headers || null;
                    }
                } else {

                    if (params.headers) {
                        extraInfoBuffer.set(reqId, params.headers);
                    }
                }

            } else if (method === 'Network.requestServedFromCache') {
                const reqId = params.requestId;
                const reqData = requests.get(reqId);
                if (reqData) {
                    reqData.servedFromCache = true;
                    if (reqData.response) {
                        reqData.response.fromMemoryCache = true;
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

                    const isCanceled = Boolean(params.canceled || params.errorText === 'net::ERR_ABORTED');
                    reqData.canceled = isCanceled;
                    reqData.errorText = params.errorText || null;
                    if (reqId === mainRequestId && !mainDocumentResponse && !isCanceled && params.errorText) {
                        mainDocumentErrorText = params.errorText;
                    }

                    if (isCanceled) {

                        reqData.failed = false;
                    } else {
                        const existingStatus = reqData.response ? reqData.response.status : null;
                        if (existingStatus !== null && existingStatus < 400) {

                            reqData.failed = false;
                        } else {

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
            const navResult = await cdpSend(tabId, "Page.navigate", { url: targetUrl });
            if (navResult && navResult.frameId) {
                mainFrameId = navResult.frameId;
            }
            if (navResult && navResult.errorText && !mainDocumentResponse) {
                mainDocumentErrorText = navResult.errorText;
            }
        } catch (err) {
            if (cancelToken?.isCancelled) {
                abortAnalysis(new Error("Analysis cancelled"));
                return;
            }
            console.warn("[CDP Engine v2] Page.navigate returned error:", err.message);
            if (mainDocumentResponse || requests.size > 0) {
                if (!idleTimer) {
                    idleTimer = setTimeout(() => {
                        finishAnalysis("Completed following navigation warning");
                    }, 1500);
                }
            } else {
                abortAnalysis(err);
            }
        }
    });
}
