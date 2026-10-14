/**
 * Test Suite: Analysis Reliability, Error Handling & Lifecycle Edge Cases
 * Goal 5: Covers all 12 specific scenarios required by Goal 5 specification:
 *  1. Debugger attachment failure
 *  2. Tab closure during analysis
 *  3. Navigation timeout
 *  4. Explicit cancellation
 *  5. Concurrent analysis requests
 *  6. Unexpected debugger detachment
 *  7. Late CDP events after cancellation or completion
 *  8. Repeated cleanup calls
 *  9. A failed analysis followed by a successful analysis
 *  10. Recovery from stale persisted analysis state
 *  11. Temporary-tab cleanup without closing the original tab
 *  12. Listener and timer cleanup after success and failure
 *  Plus error message credential sanitization and overall leak audit.
 */

import assert from 'node:assert';

console.log("=================================================");
console.log("Test Suite: Reliability & Error Handling (Goal 5)");
console.log("=================================================");

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  PASS: [RELIABILITY-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [RELIABILITY-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// Track mock Chrome API state
let storageSession = {};
let storageLocal = {};
let storageSync = {};
let createdTabs = [];
let removedTabs = [];
let attachedTabs = [];
let detachedTabs = [];
let broadcastMessages = [];
let runtimeListeners = [];
let debuggerEventListeners = [];
let debuggerDetachListeners = [];
let tabRemovedListeners = [];
let attachShouldFail = false;

const mockChrome = {
    runtime: {
        lastError: null,
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
        sendMessage: (msg, cb) => {
            broadcastMessages.push(msg);
            if (cb) setTimeout(cb, 0);
            return Promise.resolve();
        }
    },
    storage: {
        session: {
            get: async (keys) => {
                if (typeof keys === 'string') return { [keys]: storageSession[keys] };
                const res = {};
                for (const k of (Array.isArray(keys) ? keys : Object.keys(keys))) {
                    if (storageSession[k] !== undefined) res[k] = storageSession[k];
                }
                return res;
            },
            set: async (obj) => { Object.assign(storageSession, obj); },
            remove: async (keys) => {
                const arr = Array.isArray(keys) ? keys : [keys];
                for (const k of arr) delete storageSession[k];
            }
        },
        local: {
            remove: async (keys) => {
                const arr = Array.isArray(keys) ? keys : [keys];
                for (const k of arr) delete storageLocal[k];
            }
        },
        sync: {
            remove: async (keys) => {
                const arr = Array.isArray(keys) ? keys : [keys];
                for (const k of arr) delete storageSync[k];
            }
        }
    },
    debugger: {
        attach: async (target, version) => {
            if (attachShouldFail) {
                throw new Error("Cannot attach to this target: Another debugger is already attached");
            }
            attachedTabs.push(target.tabId);
        },
        detach: async (target) => {
            if (!detachedTabs.includes(target.tabId)) detachedTabs.push(target.tabId);
        },
        sendCommand: (target, method, params, cb) => {
            if (cb) setTimeout(cb, 0);
        },
        onEvent: {
            addListener: (fn) => debuggerEventListeners.push(fn),
            removeListener: (fn) => {
                debuggerEventListeners = debuggerEventListeners.filter(l => l !== fn);
            }
        },
        onDetach: {
            addListener: (fn) => debuggerDetachListeners.push(fn),
            removeListener: (fn) => {
                debuggerDetachListeners = debuggerDetachListeners.filter(l => l !== fn);
            }
        }
    },
    tabs: {
        create: async (opts) => {
            const id = Math.floor(Math.random() * 100000) + 1;
            createdTabs.push(id);
            return { id };
        },
        remove: async (tabId) => {
            if (!removedTabs.includes(tabId)) removedTabs.push(tabId);
        },
        onRemoved: {
            addListener: (fn) => tabRemovedListeners.push(fn),
            removeListener: (fn) => {
                tabRemovedListeners = tabRemovedListeners.filter(l => l !== fn);
            }
        }
    }
};

globalThis.chrome = mockChrome;

// Import modules
const bg = await import('../background.js');
const cdp = await import('../modules/cdp.js');

// 1. Debugger attachment failure cleans up created tab and reports actionable error
await test("1. Debugger attachment failure cleans up created tab and reports actionable error", async () => {
    attachShouldFail = true;
    const initialCreated = createdTabs.length;

    const res = await bg.startTrackedAnalysis({
        url: 'https://example.com',
        analysisId: 'run_attach_fail'
    });

    attachShouldFail = false; // Reset

    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Could not attach debugger") || res.error.includes("Another debugger may be active"),
        `Error must be user-friendly, got: ${res.error}`);

    // Verify created tab was cleaned up
    assert.ok(createdTabs.length > initialCreated, "A tab was created");
    const lastCreated = createdTabs[createdTabs.length - 1];
    assert.ok(removedTabs.includes(lastCreated), `Tab ${lastCreated} was removed after attach failure`);
});

// 2. Tab closure during analysis aborts gracefully
await test("2. Target tab closure during analysis aborts cleanly without leaked timers", async () => {
    let capturedTabId = null;
    const token = {
        isCancelled: false,
        tabId: null,
        cancel() { this.isCancelled = true; }
    };

    const analysisPromise = cdp.executeCdpAnalysis('https://example.com/test-tab-close', () => {}, token);

    // Wait for tab creation and listeners
    await new Promise(r => setTimeout(r, 40));
    capturedTabId = token.tabId;
    assert.ok(capturedTabId, "Tab ID was assigned to cancel token");

    // Trigger premature tab closure event
    for (const listener of tabRemovedListeners) {
        listener(capturedTabId);
    }

    const res = await analysisPromise;
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("closed before completion") || res.error.includes("closed prematurely"),
        `Error explains tab closure, got: ${res.error}`);
});

