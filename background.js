const sourceTabToRtbTab = new Map();
const lastContextBySourceTab = new Map();

function buildRtbUrl(payload) {
  const url = new URL(chrome.runtime.getURL("rtbstream.html"));
  url.searchParams.set("access_token", payload.accessToken);

  if (payload.publisherId) {
    url.searchParams.set("publisher_id", payload.publisherId);
  }

  return url.toString();
}

async function openOrRefreshRtbTab(sourceTabId, payload) {
  if (!payload?.accessToken) return;

  const nextSignature = `${payload.accessToken}::${payload.publisherId || ""}`;
  if (lastContextBySourceTab.get(sourceTabId) === nextSignature) return;
  lastContextBySourceTab.set(sourceTabId, nextSignature);

  const rtbUrl = buildRtbUrl(payload);
  const existingTabId = sourceTabToRtbTab.get(sourceTabId);

  if (typeof existingTabId === "number") {
    try {
      await chrome.tabs.update(existingTabId, { url: rtbUrl, active: true });
      return;
    } catch {
      sourceTabToRtbTab.delete(sourceTabId);
    }
  }

  const createdTab = await chrome.tabs.create({ url: rtbUrl, active: true });
  sourceTabToRtbTab.set(sourceTabId, createdTab.id);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PUBLICA_AUTH_CONTEXT") return false;

  const sourceTabId = sender.tab?.id;
  if (typeof sourceTabId !== "number") return false;

  openOrRefreshRtbTab(sourceTabId, message.payload)
    .then(() => sendResponse({ ok: true }))
    .catch(error => {
      console.error("Failed to open RTB Stream tab", error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });

  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  for (const [sourceTabId, rtbTabId] of sourceTabToRtbTab.entries()) {
    if (tabId === sourceTabId || tabId === rtbTabId) {
      sourceTabToRtbTab.delete(sourceTabId);
      lastContextBySourceTab.delete(sourceTabId);
    }
  }
});
