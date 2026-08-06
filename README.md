# **Hello there! 👋** Welcome to **CDN Analyzer Pro**. 

This is a simple but powerful Chrome Extension built for developers, system admins, or anyone curious about how websites are delivered. It helps you analyze Content Delivery Networks (CDNs), check if a website is loading from a cache, and see network performance metrics using Chrome DevTools Protocol (CDP).

> **Note:** The results provided by this extension are meant to be a helpful guide. While it gives an accurate picture of a website's CDN usage and performance, metrics may vary due to network conditions. 

## What does it do?

- **Spots the CDN:** Identifies CDN providers (Cloudflare, AWS CloudFront, Akamai, Fastly, Vercel, Netlify, Bunny, etc.).
- **Checks the Cache:** Tells you if the page was served fresh from origin (`MISS`) or from edge cache (`HIT`).
- **Rates Performance:** Calculates a performance score v2.0 based on TTFB, document download, cache hit status, compression, and security headers.
- **Shows Timing Waterfall:** Displays detailed navigation lifecycle timings (DNS, TCP, TLS, TTFB, Document Download, DOMContentLoaded, Load Event).
- **Modern Dark UI:** Includes a responsive glassmorphic dashboard with live reload animation and metric tooltips.

## How to Install it (Developer Mode)

1. Download or clone this folder to your computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** in the top left corner and select this folder.
5. Open the extension's **Details** page and enable **Allow in Incognito** for cold cache testing.

## How to Use it

1. Click the **CDN Analyzer Pro** icon in your Chrome toolbar.
2. Enter or paste a website URL (e.g. `https://example.com`).
3. Select **Cold Cache** (Incognito isolated) or **Warm Cache** (Session).
4. Click **Analyze** (or press Enter).

- `manifest.json`: Manifest V3 configuration.
- `popup.html` & `styles.css`: Glassmorphic UI dashboard layout and styles.
- `popup.js`: UI logic, active tab detection, state management, tooltips, and tab switching.
- `background.js`: CDP engine and navigation measurement pipeline.

## License

Feel free to use and tweak this under the MIT License.
