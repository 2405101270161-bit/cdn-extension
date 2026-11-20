import { executeCdpAnalysis, sanitizeErrorMessage } from './modules/cdp.js';
export { sanitizeErrorMessage };

const STORAGE_CLEANUP_KEYS = [
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

chrome.runtime.onInstalled.addListener(() => {
    clearAnalysisState().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
    clearAnalysisState().catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_ANALYSIS') {
        startTrackedAnalysis(request)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, error: err.message || "Failed to start analysis." }));
        return true;
    }
    if (request.action === 'GET_ANALYSIS_STATE') {
        getStoredAnalysisState()
            .then(state => sendResponse({ state }))
            .catch(err => sendResponse({ state: { status: 'idle' }, error: err.message }));
        return true;
    }
    if (request.action === 'CLEAR_ANALYSIS_STATE') {
        clearAnalysisState(true)
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});

export async function clearAnalysisState(notify = true) {
    currentAnalysisId++;

    if (activeCancelToken) {
        try {
            activeCancelToken.cancel();
        } catch (err) {}
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

    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            await chrome.storage.session.remove(STORAGE_CLEANUP_KEYS).catch(() => {});
        }
    } catch (e) {}

    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(STORAGE_CLEANUP_KEYS).catch(() => {});
        }
    } catch (e) {}

    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            await chrome.storage.sync.remove(STORAGE_CLEANUP_KEYS).catch(() => {});
        }
    } catch (e) {}

    if (notify) {
        try {
            chrome.runtime.sendMessage({ action: 'ANALYSIS_STATE_CLEARED' }).catch(() => {});
        } catch (e) {}
    }
}

export async function startTrackedAnalysis(options) {
    const rawUrl = options?.url ? String(options.url).trim() : '';
    if (!rawUrl) {
        return {
            success: false,
            error: "Please enter a valid website URL."
        };
    }

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

    await clearAnalysisState(false);

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
                try { this.onCancel(); } catch (err) {}
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

    const notifyProgress = (stepMessage) => {
        if (currentAnalysisId !== thisRunGeneration || cancelToken.isCancelled) return;
        currentAnalysisState = {
            ...currentAnalysisState,
            status: 'running',
            progress: stepMessage,
            updatedAt: new Date().toISOString()
        };
        chrome.runtime.sendMessage({
            action: 'ANALYSIS_PROGRESS',
            analysisId: thisAnalysisId,
            step: stepMessage
        }).catch(() => {});
    };

    activeAnalysisPromise = executeCdpAnalysis(normalizedUrl, notifyProgress, cancelToken);

    try {
        const response = await activeAnalysisPromise;

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
                status: 'idle',
                progress: null,
                result: null,
                error: null,
                startedAt: null,
                updatedAt: new Date().toISOString()
            };

            chrome.runtime.sendMessage({
                action: 'ANALYSIS_STATE_UPDATED',
                analysisId: thisAnalysisId,
                state: {
                    status: 'completed',
                    result: response.data
                }
            }).catch(() => {});

            return { ...response, analysisId: thisAnalysisId };
        } else {
            const errText = sanitizeErrorMessage(response.error || (response.cancelled ? "Analysis was cancelled." : "Analysis failed."));
            currentAnalysisState = {
                analysisId: thisAnalysisId,
                status: 'idle',
                progress: null,
                result: null,
                error: errText,
                startedAt: null,
                updatedAt: new Date().toISOString()
            };

            chrome.runtime.sendMessage({
                action: 'ANALYSIS_STATE_UPDATED',
                analysisId: thisAnalysisId,
                state: {
                    status: response.cancelled ? 'cancelled' : 'failed',
                    error: errText
                }
            }).catch(() => {});

            return { ...response, analysisId: thisAnalysisId };
        }

    } catch (err) {
        if (currentAnalysisId !== thisRunGeneration || cancelToken.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: "Analysis was cancelled."
            };
        }

        const errText = sanitizeErrorMessage(err.message || "Analysis failed unexpectedly.");
        currentAnalysisState = {
            analysisId: thisAnalysisId,
            status: 'idle',
            progress: null,
            result: null,
            error: errText,
            startedAt: null,
            updatedAt: new Date().toISOString()
        };

        chrome.runtime.sendMessage({
            action: 'ANALYSIS_STATE_UPDATED',
            analysisId: thisAnalysisId,
            state: {
                status: 'failed',
                error: errText
            }
        }).catch(() => {});

        return {
            success: false,
            error: errText,
            analysisId: thisAnalysisId
        };

    } finally {
        if (currentAnalysisId === thisRunGeneration || activeCancelToken === cancelToken) {
            activeAnalysisPromise = null;
            activeCancelToken = null;
        }
    }
}

export async function getStoredAnalysisState() {
    if (currentAnalysisState && currentAnalysisState.status === 'running') {
        if (!activeAnalysisPromise) {
            currentAnalysisState = {
                ...currentAnalysisState,
                status: 'failed',
                error: "Analysis was interrupted by service worker suspension. Please try again.",
                updatedAt: new Date().toISOString()
            };
            return currentAnalysisState;
        }

        const elapsed = Date.now() - new Date(currentAnalysisState.startedAt).getTime();
        if (elapsed > 30000) {
            await clearAnalysisState();
            return null;
        }
        return currentAnalysisState;
    }

    return null;
}
