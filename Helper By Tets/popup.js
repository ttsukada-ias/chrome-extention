const LATEST_PAYLOAD_STORAGE_KEY = "latestPublicaAuthPayload";
const TAB_PAYLOAD_STORAGE_KEY_PREFIX = "publicaAuthPayload:";
const TOOL_ORDER_KEY = "toolOrder";
const TOOL_PAGES = {
  openRtbStream: "rtbstream.html",
  openLiveLogs: "live-logs.html",
  openBidderChannelMappings: "bidder-channel-mappings.html",
  openCreativeReview: "creative-review.html",
  openBidderInfo: "bidder-info.html"
};

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

async function loadToolOrder() {
  const items = await chrome.storage.local.get(TOOL_ORDER_KEY);
  return items[TOOL_ORDER_KEY] || null;
}

async function saveToolOrder(order) {
  await chrome.storage.local.set({ [TOOL_ORDER_KEY]: order });
}

function applyOrder(order) {
  const list = document.getElementById("toolList");
  if (!list || !order) return;
  order.forEach(toolId => {
    const item = list.querySelector(`[data-tool="${toolId}"]`);
    if (item) list.appendChild(item);
  });
}

function wireDragAndDrop(list) {
  let draggedItem = null;

  list.addEventListener("dragstart", e => {
    draggedItem = e.target.closest(".list-item");
    if (!draggedItem) return;
    setTimeout(() => draggedItem.classList.add("dragging"), 0);
    e.dataTransfer.effectAllowed = "move";
  });

  list.addEventListener("dragend", () => {
    if (!draggedItem) return;
    draggedItem.classList.remove("dragging");
    list.querySelectorAll(".list-item").forEach(el => el.classList.remove("drag-over"));
    const order = [...list.querySelectorAll(".list-item")].map(el => el.dataset.tool);
    saveToolOrder(order).catch(() => {});
    draggedItem = null;
  });

  list.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = e.target.closest(".list-item");
    if (!target || target === draggedItem) return;
    list.querySelectorAll(".list-item").forEach(el => el.classList.remove("drag-over"));
    target.classList.add("drag-over");
  });

  list.addEventListener("dragleave", e => {
    const target = e.target.closest(".list-item");
    if (target) target.classList.remove("drag-over");
  });

  list.addEventListener("drop", e => {
    e.preventDefault();
    const target = e.target.closest(".list-item");
    if (!target || !draggedItem || target === draggedItem) return;
    target.classList.remove("drag-over");
    const items = [...list.querySelectorAll(".list-item")];
    const draggedIndex = items.indexOf(draggedItem);
    const targetIndex = items.indexOf(target);
    if (draggedIndex < targetIndex) {
      target.after(draggedItem);
    } else {
      target.before(draggedItem);
    }
  });
}

async function init() {
  const status = document.getElementById("status");
  const list = document.getElementById("toolList");

  const [activeTab, savedOrder] = await Promise.all([getActiveTab(), loadToolOrder()]);
  const payload = await getStoredPayload(activeTab?.id);
  const hasAuth = !!payload?.accessToken;

  if (savedOrder) applyOrder(savedOrder);

  Object.entries(TOOL_PAGES).forEach(([id, page]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !hasAuth;
    btn.addEventListener("click", () => openTool(page, payload));
  });

  if (hasAuth) {
    status.textContent = payload.publisherId
      ? `Auth ready for publisher ${payload.publisherId}.`
      : "Auth ready. Publisher ID was not detected yet.";
    status.classList.add("ready");
  } else {
    status.textContent = "Open Publica and let the extension capture auth before launching a tool.";
  }

  wireDragAndDrop(list);
}

init().catch(error => {
  console.error("Failed to initialize popup", error);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = "Unable to load launcher state.";
  }
});
