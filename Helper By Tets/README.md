# Helper by Tets Chrome Extension

This repo can now be loaded directly as an unpacked Chrome extension.

## Version 2.4.1

- Removes the unused `tabs` permission identified by Chrome Web Store review.
- Retains `storage` for captured session context and saved launcher order.
- Retains access to `app.getpublica.com` for session capture and
  `api.getpublica.com` for authenticated tool requests.
- Opening tool tabs, querying the active tab ID, and cleaning up closed-tab
  session context continue to use Chrome APIs that do not require `tabs` permission.

Upload `helper-by-tets-v2.4.1.zip` to the existing Chrome Web Store item's package tab
and submit it for review. The ZIP contains the extension's runtime files with
`manifest.json` at its root.

## Version 2.4.0

- Adds Live Dashboard with 20 KPIs, individual filter-selection lines, combined
  latency graphs, partner hover cards, synchronized zoom, and one-minute auto-refresh.
- Adds period controls, searchable filters and publisher selection; defaults to UTC.
- Fixes publisher auth context after navigation and returning to a previously
  selected publisher. Malformed token entries no longer block valid token capture.
- Uses the existing extension permissions.

## What it does

- Runs only on `https://app.getpublica.com/*`
- Captures an `access_token` from matching Publica local-storage token entries
- Refreshes captured publisher context on hash and History API navigation
- Stores Publica auth context captured from the signed-in app session
- Opens tool pages from the extension launcher popup, including:
  - `rtbstream.html`
  - `live-logs.html`
  - `live-dashboard.html` — POSTs to `get_home_dashboard_live_data` and plots
    `LiveData` by date, with checkbox dropdowns for demand sources and all 20 KPIs.
    Revenue is calculated per sample as `Impressions × CPM / 1000`. Endpoint Requests
    eCPM, Fill Rate, Pod Clear Rate, Render Rate, and Winning Bids use the corresponding
    API fields; rates display as percentages.
    Fetches and paginates `/v2/settings/bidders`, deduplicating `Bidder` codes.
    Selected Endpoint, Auction, and Bidder Latency KPIs share a Key Latencies (ms)
    chart, with a line per latency/source combination. Other KPIs each have their own chart.
    Uses the captured
    token and publisher ID, loads on open, and refreshes selected sources every minute
    while the dashboard is open. Auto-refresh is enabled by default and can be paused;
    manual refresh is also available. Smooth line charts show markers only on hover
    or keyboard focus, and preserve missing-value gaps.
    Publisher selection uses name/ID search and displays `[ID] Name`, like RTB Stream
    and Live Logs. The API continues to receive the selected ID. A name-lookup failure
    preserves numeric ID entry. Timezone is editable and defaults to `UTC`.
    Form defaults: `currency_type=0`, `live_density_range=60`,
    `live_items_key=biddername`, and a quoted `biddercodes` value per source. Rates are displayed as the API's percentage
    values and latency values as milliseconds. No currency symbol is assumed for CPM.
    With no demand sources selected (the default), fetches publisher totals using
    `live_items_key=publisher_id` and omits `biddercodes`. This view also auto-refreshes.
    Each source's line uses its own timestamps, so offsets between responses do not break lines.
    Period buttons support 15/30 minutes, 1/4 hours by minute, and 4/12/24 hours
    or a week by hour. Searchable checkbox filters include bidders, bidder groups,
    channels, channel groups, routes, destinations, device types, and outbound deals.
    Timezone suggestions are available in the timezone field. Additional option
    lists load on demand. Groups expand to member IDs; routes/destinations use
    mapped channel IDs, matching Publica's live dashboard.
    Demand and supply filters each use one category at a time. Selecting an
    incompatible dimension clears the conflicting selections (deals use their
    own live dimension; device/bidder and three-dimension live queries are unsupported).
    Changing period or filters invalidates cached data and resets zoom. Auto-refresh
    preserves the chosen filters. Clear filters restores publisher totals.
    `dashboard-filters.js` owns filter UI, option loading, and live payload mapping.
    Each selected bidder, bidder group, channel, channel group, route, destination,
    device type, or outbound deal gets a separate labeled line and API query.
    Multiple active filter categories produce a line per selected combination.
    Each group/route line aggregates only that item's mapped member IDs, and
    overlapping groups remain separate comparisons. Legends, hover cards, colors,
    shared zoom, and auto-refresh operate on these individual series.
    Click legend names to toggle sources within an individual graph; Show all/Hide all
    help isolate one or more sources without changing the demand-source filter or fetching.
    In the combined latency graph, toggling a source affects all its latency lines.
    Drag horizontally across any graph to zoom all tiles to the same date range;
    Reset zoom or double-clicking any graph restores the full range across all tiles. These view settings survive
    refreshes and reset when the publisher or timezone changes.
    Hover anywhere in the plot to see a shared tooltip grouped by demand partner,
    with colored KPI values and exact sample timestamps. A vertical guide and
    highlighted points follow the nearest time; hidden sources are excluded.
    Keyboard focus on a point opens the same card; Escape dismisses it.
    Legends sort by their displayed latest values, highest first. Hover cards sort
    by values at the hovered time, with missing values last. In the combined latency
    card, partners rank by their highest displayed latency, and their KPI rows also
    sort in descending order.
    Demand partners keep the same colors across every graph, legend, and hover card.
    In combined latency graphs, line styles distinguish latency types for each partner.
    Publisher totals use distinct colors for the latency types.
- Passes auth to those tool pages with:
  - `access_token` as a query string parameter
  - `publisher_id` when it can infer it from the current Publica route or API request

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   - `/Users/ttsukada/Tools/GitHubRepo/chrome-extention/Helper By Tets`

## Expected flow

1. Sign in to Publica at `https://app.getpublica.com/`
2. Navigate to the publisher you want to use
3. Click the extension icon to open the launcher popup
4. Choose `RTB Stream` or `Live Logs`
5. The selected tool page opens in a new tab with the captured auth context in the query string

## Notes

- The token is intentionally placed in the extension page URL because that was the requested behavior.
- If Publica changes how auth is transmitted, `page-bridge.js` is the place to extend the capture logic.
