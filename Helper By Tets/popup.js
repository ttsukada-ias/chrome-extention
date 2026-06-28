const LATEST_PAYLOAD_STORAGE_KEY = "latestPublicaAuthPayload";
const TAB_PAYLOAD_STORAGE_KEY_PREFIX = "publicaAuthPayload:";

function getStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getStoredPayload(tabId) {
  const storage = getStorageArea();

  if (typeof tabId === "number") {
    const tabKey = `${TAB_PAYLOAD_STORAGE_KEY_PREFIX}${tabId}`;
    const items = await storage.get([tabKey, LATEST_PAYLOAD_STORAGE_KEY]);
    return items[tabKey] || items[LATEST_PAYLOAD_STORAGE_KEY] || null;
  }

  const items = await storage.get(LATEST_PAYLOAD_STORAGE_KEY);
  return items[LATEST_PAYLOAD_STORAGE_KEY] || null;
}

function buildToolUrl(page, payload) {
  const url = new URL(chrome.runtime.getURL(page));

  if (payload?.accessToken) {
    url.searchParams.set("access_token", payload.accessToken);
  }

  if (payload?.publisherId) {
    url.searchParams.set("publisher_id", payload.publisherId);
  }

  return url.toString();
}

async function openTool(page, payload) {
  await chrome.tabs.create({ url: buildToolUrl(page, payload), active: true });
  window.close();
}

async function init() {
  const status = document.getElementById("status");
  const openRtbStream = document.getElementById("openRtbStream");
  const openLiveLogs = document.getElementById("openLiveLogs");
  const openBidderChannelMappings = document.getElementById("openBidderChannelMappings");
  const openCreativeReview = document.getElementById("openCreativeReview");

  const activeTab = await getActiveTab();
  const payload = await getStoredPayload(activeTab?.id);
  const hasAuth = !!payload?.accessToken;

  openRtbStream.disabled = !hasAuth;
  openLiveLogs.disabled = !hasAuth;
  openBidderChannelMappings.disabled = !hasAuth;
  openCreativeReview.disabled = !hasAuth;

  if (hasAuth) {
    status.textContent = payload.publisherId
      ? `Auth ready for publisher ${payload.publisherId}.`
      : "Auth ready. Publisher ID was not detected yet.";
    status.classList.add("ready");
  } else {
    status.textContent = "Open Publica and let the extension capture auth before launching a tool.";
  }

  openRtbStream.addEventListener("click", () => openTool("rtbstream.html", payload));
  openLiveLogs.addEventListener("click", () => openTool("live-logs.html", payload));
  openBidderChannelMappings.addEventListener("click", () => openTool("bidder-channel-mappings.html", payload));
  openCreativeReview.addEventListener("click", () => openTool("creative-review.html", payload));
}

init().catch(error => {
  console.error("Failed to initialize popup", error);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = "Unable to load launcher state.";
  }
});
