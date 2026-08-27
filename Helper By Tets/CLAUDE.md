# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Loading the extension

There is no build step. Load the extension directly as an unpacked Chrome extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `/Users/ttsukada/Tools/GitHubRepo/chrome-extention`

After editing any file, click the reload icon on the extension card in `chrome://extensions`. Tool pages (`.html`) can simply be refreshed in their tab.

## Architecture

This is a Manifest V3 Chrome extension targeting `https://app.getpublica.com` with no bundler, no framework, and no dependencies — plain HTML/CSS/JS files loaded directly by Chrome.

### Auth capture pipeline

```
page-bridge.js          — injected into app.getpublica.com page context; intercepts
                          XHR/fetch to api.getpublica.com and extracts access_token
                          and publisher_id from URLs, headers, or JSON bodies
content.js              — content script that injects page-bridge.js into the page
                          and relays messages from page context → extension context
background.js           — service worker; receives PUBLICA_AUTH_CONTEXT messages
                          and stores them in chrome.storage.session (keyed by tab ID
                          and as a global latest payload)
popup.js                — reads stored auth, enables tool buttons, opens tool pages
                          with ?access_token=...&publisher_id=... in the URL
```

### Tool pages

Each tool is a self-contained `*.html` + `*.js` pair. Auth arrives via query string (`access_token`, `publisher_id`) parsed at init time — there is no shared runtime state between tool pages.

| File | Purpose |
|------|---------|
| `creative-review.html/js` | Main creative review list — fetches `POST /creative_validation/{status}`, deduplicates by `CreativeURL`, aggregates Impressions/BidErrorBlockedResponses across bidders, renders cards progressively as API pages arrive |
| `creative-review-detail.html/js` | Per-creative-URL drill-down — shows all bidder rows for one creative, bulk status/field updates |
| `rtbstream.html/js` | RTB stream viewer |
| `live-logs.html/js` | Live log viewer |
| `bidder-channel-mappings.html/js` | Bidder ↔ channel mapping tool |
| `bidder-info.html/js` | Bidder info list — resolves all bidder IDs via `POST /v2/settings/bidders`, then fetches full details (Params, SiteIDS) in batches via `GET /v1/settings/bidders?hb_ids=...` |
| `signal-values.html/js` | Signal values viewer |
| `log-viewer.html/js` | Log viewer |

### Creative review key design decisions

- **Progressive loading**: `loadCreativeRows()` fetches API pages in a loop (each returns 25 rows — `API_PAGE_SIZE = 25`) until `PAGE_SIZE` unique creative URLs are accumulated. Cards are appended to the DOM after each API page without re-rendering existing cards (avoids video flicker).
- **Deduplication + aggregation**: `seenCreativeUrls` (Set) and `aggregatedRows` (Map keyed by `CreativeURL`) track already-seen URLs. Duplicate rows have their numeric fields (`Impressions`, `BidErrorBlockedResponses`, `BidErrors`, `BidErrorsBrandSafety`) summed into the existing aggregated row; already-rendered card elements are updated in-place via `data-agg-field` attributes.
- **Fetch cancellation**: `fetchGeneration` counter is incremented on every navigation/filter change; the async fetch loop checks `gen !== fetchGeneration` before each render to abort stale loads.
- **Back navigation cache**: `displayPageCache` (Map keyed by display page index) stores completed pages so previous-page navigation is instant.
- **`PAGE_SIZE` vs `API_PAGE_SIZE`**: `PAGE_SIZE` (25/50/100, user-selectable) controls how many unique creative URLs to show per display page. `API_PAGE_SIZE = 25` is the server's fixed page size, used only for end-of-data detection and CSV export pagination.
- **Video playback**: `IntersectionObserver` (threshold 0.5) starts/stops video playback based on viewport visibility instead of autoplay. Videos are unobserved via `stopAndReleaseVideo()` when cards are torn down.

### API base

All API calls go to `https://api.getpublica.com/v1/settings/publishers/{publisherId}/...` with `?access_token=` in the query string.
