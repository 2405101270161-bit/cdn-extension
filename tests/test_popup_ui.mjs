import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', 'extension');

console.log("==================================================================");
console.log("TEST SUITE: Frontend UI/UX Refinement & Responsive Layout Audit");
console.log("==================================================================");

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  PASS: [UI-AUDIT-${total}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL: [UI-AUDIT-${total}] ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

const htmlContent = fs.readFileSync(path.join(rootDir, 'popup.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
const jsContent = fs.readFileSync(path.join(rootDir, 'popup.js'), 'utf8');

await test("1. Top toolbar has Copy and JSON buttons removed, Reset button kept", () => {

    const topbarMatch = htmlContent.match(/<header class="topbar"[^>]*>([\s\S]*?)<\/header>/);
    assert.ok(topbarMatch, "Header topbar exists");
    const topbarHtml = topbarMatch[1];

    assert.ok(!topbarHtml.includes('id="copyReportBtn"'), "Top copy button removed from popup.html");
    assert.ok(!topbarHtml.includes('id="exportJsonBtn"'), "Top JSON button removed from popup.html");
    assert.ok(topbarHtml.includes('id="refreshBtn"'), "Reset button preserved in popup.html topbar");
    assert.ok(topbarHtml.includes('class="topbar-brand"'), "Topbar brand preserved");
});

await test("2. popup.js removes unused listeners for deleted topbar controls", () => {
    assert.ok(!jsContent.includes("document.getElementById('copyReportBtn')"), "No copyReportBtn element lookup in popup.js");
    assert.ok(!jsContent.includes("document.getElementById('exportJsonBtn')"), "No exportJsonBtn element lookup in popup.js");
    assert.ok(!jsContent.includes("copyReportBtn.addEventListener"), "No copyReportBtn event listener");
    assert.ok(!jsContent.includes("exportJsonBtn.addEventListener"), "No exportJsonBtn event listener");
});

await test("3. Analysis Audit Report component is completely removed", () => {
    assert.ok(!jsContent.includes("footerCopyReportBtn"), "footerCopyReportBtn removed from popup.js");
    assert.ok(!jsContent.includes("footerExportJsonBtn"), "footerExportJsonBtn removed from popup.js");
    assert.ok(!jsContent.includes("function copyReport"), "copyReport function removed from popup.js");
    assert.ok(!jsContent.includes("function exportJson"), "exportJson function removed from popup.js");
    assert.ok(!jsContent.includes("report-card"), "report-card markup removed from popup.js");
    assert.ok(!cssContent.includes(".report-card {"), "report-card styles removed from styles.css");
});

await test("4. CSS enforces width: 100% and box-sizing: border-box on main containers", () => {
    assert.ok(cssContent.includes("box-sizing: border-box"), "Global box-sizing: border-box declared");

    const htmlRule = cssContent.match(/html\s*\{([^}]+)\}/);
    assert.ok(htmlRule, "html rule exists");
    assert.ok(htmlRule[1].includes("width: 100%"), "html has width: 100%");
    assert.ok(htmlRule[1].includes("box-sizing: border-box"), "html has box-sizing: border-box");

    const bodyRule = cssContent.match(/body\s*\{([^}]+)\}/);
    assert.ok(bodyRule, "body rule exists");
    assert.ok(bodyRule[1].includes("width: 100%"), "body has width: 100%");
    assert.ok(!bodyRule[1].includes("width: 400px;"), "body no longer has fixed rigid width: 400px");

    const appRule = cssContent.match(/\.app\s*\{([^}]+)\}/);
    assert.ok(appRule, ".app rule exists");
    assert.ok(appRule[1].includes("width: 100%"), ".app has width: 100%");
    assert.ok(appRule[1].includes("box-sizing: border-box"), ".app has box-sizing: border-box");

    const dashboardRule = cssContent.match(/\.dashboard\s*\{([^}]+)\}/);
    assert.ok(dashboardRule, ".dashboard rule exists");
    assert.ok(dashboardRule[1].includes("width: 100%"), ".dashboard has width: 100%");

    const cardRule = cssContent.match(/\.card\s*\{([^}]+)\}/);
    assert.ok(cardRule, ".card rule exists");
    assert.ok(cardRule[1].includes("width: 100%"), ".card has width: 100%");
});

