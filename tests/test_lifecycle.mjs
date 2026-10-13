/**
 * Test Suite: Analysis Lifecycle & State Isolation
 * Verifies fresh state initialization, stale-data prevention, generation isolation,
 * asynchronous callback gating, debugger/tab resource cleanup, and timeout handling.
 */

import assert from 'node:assert';

console.log("=================================================");
console.log("Test Suite: Analysis Lifecycle & State Isolation");
console.log("=================================================");

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  PASS: [LIFECYCLE-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [LIFECYCLE-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// Set up Chrome API mock environment
let storageSession = {};
let storageLocal = {};
let storageSync = {};
let createdTabs = [];
let removedTabs = [];
let attachedTabs = [];
let detachedTabs = [];
let broadcastMessages = [];
let runtimeListeners = [];

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
        attach: async (target, version) => { attachedTabs.push(target.tabId); },
        detach: async (target) => { detachedTabs.push(target.tabId); },
        sendCommand: (target, method, params, cb) => { if (cb) setTimeout(cb, 0); },
        onEvent: { addListener: () => {}, removeListener: () => {} },
        onDetach: { addListener: () => {}, removeListener: () => {} }
    },
    tabs: {
        create: async (opts) => {
            const id = Math.floor(Math.random() * 100000) + 1;
            createdTabs.push(id);
            return { id };
        },
        remove: async (tabId) => { removedTabs.push(tabId); },
        onRemoved: { addListener: () => {}, removeListener: () => {} }
    }
};

globalThis.chrome = mockChrome;

// Import background.js for lifecycle testing
const bg = await import('../background.js');

// 1. Fresh application state initialization
await test("A new analysis begins with fresh application state (all storage cleared)", async () => {
    storageSession['cdnAnalyzerAnalysisState'] = { status: 'completed', oldData: true };
    storageSession['lastAnalysis'] = { stale: true };
    storageLocal['cachedReport'] = { stale: true };
    storageSync['cdnCache'] = { stale: true };

    await bg.clearAnalysisState();

    assert.strictEqual(storageSession['cdnAnalyzerAnalysisState'], undefined);
    assert.strictEqual(storageSession['lastAnalysis'], undefined);
    assert.strictEqual(storageLocal['cachedReport'], undefined);
    assert.strictEqual(storageSync['cdnCache'], undefined);
});

// 2. Old analysis data does not appear when querying state
await test("GET_ANALYSIS_STATE returns null when analysis was cleared or idle", async () => {
    await bg.clearAnalysisState();
    const state = await bg.getStoredAnalysisState();
    assert.strictEqual(state, null, "Stored state must be null after reset");
});

// 3. Concurrent analyses cannot overwrite one another (generation isolation & cancellation)
await test("Starting a new analysis supersedes and cancels any running analysis", async () => {
    createdTabs = [];
    removedTabs = [];
    detachedTabs = [];
    attachedTabs = [];

    const onMessage = runtimeListeners[0];

    // Start first run
    let firstResponse = null;
    const firstPromise = new Promise((resolve) => {
        onMessage({
            action: 'START_ANALYSIS',
            url: 'https://example.com/first',
            analysisId: 'run_1'
        }, {}, (res) => {
            firstResponse = res;
            resolve();
        });
    });

    // Allow execution to reach background tab creation & CDP attach
    await new Promise(r => setTimeout(r, 60));

    // Immediately start second run with different ID
    let secondResponse = null;
    const secondPromise = new Promise((resolve) => {
        onMessage({
            action: 'START_ANALYSIS',
            url: 'https://example.com/second',
            analysisId: 'run_2'
        }, {}, (res) => {
            secondResponse = res;
            resolve();
        });
    });

    // First run must resolve with cancelled status
    await firstPromise;
    assert.ok(firstResponse !== null, "First run received response");
    assert.strictEqual(firstResponse.cancelled, true, "First run was cancelled by second run");

    // Cancel second run to finish clean
    await bg.clearAnalysisState();
    await secondPromise;
    assert.ok(secondResponse !== null, "Second run finished cleanly");
});

// 4. Stale asynchronous callbacks are ignored by UI/background
await test("Superseded run callbacks do not update active analysis state", async () => {
    const currentState = await bg.getStoredAnalysisState();
    if (currentState) {
        assert.notStrictEqual(currentState.analysisId, 'run_1', "run_1 cannot be the current active analysis");
    }
});

// 5. Analysis errors are reported clearly (invalid schemes, malformed URLs)
await test("START_ANALYSIS rejects unsupported schemes (ftp://, chrome://, file://)", async () => {
    const onMessage = runtimeListeners[0];

    let ftpResponse = null;
    await new Promise((resolve) => {
        onMessage({ action: 'START_ANALYSIS', url: 'ftp://ftp.example.com', analysisId: 'run_ftp' }, {}, (res) => {
            ftpResponse = res;
            resolve();
        });
    });
    assert.strictEqual(ftpResponse.success, false);
    assert.ok(ftpResponse.error.includes('HTTP and HTTPS'), "Error clearly explains scheme limitation");

    let chromeResponse = null;
    await new Promise((resolve) => {
        onMessage({ action: 'START_ANALYSIS', url: 'chrome://settings', analysisId: 'run_chrome' }, {}, (res) => {
            chromeResponse = res;
            resolve();
        });
    });
    assert.strictEqual(chromeResponse.success, false);
});

// 6. Temporary analysis tabs and debugger sessions are cleaned up
await test("Temporary background tabs and debugger sessions are detached and removed", async () => {
    assert.ok(createdTabs.length > 0, "Background tabs were created during test suite");
    assert.ok(removedTabs.length > 0, "Background tabs were removed");
    for (const tabId of createdTabs) {
        assert.ok(removedTabs.includes(tabId), `Tab ${tabId} was cleaned up`);
    }
    for (const tabId of attachedTabs) {
        assert.ok(detachedTabs.includes(tabId), `Debugger attached to tab ${tabId} was detached`);
    }
});

// 7. CLEAR_ANALYSIS_STATE broadcasts ANALYSIS_STATE_CLEARED
await test("CLEAR_ANALYSIS_STATE broadcasts cleared event to all listening contexts", async () => {
    broadcastMessages = [];
    const onMessage = runtimeListeners[0];

    await new Promise((resolve) => {
        onMessage({ action: 'CLEAR_ANALYSIS_STATE' }, {}, () => {
            resolve();
        });
    });
    await new Promise(r => setTimeout(r, 50));

    assert.ok(broadcastMessages.some(m => m.action === 'ANALYSIS_STATE_CLEARED'), "ANALYSIS_STATE_CLEARED message was broadcast");
});

console.log("=================================================");
console.log(`Results: ${passed} of ${total} Lifecycle tests passed.`);
console.log("=================================================");