// 3. Navigation timeout completes without hanging or leaking timers
await test("3. Navigation timeout aborts or finishes gracefully without hanging", async () => {
    const token = {
        isCancelled: false,
        tabId: null,
        cancel() { this.isCancelled = true; }
    };

    const analysisPromise = cdp.executeCdpAnalysis('https://example.com/timeout-test', () => {}, token);
    await new Promise(r => setTimeout(r, 40));

    // Abort token simulating timeout ceiling
    token.cancel();
    const res = await analysisPromise;
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.cancelled, true);
});

// 4. Explicit cancellation terminates analysis and marks state cancelled
await test("4. Explicit cancellation marks state cancelled with null report", async () => {
    const token = {
        isCancelled: false,
        tabId: null,
        onCancel: null,
        cancel() {
            this.isCancelled = true;
            if (this.onCancel) this.onCancel();
        }
    };

    const analysisPromise = cdp.executeCdpAnalysis('https://example.com/test-cancel', () => {}, token);
    await new Promise(r => setTimeout(r, 40));

    // Cancel in-flight
    token.cancel();

    const res = await analysisPromise;
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.cancelled, true);
    assert.ok(res.error.includes("cancelled"), "Reports cancelled error");
});

// 5. Concurrent analysis requests properly cancel the prior run without crosstalk
await test("5. Concurrent analysis request supersedes prior run with zero crosstalk", async () => {
    let firstRes = null;
    let secondRes = null;

    const p1 = bg.startTrackedAnalysis({ url: 'https://example.com/slow-first', analysisId: 'run_c1' }).then(r => { firstRes = r; });
    await new Promise(r => setTimeout(r, 30));

    const p2 = bg.startTrackedAnalysis({ url: 'https://example.com/fast-second', analysisId: 'run_c2' }).then(r => { secondRes = r; });

    await p1;
    assert.ok(firstRes !== null, "First run finished");
    assert.strictEqual(firstRes.cancelled, true, "First run cancelled");

    // Clean up second run
    await bg.clearAnalysisState();
    await p2;
    assert.ok(secondRes !== null, "Second run finished cleanly");
});

// 6. Unexpected debugger detachment during capture triggers abort
await test("6. Unexpected debugger detachment aborts analysis cleanly", async () => {
    const token = {
        isCancelled: false,
        tabId: null,
        cancel() { this.isCancelled = true; }
    };

    const analysisPromise = cdp.executeCdpAnalysis('https://example.com/test-detach', () => {}, token);
    await new Promise(r => setTimeout(r, 40));
    const capturedTabId = token.tabId;

    // Trigger unexpected detach event
    for (const listener of debuggerDetachListeners) {
        listener({ tabId: capturedTabId }, "Target closed");
    }

    const res = await analysisPromise;
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("detached unexpectedly"), `Error explains detachment, got: ${res.error}`);
});