await test("5. Restrictive max-width bottlenecks removed or expanded", () => {

    const heroTagline = cssContent.match(/\.hero-tagline\s*\{([^}]+)\}/);
    assert.ok(heroTagline, ".hero-tagline rule exists");
    assert.ok(!heroTagline[1].includes("max-width: 290px;"), "hero-tagline max-width relaxed from 290px");

    const rowValue = cssContent.match(/\.row-value\s*\{([^}]+)\}/);
    assert.ok(rowValue, ".row-value rule exists");
    assert.ok(!rowValue[1].includes("max-width: 55%;"), "row-value max-width expanded from 55%");
});

await test("6. Scrollbar is hidden cross-browser without using overflow-y: hidden", () => {
    assert.ok(cssContent.includes("scrollbar-width: none"), "scrollbar-width: none for Firefox & standards");
    assert.ok(cssContent.includes("-ms-overflow-style: none"), "-ms-overflow-style: none for IE/legacy Edge");
    assert.ok(cssContent.includes("::-webkit-scrollbar"), "::-webkit-scrollbar rule exists for WebKit/Blink");
    assert.ok(cssContent.includes("display: none"), "webkit-scrollbar has display: none");

    const htmlRule = cssContent.match(/html\s*\{([^}]+)\}/);
    assert.ok(!htmlRule[1].includes("overflow-y: hidden"), "html does not disable vertical scrolling");
    assert.ok(htmlRule[1].includes("overflow-y: auto"), "html preserves vertical scrolling via overflow-y: auto");

    const bodyRule = cssContent.match(/body\s*\{([^}]+)\}/);
    assert.ok(!bodyRule[1].includes("overflow-y: hidden"), "body does not disable vertical scrolling");
    assert.ok(bodyRule[1].includes("overflow-y: auto"), "body preserves vertical scrolling via overflow-y: auto");
});

await test("7. Duplicate CSS overflow declarations removed", () => {
    const bodyRule = cssContent.match(/body\s*\{([^}]+)\}/);
    assert.ok(bodyRule, "body rule exists");
    const count = (bodyRule[1].match(/overflow-x:\s*hidden/g) || []).length;
    assert.strictEqual(count, 1, "Exactly one overflow-x: hidden in body rule, duplicates eliminated");
});

await test("8. Grid, accordions, and subcards are configured for responsive expansion", () => {
    const statsGrid = cssContent.match(/\.stats-grid\s*\{([^}]+)\}/);
    assert.ok(statsGrid, ".stats-grid rule exists");
    assert.ok(statsGrid[1].includes("width: 100%"), ".stats-grid has width: 100%");

    const statCard = cssContent.match(/\.stat-card\s*\{([^}]+)\}/);
    assert.ok(statCard, ".stat-card rule exists");
    assert.ok(statCard[1].includes("min-width: 0"), ".stat-card has min-width: 0 to prevent grid blowout");

    const accordions = cssContent.match(/\.accordions\s*\{([^}]+)\}/);
    assert.ok(accordions, ".accordions rule exists");
    assert.ok(accordions[1].includes("width: 100%"), ".accordions has width: 100%");

    const searchBlock = cssContent.match(/\.search-block\s*\{([^}]+)\}/);
    assert.ok(searchBlock, ".search-block rule exists");
    assert.ok(searchBlock[1].includes("width: 100%"), ".search-block has width: 100%");
});

console.log("==================================================================");
console.log(`Results: ${passed} of ${total} UI Audit tests passed.`);
console.log("==================================================================");
