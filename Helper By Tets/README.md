# Helper by Tets Chrome Extension

This repo can now be loaded directly as an unpacked Chrome extension.

## What it does

- Runs only on `https://app.getpublica.com/*`
- Watches Publica API traffic to `https://api.getpublica.com/*`
- Captures an `access_token` from request URLs, `Authorization` headers, or JSON token responses
- Stores Publica auth context captured from the signed-in app session
- Opens tool pages from the extension launcher popup, including:
  - `rtbstream.html`
  - `live-logs.html`
- Passes auth to those tool pages with:
  - `access_token` as a query string parameter
  - `publisher_id` when it can infer it from the current Publica route or API request

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   - `/Users/ttsukada/Tools/GitHubRepo/chrome-extention`

## Expected flow

1. Sign in to Publica at `https://app.getpublica.com/`
2. Navigate within the app until it makes API requests to `https://api.getpublica.com`
3. Click the extension icon to open the launcher popup
4. Choose `RTB Stream` or `Live Logs`
5. The selected tool page opens in a new tab with the captured auth context in the query string

## Notes

- The token is intentionally placed in the extension page URL because that was the requested behavior.
- If Publica changes how auth is transmitted, `page-bridge.js` is the place to extend the capture logic.
