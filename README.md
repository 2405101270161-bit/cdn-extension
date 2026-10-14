# CDN Analyzer Pro (Manifest V3)

**Version:** 2.0.0
**Target:** Google Chrome 120+ (Manifest V3)
**Architecture:** Background Service Worker + Chrome DevTools Protocol (CDP)

---

## 1. Project Overview

**CDN Analyzer Pro** is a high-precision, developer-grade Chrome Extension built on Manifest V3. It connects directly to the Chrome DevTools Protocol (CDP) to analyze network traffic, identify Content Delivery Networks (CDNs), inspect HTTP cache layers, calculate connection timings, verify security headers, and generate comprehensive audit reports.

Unlike traditional extensions that rely solely on window-level timing or simple regexes on main document HTML, CDN Analyzer Pro runs an isolated headless tab via CDP to capture raw protocol events (`Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, and `Security.visibleSecurityState`). This ensures every reported metric is directly traceable to observed wire evidence.

---

## 2. Key Features

- **Multi-Provider CDN Detection:**
  - Evaluates independent signatures across 16+ major CDN providers (Cloudflare, Amazon CloudFront, Akamai, Fastly, Google Cloud CDN, Azure CDN, Vercel, Netlify, Bunny CDN, KeyCDN, EdgeNext, Imperva, etc.).
  - Uses additive multi-factor scoring and confidence weighting (`high`, `medium`, `low`, `none`).
  - Distinguishes primary origin CDN delivery from multi-CDN asset architectures.

- **Edge-Server & PoP Identification:**
  - Extracts physical edge server node IDs (e.g. `BOM78-P3`, `iad1-1`) from provider-specific headers (`x-amz-cf-pop`, `x-served-by`, `cf-ray`).
  - Maps confirmed 3-letter IATA airport codes (e.g. `BOM` for Mumbai) to geographic locations.
  - Decouples physical node IDs from geographic PoPs: never fabricates an airport location if only an internal node ID is observed.

- **Accurate Network Timing & Connection Reuse:**
  - Measures DNS resolution, TCP / QUIC transport, TLS handshake, Full TTFB, document download, DOMContentLoaded, load event, and network idle.
  - Accurately detects socket reuse (`connection.reused`): labels reused connections as `Connection Reused (Bypassed)` rather than displaying misleading `0 ms` measurements.

- **Dual-Layer Cache Analysis:**
  - Clearly distinguishes **Browser Delivery Source** (network fetch, disk cache, memory cache, service worker, prefetch) from **CDN Edge Cache Status** (`HIT`, `MISS`, `BYPASS`, `REVALIDATED`).
  - Analyzes Cache-Control policies (`max-age`, `s-maxage`, `public`, `private`, `no-store`) without misclassifying policy directives as edge cache hits.

- **Resource Accounting & Host Breakdown:**
  - Quantifies total requests, first-party vs third-party requests, failed requests, encoded network transfer bytes, and decoded payload bytes.
  - Reports macro **CDN Delivery Ratio** (`X of Y requests (Z%) served via CDN`).
  - Summarizes per-host request counts and detected CDN providers.
  - Identifies top asset highlights (largest overall resource, image, script, stylesheet, slowest request).

- **Dynamic Performance Scoring:**
  - Computes a weighted 0–100 score and letter grade (A+ through F) evaluating page load speed (25%), TTFB (25%), edge cache efficiency (20%), compression (15%), and security headers (15%).
  - Dynamically reweights unmeasured or inapplicable components without unfair score penalties.

- **Structured 8-Section Audit Reports & Sanitized Exports:**
  - Generates comprehensive Markdown audit reports covering all 8 diagnostic areas.
  - Exports sanitized JSON with automated redaction of sensitive credentials, cookies, tokens, and authorization headers.
  - One-click clipboard copy with transient visual feedback (`Copied!`).

- **Reliability & Isolation:**
  - Headless analysis tabs run in the background without affecting the user's active browsing tab.
  - Complete state reset and teardown prevents cross-analysis data leakage.
  - Safely recovers from Manifest V3 service worker sleep/wake suspension cycles.

---

## 3. Requirements

- **Google Chrome:** Version 120 or newer.
- **Node.js (for regression tests):** Version 18.0 or newer (uses native ESM and Node built-in modules).
- **Operating System:** Cross-platform (Windows, macOS, Linux).

---

## 4. Installation Instructions

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/2405101270161-bit/cdn-extension.git
   cd cdn-extension
   ```
2. Open Google Chrome and enter `chrome://extensions/` in the address bar.
3. In the upper-right corner of the Extensions page, switch the **Developer mode** toggle to **ON**.
4. In the upper-left corner, click **Load unpacked**.
5. Select the extension directory (the folder containing `manifest.json`).
6. The **CDN Analyzer Pro** icon will appear in your Chrome toolbar. Pin it for quick access.

---

## 5. Usage Instructions

1. Click the **CDN Analyzer Pro** icon in your toolbar.
2. The popup will automatically suggest the URL of the active tab, or you can enter any HTTP/HTTPS URL (e.g. `https://www.cloudflare.com`).
3. Click **Analyze** (or press `Enter`).
4. Watch the real-time checklist as the analyzer navigates, attaches CDP, inspects network streams, and aggregates data.
5. Review the resulting dashboard:
   - **Score Card:** View the overall score, grade, and component breakdown pills.
   - **Quick Stats:** Primary CDN provider, SSL transport, cache state, and TTFB.
   - **Accordions:** Expand Performance, Security, Headers, Cache, Resources, Suggestions, and Mini Waterfall for detailed diagnostic rows.
6. **Copy Report:** Click the `Copy` button in the topbar or footer to copy the 8-section Markdown audit to your clipboard.
7. **Export JSON:** Click the `JSON` button to download a sanitized JSON report.
8. **Reset:** Click `Reset` in the topbar to immediately abort any running run and return to a clean home state.

---

## 6. Permissions and Security Rationale

CDN Analyzer Pro strictly adheres to the principle of least privilege in Manifest V3:

| Permission | Purpose & Justification |
| :--- | :--- |
| `debugger` | Required to attach Chrome DevTools Protocol to the temporary background tab to collect raw HTTP request/response headers, low-level timing offsets, and TLS certificate security state. |
| `tabs` | Required to create the hidden analysis tab (`chrome.tabs.create`), navigate it to the target URL, monitor lifecycle events, and safely terminate it (`chrome.tabs.remove`) on completion or exit. |
| `storage` | Required for `chrome.storage.session` to track the state of in-flight analyses across service worker idle sleep and wake events. |
| `activeTab` | Grants temporary read-only access to the currently active tab's URL so the popup can prefill the search field for user convenience. |
| `host_permissions` (`http://*/*`, `https://*/*`) | Required by Chrome's `chrome.debugger.attach` API to allow CDP attachment to arbitrary user-entered target domains. |

> **Note on Removed Permissions:**
> The `scripting` permission and broad `content_scripts` were audited and removed because CDN Analyzer Pro operates entirely through CDP in background tabs, eliminating unnecessary code injection into user browsing pages.

---

## 7. Privacy and Data Handling

- **100% Local Execution:** All analysis occurs locally in memory and in transient session storage. No data is transmitted to external telemetry, analytics, or third-party servers.
- **Sensitive Header Redaction:** Authorization headers (`Bearer ...`), cookie strings, API keys, and basic auth credentials in URLs are automatically stripped by `scrubSensitiveHeaders` before data is stored or exported.
- **Zero Browser Mutation:** The extension never clears, modifies, or alters the user's personal browser cache, cookies, or existing history.
- **Ephemeral Background Sessions:** Temporary analysis tabs are detached and destroyed immediately upon analysis completion or failure.

---

## 8. Automated Testing

The project includes a comprehensive, zero-dependency regression test suite covering all functionality from Goals 1 through 6.

### Run All 9 Test Suites (135 Deterministic Tests)

```bash
node tests/run_all_tests.mjs
```

### Run Live Network Smoke Tests (5 Real-World Websites)

```bash
node tests/live_smoke_test.mjs
```

### Individual Test Suites

- `node tests/test_cdn_detection.mjs`: Provider signatures, multi-match, malformed headers.
- `node tests/test_edge_evidence.mjs`: Edge PoP extraction, socket IP separation.
- `node tests/test_network_timing.mjs`: Timing calculations, socket reuse, protocol mapping.
- `node tests/test_cache_analysis.mjs`: Browser cache, service worker, CDN HIT/MISS/BYPASS.
- `node tests/test_lifecycle.mjs`: Stale state clearance, generation isolation.
- `node tests/test_integration.mjs`: End-to-end synthetic CDP event processing.
- `node tests/test_goal3_metrics.mjs`: Transfer accounting, public suffix parsing.
- `node tests/test_reliability.mjs`: Error handling, debugger disconnects, timeouts, credential sanitization.
- `node tests/test_report_ui.mjs`: 8-section report generation, unmeasured sentinels, secret exclusion.

---

## 9. Known Limitations

1. **Manifest V3 Service Worker Lifetime:** Chrome terminates background service workers after ~30 seconds of inactivity. In-flight analyses maintain an active tab lock to prevent early suspension; if suspended by Chrome, the extension safely recovers and marks the run failed with clear retry instructions.
2. **Third-Party Iframe Timing Restrictions:** Under the W3C Resource Timing specification, cross-origin iframes without the `Timing-Allow-Origin` header omit granular TCP/TLS breakdown timings. The extension handles this honestly by displaying `Not Available` rather than misleading `0 ms` values.
3. **Encrypted Client Hello (ECH):** Sites negotiating ECH encrypt the outer Server Name Indication (SNI) on the wire. The extension validates certificates via CDP's `Security.visibleSecurityState` API.

---

## 10. License

MIT License. See source files for details.
