# CDN Analyzer Pro (Manifest V3)

**Version:** 2.1.0 · **Target:** Google Chrome 120+ · **Architecture:** service worker + Chrome DevTools Protocol (CDP)

CDN Analyzer Pro loads a page in a temporary background tab, records the raw network
traffic through the Chrome DevTools Protocol, and reports which CDN, edge, hosting or
storage provider delivered the page and its assets, together with cache status,
security headers and network timing. Every provider result lists the evidence behind it.

---

## 1. What changed in 2.1.0

**Correctness**
- "Not Detected" is no longer reported as "direct origin delivery". The report says
  *No CDN signature found* and explains that this is not proof of origin delivery.
- Generic headers (`x-cache`, `x-edge-location`, `cdn-cache`, `x-served-by`,
  `x-check-cacheable`, `via: varnish`) can no longer produce a detection on their own.
- Storage headers (`x-goog-*`, `x-amz-id-2`/`server: AmazonS3`, `x-oss-*`, `x-ms-blob-type`)
  identify an **origin store**, never a CDN.
- Google Front End (`via: 1.1 google`, `server: Google Frontend`) is reported as Google
  edge infrastructure, not as confirmed Google Cloud CDN.
- Evidence from headers, DNS CNAMEs and IP ranges is aggregated per provider. When two
  delivery providers both have strong evidence (e.g. Cloudflare in front of Vercel), the
  owner of the connected IP is reported as the outer layer and the conflict is shown.
- Wrong CNAME mappings removed or corrected (Azure Traffic Manager, `googledomains.com`,
  loose `kunlun*`/`alicloud*` wildcards; `wscdns.com` is Wangsu, not Alibaba).
- TTFB is never estimated: if CDP timing lacks the request-sent or response-header
  markers, TTFB is *Not Available* and the reason is recorded.
- The report never shows HTTP 200 for a response that was not captured. Failed
  navigations (DNS failure, refused connection, TLS error) end with a clear error
  instead of analysing Chrome's error page.

**Coverage**
- Provider fingerprints live in one registry: `modules/providers.js`.
- CNAME chains are resolved for the document host **and every unique resource host**
  (deduplicated, 6 concurrent lookups, 30-host cap, 3.5 s total budget, cancellable).
- IP ranges for Cloudflare and Fastly are the providers' published lists (source and
  retrieval date stored with the data) and matched with exact IPv4/IPv6 CIDR logic.
  IP ownership is reported as low-confidence, *network-only* evidence.
- Added: Amazon S3, Azure Blob, Google Cloud Storage, Alibaba OSS (as origin storage),
  Fly.io, Render, Gcore, Wangsu/CDNetworks, RFC 9211 `Cache-Status`.

**Report accuracy**
- Every cache-status header is kept (`cdnCache.layers`); multi-tier `X-Cache`
  values use the tier closest to the visitor.
- Cloudflare `DYNAMIC` and `BYPASS` are distinct. `no-store`, `no-cache` and `private`
  are interpreted separately.
- Per-host results count every provider seen on that host; the report separates the
  provider of the HTML document from the providers of assets.
- Score breakdown pills now show real component scores; missing measurements are shown
  as N/A and listed under the score instead of being filled with a neutral value.

---

## 2. Installation

