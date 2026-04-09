# RTB Stream Chrome Extension

This repo can now be loaded directly as an unpacked Chrome extension.

## What it does

- Runs only on `https://app.getpublica.com/*`
- Watches Publica API traffic to `https://api.getpublica.com/*`
- Captures an `access_token` from request URLs, `Authorization` headers, or JSON token responses
- Opens `rtbstream.html` in a separate extension tab with:
  - `access_token` as a query string parameter
  - `publisher_id` when it can infer it from the current Publica route or API request

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   - `/Users/ttsukada/Tools/GitHubRepo/rtbstream`

## Expected flow

1. Sign in to Publica at `https://app.getpublica.com/`
2. Navigate within the app until it makes API requests to `https://api.getpublica.com`
3. The extension will open or refresh an RTB Stream tab automatically
4. `rtbstream.html` will bootstrap from the token in the query string
5. If `publisher_id` was captured too, sites load automatically; otherwise enter Publisher ID once in the RTB Stream tab

## Notes

- The token is intentionally placed in the extension page URL because that was the requested behavior.
- If Publica changes how auth is transmitted, `page-bridge.js` is the place to extend the capture logic.