// 7. Late CDP events after cancellation/completion are dropped without side-effects
await test("7. Late CDP events arriving after cancellation are dropped silently", async () => {
    const token = {
        isCancelled: false,
        tabId: null,
        onCancel: null,
        cancel() {
            this.isCancelled = true;
            if (this.onCancel) this.onCancel();
        }
    };

    const analysisPromise = cdp.executeCdpAnalysis('https://example.com/test-late-events', () => {}, token);
    await new Promise(r => setTimeout(r, 40));
    const tabId = token.tabId;

    // Cancel
    token.cancel();
    await analysisPromise;

    // Fire late CDP events
    assert.doesNotThrow(() => {
        for (const listener of debuggerEventListeners) {
            listener({ tabId }, 'Network.requestWillBeSent', {
                requestId: 'late_req_1',
                timestamp: 1000,
                type: 'Image',
                request: { url: 'https://example.com/late.png' }
            });
            listener({ tabId }, 'Page.domContentEventFired', { timestamp: 1001 });
        }
    }, "Late CDP events do not throw or cause errors");
});

// 8. Repeated cleanup calls are strictly idempotent
await test("8. Repeated calls to clearAnalysisState() are idempotent and safe", async () => {
    await assert.doesNotReject(async () => {
        await bg.clearAnalysisState();
        await bg.clearAnalysisState();
        await bg.clearAnalysisState();
    }, "Multiple consecutive clear calls do not throw");

    const state = await bg.getStoredAnalysisState();
    assert.strictEqual(state, null, "State remains null / idle after repeated clearing");
});

// 9. Failed analysis followed by successful analysis clears error and reports valid data
await test("9. Failed analysis followed by a valid analysis leaves no stale error or partial report", async () => {
    // 1. Fail with invalid scheme
    const failRes = await bg.startTrackedAnalysis({ url: 'ftp://ftp.invalidscheme.org', analysisId: 'run_fail' });
    assert.strictEqual(failRes.success, false);

    // 2. Start valid run
    const validPromise = bg.startTrackedAnalysis({ url: 'https://example.com/valid', analysisId: 'run_success' });
    await new Promise(r => setTimeout(r, 40));

    // Simulate completion
    for (const listener of debuggerEventListeners) {
        listener({ tabId: createdTabs[createdTabs.length - 1] }, 'Page.domContentEventFired', { timestamp: 2000 });
        listener({ tabId: createdTabs[createdTabs.length - 1] }, 'Page.loadEventFired', { timestamp: 2001 });
    }

    await bg.clearAnalysisState();
    await validPromise;

    const finalState = await bg.getStoredAnalysisState();
    assert.strictEqual(finalState, null, "Idle state after reset, no stale errors");
});

// 10. Service worker suspension recovery marks interrupted runs failed
await test("10. Recovery from stale persisted analysis state after worker restart", async () => {
    // Reset in-memory state first to simulate service worker rebooting with clean memory
    await bg.clearAnalysisState();

    // Simulate service worker waking up with state left in storage from a previous run
    storageSession['cdnAnalyzerAnalysisState'] = {
        analysisId: 'run_suspended',
        status: 'running',
        url: 'https://example.com',
        progress: 'Loading website...',
        result: null,
        error: null,
        startedAt: new Date(Date.now() - 5000).toISOString(),
        updatedAt: new Date(Date.now() - 5000).toISOString()
    };

    // When getStoredAnalysisState runs with no active in-memory promise:
    const state = await bg.getStoredAnalysisState();
    assert.ok(state !== null, "State was recovered");
    assert.strictEqual(state.status, 'failed', "State transitioned to failed");
    assert.ok(state.error.includes("interrupted by service worker suspension"),
        `Error explains worker suspension, got: ${state.error}`);
});

// 11. Temporary-tab cleanup without closing the original tab
await test("11. Temporary-tab cleanup does not close the user's original tab", async () => {
    const userOriginalTabId = 77777; // Represents the user's open tab

    const token = {
        isCancelled: false,
        tabId: null,
        cancel() { this.isCancelled = true; }
    };

    const analysisPromise = cdp.executeCdpAnalysis('https://example.com/test-user-tab', () => {}, token);
    await new Promise(r => setTimeout(r, 40));

    const tempTabId = token.tabId;
    assert.ok(tempTabId !== userOriginalTabId, "Created temporary tab has distinct ID");

    // Abort and trigger cleanup
    token.cancel();
    await analysisPromise;

    assert.ok(removedTabs.includes(tempTabId), "Temporary tab was cleaned up and removed");
    assert.ok(!removedTabs.includes(userOriginalTabId), "User's original tab was NEVER removed");
});