**From the release zip (recommended)**
1. Unzip `cdn-analyzer-pro-v2.1.0.zip` to a folder.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json`).

**Chrome Web Store:** upload `cdn-analyzer-pro-v2.1.0.zip` as-is in the Developer
Dashboard. Use the permission justifications in section 4 and the privacy statement in
section 5 for the store listing.

**From source:** run `node scripts/package_release.mjs`, then load `dist/cdn-analyzer-pro/`.

---

## 3. Usage

1. Click the toolbar icon. The active tab's URL is pre-filled; any http(s) URL works.
2. Click **Analyze** (or press Enter). Analysis takes roughly 2–12 seconds.
3. Read the dashboard: score card, quick stats (CDN, SSL, cache, TTFB) and the
   Performance, Security, Headers, Cache, Resources, Suggestions and Waterfall sections.
   The **Cache** section shows the detection method, every piece of evidence (with its
   strength and whether it is product-specific), other layers, DNS CNAME chain and notes.
4. **Reset** cancels a running analysis and clears the results.

### Reading a CDN result

| Status | Meaning |
| :--- | :--- |
| *high confidence* | Product-specific header, or a header and a CNAME that agree |
| *medium confidence* | Weaker provider-specific header, or a CNAME to a provider domain |
| *low confidence • network only* | Only the connected IP is inside the provider's published range |
| *Not Identified / No CDN signature found* | No evidence found. **Not** proof that no CDN is used |

---

## 4. Permissions

| Permission | Why it is needed |
| :--- | :--- |
| `debugger` | Attach CDP to the temporary analysis tab to read response headers, timing and TLS details. Chrome shows a "started debugging this browser" bar while an analysis runs. |
| `activeTab` | Pre-fill the popup with the current tab's URL. |
| `storage` | Clear leftover state from older versions on install/startup. |
| `host_permissions` `http://*/*`, `https://*/*` | Required to attach the debugger to user-entered sites and to make DNS-over-HTTPS lookups. |

The `tabs` permission was removed in 2.1.0: creating, navigating and closing the
analysis tab does not need it, and the URL pre-fill works through `activeTab`.

---

## 5. Privacy

- Analysis runs locally. Results are kept in memory only and discarded on Reset or
  when the popup is reopened. Nothing is sent to the developer.
- **Third-party requests the extension makes:**
  - **DNS-over-HTTPS** CNAME lookups for the analysed hostnames, sent to
    `cloudflare-dns.com` (fallback `dns.google`).
  - The site **favicon** shown in the report, loaded from `www.google.com/s2/favicons`.
  - The analysed site itself, loaded in a background tab with your normal browser profile.
- Authorization, cookie and API-key headers are removed before results are stored in memory.

---

## 6. Testing

```bash
node tests/run_all_tests.mjs        # 11 suites, 167 deterministic tests, no dependencies
node scripts/package_release.mjs    # builds dist/ and validates the package
```

`tests/test_evidence_accuracy.mjs` covers the 2.1.0 fixes: unknown ≠ origin, generic-header
false positives, storage vs CDN, Google edge vs Cloud CDN, conflict handling, IPv6 CIDR
matching, cache layers and directives, host aggregation, DNS batching/cancellation, TTFB
availability and score completeness.

**Representative fixtures** in `tests/fixtures/provider_fixtures.mjs` follow each provider's
documented header formats with sanitized values. They are not live captures.

**Adding verified fixtures:** open DevTools → Network on a site you have confirmed is served
by a provider, copy the main document's response headers (remove cookies and tokens), and
add an entry with the expected provider to `provider_fixtures.mjs`.

**Real-Chrome verification (2.1.0):** the packaged extension was loaded into Chrome 153 and
run against a local server returning Cloudflare, CloudFront, Fastly and plain-nginx
responses, plus a failed DNS lookup and a refused port. Detection, cache status, PoP,
CDP timing, error handling and popup rendering behaved as expected. Live third-party
sites were not tested in that environment; compare a few against DevTools before publishing.

---

## 7. Known limitations

- Some CDNs hide or remove identifying headers.
- CNAMEs can be invisible (DNS flattening, direct A/AAAA records, custom hostnames).
- A provider's IP range shows network ownership, not a specific CDN product.
- HTTP/3 (QUIC) is a transport protocol and does not prove CDN usage.
- The HTML, images, scripts, fonts and APIs can each use a different provider.
- Cross-origin timing restrictions and missing CDP timing fields can make DNS/TCP/TLS/TTFB
  unavailable; they are reported as *Not Available*, never estimated.
- Capture stops 8 s after navigation starts, or about 1 s after the load event; very late
  requests may be missing (the report warns when capture ended early).
- Google Cloud CDN cannot be confirmed from response headers; Google-hosted responses are
  reported as Google Front End.

---

## 8. License

MIT License.
