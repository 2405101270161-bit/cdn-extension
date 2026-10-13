/**
 * CDN Analyzer Pro v2 - Core Engine (Service Worker Orchestrator)
 * Single-pass CDP Background Tab Analysis Engine with complete reset & isolation.
 */

import { executeCdpAnalysis } from './modules/cdp.js';

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
let currentAnalysisState = null;
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
    currentAnalysisState = null;

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

    // Step 4.2: Create a unique analysis ID
    const thisAnalysisId = options?.analysisId || (`analysis_${Date.now()}_${++currentAnalysisId}_${Math.random().toString(36).slice(2, 7)}`);
    const cancelToken = {
        isCancelled: false,
        tabId: null,
        onCancel: null,
        cancel() {
            this.isCancelled = true;
            if (typeof this.onCancel === 'function') {
                try {
                    this.onCancel();
                } catch (err) {}
            }
            if (this.tabId) {
                chrome.debugger.detach({ tabId: this.tabId }).catch(() => {});
                chrome.tabs.remove(this.tabId).catch(() => {});
                this.tabId = null;
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
        if (currentAnalysisId !== thisAnalysisId || cancelToken.isCancelled) return;
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
        if (currentAnalysisId !== thisAnalysisId || cancelToken.isCancelled) {
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
                status: 'error',
                progress: null,
                result: null,
                error: response.error || "Analysis failed.",
                startedAt,
                updatedAt: new Date().toISOString()
            };
        }

        // Clean session storage so subsequent extension openings start completely fresh
        try {
            if (chrome.storage && chrome.storage.session) {
                await chrome.storage.session.remove(ANALYSIS_STATE_KEY).catch(() => {});
            }
        } catch (e) {}

        chrome.runtime.sendMessage({
            action: 'ANALYSIS_STATE_UPDATED',
            analysisId: thisAnalysisId,
            state: currentAnalysisState
        }).catch(() => {});

        return { ...response, analysisId: thisAnalysisId };

    } catch (err) {
        if (currentAnalysisId !== thisAnalysisId || cancelToken.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: "Analysis was cancelled."
            };
        }

        currentAnalysisState = {
            analysisId: thisAnalysisId,
            status: 'error',
            progress: null,
            result: null,
            error: err.message || "Analysis failed unexpectedly.",
            startedAt,
            updatedAt: new Date().toISOString()
        };

        try {
            if (chrome.storage && chrome.storage.session) {
                await chrome.storage.session.remove(ANALYSIS_STATE_KEY).catch(() => {});
            }
        } catch (e) {}

        return {
            success: false,
            error: err.message || "Analysis failed.",
            analysisId: thisAnalysisId
        };

    } finally {
        if (currentAnalysisId === thisAnalysisId || activeCancelToken === cancelToken) {
            activeAnalysisPromise = null;
            activeCancelToken = null;
            currentAnalysisState = null;
        }
    }
}

/**
 * Returns the currently running analysis state, or null if idle/completed.
 * Stale or timed-out analyses (>15s) are automatically cleared.
 */
export async function getStoredAnalysisState() {
    if (currentAnalysisState && currentAnalysisState.status === 'running') {
        const elapsed = Date.now() - new Date(currentAnalysisState.startedAt).getTime();
        if (elapsed > 15000) {
            console.warn("[CDP Engine v2] Running analysis exceeded 15s timeout ceiling. Resetting.");
            await clearAnalysisState();
            return null;
        }
        return currentAnalysisState;
    }

    try {
        if (chrome.storage && chrome.storage.session) {
            const stored = await chrome.storage.session.get(ANALYSIS_STATE_KEY).catch(() => ({}));
            const state = stored[ANALYSIS_STATE_KEY] || null;
            if (state && state.status === 'running') {
                const elapsed = Date.now() - new Date(state.startedAt).getTime();
                if (elapsed > 15000) {
                    await clearAnalysisState();
                    return null;
                }
                currentAnalysisState = state;
                return currentAnalysisState;
            }
        }
    } catch (e) {}

    // Completed or error states from past runs are never restored
    return null;
}
