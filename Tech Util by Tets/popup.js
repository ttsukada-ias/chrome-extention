const TOOLS = [
  { id: "openJsonToCsv",        page: "json-to-csv.html",       title: "Json to CSV",                  copy: "Convert pasted JSON into a downloadable CSV file." },
  { id: "openJsonBeautilier",   page: "json-beautilier.html",   title: "Json Beautilier",               copy: "Beautify pasted JSON and copy it to your clipboard." },
  { id: "openJsonDiff",         page: "json-diff.html",         title: "Json Diff",                     copy: "Compare two JSON payloads with sorted keys and highlighted differences." },
  { id: "openXmlBeautifier",    page: "xml-beautifier.html",    title: "XML Beautifier",                copy: "Beautify pasted XML and copy it to your clipboard." },
  { id: "openXmlToJson",        page: "xml-to-json.html",       title: "XML to JSON",                   copy: "Convert XML into structured JSON for easier viewing." },
  { id: "openUrlEncodeDecode",  page: "url-encode-decode.html", title: "URL Parse / Encode / Decode",   copy: "Parse a URL into components, encode text for URLs, or decode URL-encoded strings." },
];

const STORAGE_KEY = "toolOrder";

function buildToolUrl(page) {
  return chrome.runtime.getURL(page);
}

async function openTool(page) {
  await chrome.tabs.create({ url: buildToolUrl(page), active: true });
  window.close();
}

function saveOrder(ids) {
  chrome.storage.local.set({ [STORAGE_KEY]: ids });
}

async function loadOrder() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, result => {
      resolve(result[STORAGE_KEY] || null);
    });
  });
}

function getOrderedTools(savedIds) {
  if (!savedIds) return TOOLS;
  const map = Object.fromEntries(TOOLS.map(t => [t.id, t]));
  const ordered = savedIds.map(id => map[id]).filter(Boolean);
  // append any new tools not yet in saved order
  TOOLS.forEach(t => { if (!savedIds.includes(t.id)) ordered.push(t); });
  return ordered;
}

function renderList(tools) {
  const list = document.getElementById("toolList");
  list.innerHTML = "";

  tools.forEach(tool => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.draggable = true;
    item.dataset.id = tool.id;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn";
    btn.innerHTML = `<div class="link-title">${tool.title}</div><div class="link-copy">${tool.copy}</div>`;
    btn.addEventListener("click", () => openTool(tool.page));

    item.append(handle, btn);
    list.appendChild(item);
  });

  initDrag(list);
}

function initDrag(list) {
  let dragSrc = null;

  list.addEventListener("dragstart", e => {
    const item = e.target.closest(".list-item");
    if (!item) return;
    dragSrc = item;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  list.addEventListener("dragend", () => {
    if (dragSrc) dragSrc.classList.remove("dragging");
    list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    dragSrc = null;
  });

  list.addEventListener("dragover", e => {
    e.preventDefault();
    const target = e.target.closest(".list-item");
    if (!target || target === dragSrc) return;
    list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    target.classList.add("drag-over");

    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      list.insertBefore(dragSrc, target);
    } else {
      list.insertBefore(dragSrc, target.nextSibling);
    }
  });

  list.addEventListener("drop", e => {
    e.preventDefault();
    const ids = [...list.querySelectorAll(".list-item")].map(el => el.dataset.id);
    saveOrder(ids);
  });
}

async function init() {
  const savedIds = await loadOrder();
  const tools = getOrderedTools(savedIds);
  renderList(tools);
}

init();