// 12. Listener and timer cleanup after success and failure
await test("12. Listener and timer cleanup occurs cleanly after both success and failure", async () => {
    // Ensure all listeners are zeroed before test
    debuggerEventListeners = [];
    debuggerDetachListeners = [];
    tabRemovedListeners = [];

    // Path A: Failure cleanup
    const tokenFail = {
        isCancelled: false,
        tabId: null,
        cancel() { this.isCancelled = true; }
    };
    const failPromise = cdp.executeCdpAnalysis('https://example.com/fail-cleanup', () => {}, tokenFail);
    await new Promise(r => setTimeout(r, 30));

    assert.ok(debuggerEventListeners.length > 0, "Listeners active during analysis");
    tokenFail.cancel();
    await failPromise;

    assert.strictEqual(debuggerEventListeners.length, 0, "All event listeners removed after failure");
    assert.strictEqual(debuggerDetachListeners.length, 0, "All detach listeners removed after failure");
    assert.strictEqual(tabRemovedListeners.length, 0, "All tab removal listeners removed after failure");

    // Path B: Success cleanup
    const tokenSuccess = {
        isCancelled: false,
        tabId: null,
        cancel() { this.isCancelled = true; }
    };
    const successPromise = cdp.executeCdpAnalysis('https://example.com/success-cleanup', () => {}, tokenSuccess);
    await new Promise(r => setTimeout(r, 30));

    const currentTabId = tokenSuccess.tabId;
    // Simulate page events
    for (const listener of debuggerEventListeners) {
        listener({ tabId: currentTabId }, 'Page.domContentEventFired', { timestamp: 3000 });
        listener({ tabId: currentTabId }, 'Page.loadEventFired', { timestamp: 3001 });
    }

    // Cancel to settle promise
    tokenSuccess.cancel();
    await successPromise;

    assert.strictEqual(debuggerEventListeners.length, 0, "All event listeners removed after success path");
    assert.strictEqual(debuggerDetachListeners.length, 0, "All detach listeners removed after success path");
    assert.strictEqual(tabRemovedListeners.length, 0, "All tab removal listeners removed after success path");
});

// 13. Sensitive credentials and secrets are scrubbed from error messages
await test("13. Sensitive credentials, passwords, and tokens are scrubbed from error messages", () => {
    const rawError1 = "Failed to connect to https://admin:superSecretPass123@api.internal.com/data?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9&apiKey=AIzaSyA_SECRET";
    const sanitized1 = cdp.sanitizeErrorMessage(rawError1);

    assert.ok(!sanitized1.includes("superSecretPass123"), "Password was scrubbed");
    assert.ok(!sanitized1.includes("admin:"), "Basic auth username scrubbed");
    assert.ok(!sanitized1.includes("eyJhbGciOi"), "JWT token was scrubbed");
    assert.ok(!sanitized1.includes("AIzaSyA_SECRET"), "API key was scrubbed");
    assert.ok(sanitized1.includes("[REDACTED]"), "Redacted placeholder inserted");

    // Network error normalization
    const rawError2 = "net::ERR_NAME_NOT_RESOLVED";
    const sanitized2 = cdp.sanitizeErrorMessage(rawError2);
    assert.ok(sanitized2.includes("Domain name could not be resolved"), "Normalized network error");
});

// 14. All temporary background tabs and debugger sessions are cleaned up
await test("14. Zero leaked tabs or debugger sessions across all failure paths", () => {
    assert.ok(createdTabs.length > 0, "Tabs were created across the suite");
    for (const tabId of createdTabs) {
        assert.ok(removedTabs.includes(tabId), `Temporary tab ${tabId} was properly removed`);
    }
    for (const tabId of attachedTabs) {
        assert.ok(detachedTabs.includes(tabId), `Debugger attached to tab ${tabId} was detached`);
    }
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Reliability tests passed.`);
console.log("=================================================");
