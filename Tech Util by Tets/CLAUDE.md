# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) with no build step — plain HTML/CSS/JS loaded directly by the browser. There is no bundler, no npm, no test suite.

## Loading / testing the extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory
4. After any file change, click the reload icon on the extension card (popup changes take effect immediately on next open; tool pages need a tab refresh)

To test the popup specifically, pin the extension and click the icon.

## Architecture

### Entry point
`popup.html` / `popup.js` — the extension popup. Renders a draggable list of tool buttons. Tool order is persisted via `chrome.storage.local` under the key `toolOrder`. All tools are defined in the `TOOLS` array at the top of `popup.js`; adding a new tool only requires adding an entry there.

### Tool pages
Each tool is a self-contained pair of files (`*.html` + `*.js`) that opens in a new browser tab via `chrome.tabs.create`. Tools have no dependency on each other or on the popup.

| File pair | Purpose |
|---|---|
| `json-beautilier.*` | JSON formatter with plain-text and structured tree views |
| `json-diff.*` | Compares two JSON payloads (keys sorted alphabetically, beautified) with line-level differences highlighted |
| `json-to-csv.*` | JSON → CSV converter and downloader |
| `xml-beautifier.*` | XML formatter with plain-text and structured tree views |
| `xml-to-json.*` | XML → JSON converter |
| `url-encode-decode.*` | URL parser (structured key/value table), encoder, decoder |

### Shared renderer
`structured-output.js` is a shared IIFE that exposes `window.StructuredOutput` with three methods:
- `renderJsonTree(container, value)` — collapsible JSON tree (- / + toggles)
- `renderXmlTree(container, element)` — collapsible XML tree
- `renderPlainText(container, text)` — plain `<pre>` output

It is loaded via `<script>` tag in both `json-beautilier.html` and `xml-beautifier.html`. Changes to it affect both tools.

`jsontocsv.js` is a legacy standalone CSV converter; `json-to-csv.js` is the active one.

## Permissions
- `tabs` — open tool pages in new tabs
- `storage` — persist popup menu order

## Publishing
The extension is submitted to the Chrome Web Store. Bump `"version"` in `manifest.json` before each submission (current: `1.2`). The store requires a written justification for each permission when submitting.
