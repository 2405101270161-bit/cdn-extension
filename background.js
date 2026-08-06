/**
 * CDN Analyzer Pro v2 - Core Engine (Service Worker Orchestrator)
 * Single-pass CDP Background Tab Analysis Engine.
 */

import { executeCdpAnalysis } from './modules/cdp.js';

const ANALYSIS_STATE_KEY = 'cdnAnalyzerAnalysisState';
let activeAnalysisPromise = null;
let currentAnalysisState = null;

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

async function clearAnalysisState() {
    activeAnalysisPromise = null;
    currentAnalysisState = null;
    await chrome.storage.session.remove(ANALYSIS_STATE_KEY).catch(() => {});
}

async function startTrackedAnalysis(options) {
    if (activeAnalysisPromise && currentAnalysisState && currentAnalysisState.startedAt) {
        const elapsed = Date.now() - new Date(currentAnalysisState.startedAt).getTime();
        if (elapsed > 12000) {
            console.warn("[CDP Engine v2] Resetting stale analysis promise after 12s timeout.");
            activeAnalysisPromise = null;
        }
    }

    if (activeAnalysisPromise) return activeAnalysisPromise;

    const startedAt = new Date().toISOString();
    await updateAnalysisState({
        status: 'running',
        url: options.url,
        progress: 'Validating URL...',
        result: null,
        error: null,
        startedAt
    });

    const notifyProgress = (stepMessage) => {
        updateAnalysisState({ status: 'running', progress: stepMessage }).catch(() => {});
        chrome.runtime.sendMessage({ action: 'ANALYSIS_PROGRESS', step: stepMessage }).catch(() => {});
    };

    activeAnalysisPromise = executeCdpAnalysis(options.url, notifyProgress);

    try {
        const response = await activeAnalysisPromise;
        await updateAnalysisState(response.success ? {
            status: 'completed',
            progress: 'Analysis complete',
            result: response.data,
            error: null
        } : {
            status: 'error',
            progress: null,
            result: null,
            error: response.error || "Analysis failed."
        });
        return response;
    } finally {
        activeAnalysisPromise = null;
    }
}

async function getStoredAnalysisState() {
    if (currentAnalysisState) return currentAnalysisState;
    const stored = await chrome.storage.session.get(ANALYSIS_STATE_KEY);
    currentAnalysisState = stored[ANALYSIS_STATE_KEY] || null;
    if (currentAnalysisState && currentAnalysisState.status === 'running' && !activeAnalysisPromise) {
        const elapsed = Date.now() - new Date(currentAnalysisState.updatedAt || currentAnalysisState.startedAt).getTime();
        if (elapsed > 10000) {
            currentAnalysisState.status = 'error';
            currentAnalysisState.error = 'Analysis timed out or background worker restarted.';
            await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: currentAnalysisState });
        }
    }
    return currentAnalysisState;
}

async function updateAnalysisState(update) {
    const previous = await getStoredAnalysisState();
    currentAnalysisState = {
        ...(previous || {}),
        ...update,
        updatedAt: new Date().toISOString()
    };
    await chrome.storage.session.set({ [ANALYSIS_STATE_KEY]: currentAnalysisState });
    chrome.runtime.sendMessage({
        action: 'ANALYSIS_STATE_UPDATED',
        state: currentAnalysisState
    }).catch(() => {});
}
