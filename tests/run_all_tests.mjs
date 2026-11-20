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
    { name: "7. Metrics and transfer accounting", file: "test_metrics.mjs" },
    { name: "8. Reliability & Error Handling", file: "test_reliability.mjs" },
    { name: "9. Report generation", file: "test_report.mjs" },
    { name: "10. Popup UI and layout", file: "test_popup_ui.mjs" },
    { name: "11. Evidence accuracy and false positives", file: "test_evidence_accuracy.mjs" }
];

let totalTests = 0;
let totalPassed = 0;

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
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
        child.stderr.on('data', (d) => { process.stderr.write(d); });

        child.on('close', (code) => {
            // Count from each suite's own "<passed> of <total>" summary line.
            const m = out.match(/(\d+) of (\d+)[^\n]*(?:passed|PASSED)/);
            if (m) {
                totalPassed += parseInt(m[1], 10);
                totalTests += parseInt(m[2], 10);
            }
            resolve({ suite: suite.name, code: m ? code : (code || 1) });
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
    console.log(`All ${suites.length} suites passed (${totalPassed} tests).`);
    process.exit(0);
} else {
    console.error(`Some tests failed: ${totalPassed} of ${totalTests} passed.`);
    process.exit(1);
}
