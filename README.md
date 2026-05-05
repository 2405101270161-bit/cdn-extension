# **Hello there! 👋** Welcome to **CDN Analyzer Pro**. 

This is a simple but powerful Chrome Extension built for developers, system admins, or anyone curious about how websites are delivered. It helps you analyze Content Delivery Networks (CDNs), check if a website is loading from a cache, and see some basic network performance metrics right from your browser.

> **Note:** The results provided by this extension are meant to be a helpful guide. While it gives you an *almost accurate* picture of a website's CDN usage and performance, the metrics are not 100% perfectly precise due to browser limitations and varying network conditions. 

## What does it do?

- **Spots the CDN:** It tries to guess which CDN a website is using (like Cloudflare, AWS, Akamai, Vercel, etc.).
- **Checks the Cache:** Tells you if the page was served fresh from the server (`MISS`) or loaded quickly from a cache (`HIT`).
- **Rates Performance:** Gives a simple performance score based on how fast the server responded.
- **Shows the Stats:** Displays some helpful numbers like Load Time, Time to First Byte (TTFB), and what connection protocol is being used.
- **Looks Cool:** It has a nice, modern dark-mode dashboard that's easy on the eyes!

## How to Install it (Developer Mode)

Since this is a custom extension, you'll need to load it manually:

1. Download or clone this folder to your computer.
2. Open Google Chrome and go to `chrome://extensions/` in your address bar.
3. Turn on **Developer mode** (it's a switch in the top right corner).
4. Click the **Load unpacked** button on the top left.
5. Select the folder where you saved this extension.
6. Boom! The "CDN Analyzer Pro" icon should now be in your Chrome toolbar.

## How to Use it

1. Click the **CDN Analyzer Pro** icon in your toolbar.
2. Type or paste the full website URL you want to check (e.g., `https://example.com`).
3. Hit the **Analyze** button.
4. Check out the results on the dashboard!

## Under the Hood (For the Geeks)

Here's a quick rundown of the files inside:

- `manifest.json`: The brain of the extension (Manifest V3 rules).
- `popup.html` & `styles.css`: The beautiful face (UI) of the extension.
- `popup.js`: The muscles that make the buttons work and show the data.
- `background.js`: The behind-the-scenes worker that fetches the network data quietly.
- `icons/`: Where the cool logos live.

## Permissions it needs

- `activeTab` & `tabs`: To know which tab you are on.
- `storage`: To remember things if needed.
- `webRequest`: The magic permission needed to look at network headers and see what the CDN is doing.

## License

Feel free to use and tweak this under the MIT License.