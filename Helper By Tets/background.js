const LATEST_PAYLOAD_STORAGE_KEY = "latestPublicaAuthPayload";
const TAB_PAYLOAD_STORAGE_KEY_PREFIX = "publicaAuthPayload:";

function getStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function storePayload(sourceTabId, payload) {
  const storage = getStorageArea();
  const items = {
    [LATEST_PAYLOAD_STORAGE_KEY]: payload
  };

  if (typeof sourceTabId === "number") {
    items[`${TAB_PAYLOAD_STORAGE_KEY_PREFIX}${sourceTabId}`] = payload;
  }

  await storage.set(items);
}

async function clearStoredPayload(sourceTabId) {
  if (typeof sourceTabId !== "number") return;
  const storage = getStorageArea();
  await storage.remove(`${TAB_PAYLOAD_STORAGE_KEY_PREFIX}${sourceTabId}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PUBLICA_AUTH_CONTEXT") return false;

  const sourceTabId = sender.tab?.id;
  if (typeof sourceTabId !== "number") return false;

  storePayload(sourceTabId, message.payload)
    .then(() => sendResponse({ ok: true, stored: true }))
    .catch(error => {
      console.error("Failed to persist auth payload", error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });

  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  clearStoredPayload(tabId).catch(() => {});
});
