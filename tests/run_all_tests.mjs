/**
 * Unified Test Runner for CDN Analyzer Pro
 * Executes all automated regression test suites across CDN detection,
 * edge identification, network timing, cache analysis, lifecycle, and integration.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const suites = [
    { name: "1. CDN Provider Detection", file: "test_cdn_detection.mjs" },
    { name: "2. Edge-Server Evidence & PoP", file: "test_edge_evidence.mjs" },
    { name: "3. Network Timing Calculations", file: "test_network_timing.mjs" },
    { name: "4. Cache Analysis & States", file: "test_cache_analysis.mjs" },
    { name: "5. Analysis Lifecycle & Isolation", file: "test_lifecycle.mjs" },
    { name: "6. End-to-End Pipeline Integration", file: "test_integration.mjs" },
    { name: "7. Metrics & Accounting Verification", file: "test_goal3_metrics.mjs" },
    { name: "8. Reliability & Error Handling", file: "test_reliability.mjs" }
];

console.log("==================================================================");
console.log("CDN ANALYZER PRO — AUTOMATED REGRESSION TEST SUITE RUNNER");
console.log("==================================================================");

let allPassed = true;
const summary = [];

for (const suite of suites) {
    const fullPath = path.join(__dirname, suite.file);
    console.log(`\n>>> Running Suite: ${suite.name} (${suite.file})`);

    const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, [fullPath], {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            resolve({ suite: suite.name, code });
        });
    });

    if (result.code !== 0) {
        allPassed = false;
        summary.push({ suite: suite.name, status: "FAILED", code: result.code });
    } else {
        summary.push({ suite: suite.name, status: "PASSED", code: 0 });
    }
}

console.log("\n==================================================================");
console.log("FINAL TEST EXECUTION SUMMARY");
console.log("==================================================================");
for (const s of summary) {
    const mark = s.status === "PASSED" ? "✓ PASS" : "✗ FAIL";
    console.log(`${mark} : ${s.suite}`);
}
console.log("==================================================================");

if (allPassed) {
    console.log("ALL 8 TEST SUITES (94 DETERMINISTIC TESTS) PASSED SUCCESSFULLY!");
    process.exit(0);
} else {
    console.error("SOME TEST SUITES ENCOUNTERED FAILURES!");
    process.exit(1);
}
