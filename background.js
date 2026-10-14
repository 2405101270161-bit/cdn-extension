/**
 * CDN Analyzer Pro v2 - Core Engine (Service Worker Orchestrator)
 * Single-pass CDP Background Tab Analysis Engine with complete reset & isolation.
 */

import { executeCdpAnalysis, sanitizeErrorMessage } from './modules/cdp.js';
export { sanitizeErrorMessage };

const ANALYSIS_STATE_KEY = 'cdnAnalyzerAnalysisState';
const LEGACY_STORAGE_KEYS = [
    'cdnAnalyzerAnalysisState',
    'lastAnalysis',
    'cachedReport',
    'cdnCache',
    'cdn_analyzer_cache'
];

let activeAnalysisPromise = null;
let activeCancelToken = null;
let currentAnalysisState = {
    analysisId: null,
    status: 'idle',
    url: null,
    progress: null,
    result: null,
    error: null,
    startedAt: null,
    updatedAt: null
};
let currentAnalysisId = 0;

// Clear stale analysis data whenever the extension initializes or updates
chrome.runtime.onInstalled.addListener(() => {
    clearAnalysisState().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
    clearAnalysisState().catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_ANALYSIS') {
        startTrackedAnalysis(request).then(sendResponse);
        return true; // Keep IPC channel open for async response
    }
    if (request.action === 'GET_ANALYSIS_STATE') {
        getStoredAnalysisState().then(state => sendResponse({ state }));
        return true;
    }
    if (request.action === 'CLEAR_ANALYSIS_STATE') {
        clearAnalysisState().then(() => sendResponse({ success: true }));
        return true;
    }
});

/**
 * Centralized, idempotent reset mechanism that cancels active analyses,
 * purges memory references, cleans analysis storage keys, and notifies listeners.
 */
export async function clearAnalysisState() {
    currentAnalysisId++;

    if (activeCancelToken) {
        try {
            activeCancelToken.cancel();
        } catch (err) {
            console.warn("[CDP Engine v2] Error during cancel token abort:", err);
        }
        activeCancelToken = null;
    }

    activeAnalysisPromise = null;
    currentAnalysisState = {
        analysisId: null,
        status: 'idle',
        url: null,
        progress: null,
        result: null,
        error: null,
        startedAt: null,
        updatedAt: new Date().toISOString()
    };

    // Purge session storage keys
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            await chrome.storage.session.remove(LEGACY_STORAGE_KEYS).catch(() => {});
        }
    } catch (e) {}

    // Purge local storage analysis keys if any legacy ones exist
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(LEGACY_STORAGE_KEYS).catch(() => {});
        }
    } catch (e) {}

    // Purge sync storage analysis keys if any legacy ones exist
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            await chrome.storage.sync.remove(LEGACY_STORAGE_KEYS).catch(() => {});
        }
    } catch (e) {}

    // Notify any open views that state has been cleared
    try {
        chrome.runtime.sendMessage({ action: 'ANALYSIS_STATE_CLEARED' }).catch(() => {});
    } catch (e) {}
}

/**
 * Starts a strictly tracked analysis session with generation isolation.
 * Automatically invalidates and safely cleans up any previous or pending analysis.
 */
export async function startTrackedAnalysis(options) {
    const rawUrl = options?.url ? String(options.url).trim() : '';
    if (!rawUrl) {
        return {
            success: false,
            error: "Please enter a valid website URL."
        };
    }

    // Step 4.1: Validate target URL using the URL parser
    let normalizedUrl;
    try {
        let candidate = rawUrl;
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
            if (!/^https?:\/\//i.test(candidate)) {
                throw new Error("Only HTTP and HTTPS URLs are supported.");
            }
        } else {
            candidate = 'https://' + candidate;
        }
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error("Only HTTP and HTTPS URLs are supported.");
        }
        if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
            throw new Error("Please enter a valid website domain.");
        }
        normalizedUrl = parsed.href;
    } catch (err) {
        return {
            success: false,
            error: err.message || "Please enter a valid website URL (e.g. https://example.com)."
        };
    }

    // Invalidate and cancel previous analysis before starting a new one
    if (activeCancelToken || activeAnalysisPromise) {
        console.warn("[CDP Engine v2] Cancelling pending analysis to start fresh run.");
        await clearAnalysisState();
    } else {
        // Clear previous analysis results so this run starts completely fresh
        await clearAnalysisState();
    }

    // Step 4.2: Create a unique analysis ID and generation token
    const thisRunGeneration = ++currentAnalysisId;
    const thisAnalysisId = options?.analysisId || (`analysis_${Date.now()}_${thisRunGeneration}_${Math.random().toString(36).slice(2, 7)}`);
    const cancelToken = {
        isCancelled: false,
        tabId: null,
        onCancel: null,
        cancel() {
            if (this.isCancelled) return;
            this.isCancelled = true;
            if (typeof this.onCancel === 'function') {
                try {
                    this.onCancel();
                } catch (err) {}
            }
            if (this.tabId) {
                const tid = this.tabId;
                this.tabId = null;
                chrome.debugger.detach({ tabId: tid }).catch(() => {});
                chrome.tabs.remove(tid).catch(() => {});
            }
        }
    };
    activeCancelToken = cancelToken;

    const startedAt = new Date().toISOString();
    currentAnalysisState = {
        analysisId: thisAnalysisId,
        status: 'running',
        url: normalizedUrl,
        progress: 'Validating URL...',
        result: null,
        error: null,
        startedAt,
        updatedAt: startedAt
    };

    // Record running state in session storage in case the worker idles
    try {
        if (chrome.storage && chrome.storage.session) {
            await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: currentAnalysisState }).catch(() => {});
        }
    } catch (e) {}

    const notifyProgress = (stepMessage) => {
        if (currentAnalysisId !== thisRunGeneration || cancelToken.isCancelled) return;
        currentAnalysisState = {
            ...currentAnalysisState,
            status: 'running',
            progress: stepMessage,
            updatedAt: new Date().toISOString()
        };
        try {
            if (chrome.storage && chrome.storage.session) {
                chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: currentAnalysisState }).catch(() => {});
            }
        } catch (e) {}
        chrome.runtime.sendMessage({
            action: 'ANALYSIS_PROGRESS',
            analysisId: thisAnalysisId,
            step: stepMessage
        }).catch(() => {});
    };

    activeAnalysisPromise = executeCdpAnalysis(normalizedUrl, notifyProgress, cancelToken);

    try {
        const response = await activeAnalysisPromise;

        // Discard result if superseded or cancelled during execution
        if (currentAnalysisId !== thisRunGeneration || cancelToken.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: "Analysis was superseded or cancelled."
            };
        }

        if (response.success) {
            currentAnalysisState = {
                analysisId: thisAnalysisId,
                status: 'completed',
                progress: 'Analysis complete',
                result: response.data,
                error: null,
                startedAt,
                updatedAt: new Date().toISOString()
            };
        } else {
            currentAnalysisState = {
                analysisId: thisAnalysisId,
                status: response.cancelled ? 'cancelled' : 'failed',
                progress: null,
                result: null,
                error: sanitizeErrorMessage(response.error || (response.cancelled ? "Analysis was cancelled." : "Analysis failed.")),
                startedAt,
                updatedAt: new Date().toISOString()
            };
        }

        // Persist final state in session storage so reopening popup displays it
        try {
            if (chrome.storage && chrome.storage.session) {
                await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: currentAnalysisState }).catch(() => {});
            }
        } catch (e) {}

        chrome.runtime.sendMessage({
            action: 'ANALYSIS_STATE_UPDATED',
            analysisId: thisAnalysisId,
            state: currentAnalysisState
        }).catch(() => {});

        return { ...response, analysisId: thisAnalysisId };

    } catch (err) {
        if (currentAnalysisId !== thisRunGeneration || cancelToken.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: "Analysis was cancelled."
            };
        }

        currentAnalysisState = {
            analysisId: thisAnalysisId,
            status: 'failed',
            progress: null,
            result: null,
            error: sanitizeErrorMessage(err.message || "Analysis failed unexpectedly."),
            startedAt,
            updatedAt: new Date().toISOString()
        };

        try {
            if (chrome.storage && chrome.storage.session) {
                await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: currentAnalysisState }).catch(() => {});
            }
        } catch (e) {}

        return {
            success: false,
            error: currentAnalysisState.error,
            analysisId: thisAnalysisId
        };

    } finally {
        if (currentAnalysisId === thisRunGeneration || activeCancelToken === cancelToken) {
            activeAnalysisPromise = null;
            activeCancelToken = null;
        }
    }
}

/**
 * Returns the currently running analysis state, or null if idle.
 * Preserves completed results for popup reopens, and marks service-worker suspended runs failed.
 */
export async function getStoredAnalysisState() {
    // 1. In-memory check
    if (currentAnalysisState && currentAnalysisState.status !== 'idle') {
        if (currentAnalysisState.status === 'running') {
            if (!activeAnalysisPromise) {
                const failedState = {
                    ...currentAnalysisState,
                    status: 'failed',
                    error: "Analysis was interrupted by service worker suspension. Please try again.",
                    updatedAt: new Date().toISOString()
                };
                currentAnalysisState = failedState;
                try {
                    if (chrome.storage && chrome.storage.session) {
                        await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: failedState }).catch(() => {});
                    }
                } catch (e) {}
                return currentAnalysisState;
            }

            const elapsed = Date.now() - new Date(currentAnalysisState.startedAt).getTime();
            if (elapsed > 15000) {
                console.warn("[CDP Engine v2] Running analysis exceeded 15s timeout ceiling. Resetting.");
                await clearAnalysisState();
                return null;
            }
            return currentAnalysisState;
        }
        return currentAnalysisState;
    }

    // 2. Storage recovery check (when in-memory state is idle or uninitialized after service worker suspension / restart)
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            const stored = await chrome.storage.session.get(ANALYSIS_STATE_KEY).catch(() => ({}));
            const state = stored[ANALYSIS_STATE_KEY] || null;
            if (state) {
                if (state.status === 'idle') {
                    return null;
                }
                if (state.status === 'running') {
                    // Service worker restarted while analysis was running: in-memory promise is gone
                    if (!activeAnalysisPromise) {
                        console.warn("[CDP Engine v2] Service worker restarted while analysis was running. Marking failed.");
                        const failedState = {
                            ...state,
                            status: 'failed',
                            error: "Analysis was interrupted by service worker suspension. Please try again.",
                            updatedAt: new Date().toISOString()
                        };
                        currentAnalysisState = failedState;
                        await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: failedState }).catch(() => {});
                        return currentAnalysisState;
                    }
                    const elapsed = Date.now() - new Date(state.startedAt).getTime();
                    if (elapsed > 15000) {
                        await clearAnalysisState();
                        return null;
                    }
                    currentAnalysisState = state;
                    return currentAnalysisState;
                }
                currentAnalysisState = state;
                return currentAnalysisState;
            }
        }
    } catch (e) {}

    return null;
}
