let accessToken = "";
let publisherId = "";
let bidderRows = [];
let publisherSearchTimer = null;
let publisherSearchResults = [];
let bootstrapPublisherId = "";

const HB_ID_BATCH_SIZE = 150;

function $(id) {
  return document.getElementById(id);
}

function getBootstrapQueryValue(key) {
  try {
    return new URLSearchParams(window.location.search).get(key)?.trim() || "";
  } catch {
    return "";
  }
}

function setAuthStatus(text, isWarn = false) {
  const el = $("authStatus");
  el.textContent = text;
  el.classList.toggle("warn", !!isWarn);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${text}`);
  }
  return response.json();
}

function getActivePublisherId() {
  return $("publisherIdInput")?.value.trim() || publisherId;
}

function getPublisherSearchInput() {
  return $("publisherSearchInput")?.value.trim() || "";
}

function setPublisherId(value) {
  const field = $("publisherIdInput");
  if (field) field.value = `${value || ""}`.trim();
}

function setPublisherHelper(text) {
  const el = $("publisherHelper");
  if (!el) return;
  el.textContent = text || "";
}

function formatPublisherOption(publisher) {
  const id = `${publisher?.id ?? ""}`.trim();
  const name = `${publisher?.name || ""}`.trim();
  return id && name ? `[${id}] ${name}` : "";
}

function renderPublisherSearchOptions(items = []) {
  const list = $("publisherSearchList");
  if (!list) return;

  list.innerHTML = "";
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = formatPublisherOption(item);
    list.appendChild(option);
  });
}

function syncPublisherSelectionFromInput() {
  const inputValue = getPublisherSearchInput();
  const matchedPublisher = publisherSearchResults.find(item => formatPublisherOption(item) === inputValue);

  if (matchedPublisher) {
    setPublisherId(matchedPublisher.id);
    setPublisherHelper(`Selected publisher: ${formatPublisherOption(matchedPublisher)}`);
    return true;
  }

  if (/^\d+$/.test(inputValue)) {
    setPublisherId(inputValue);
    setPublisherHelper(`Selected publisher ID: ${inputValue}`);
    return true;
  }

  return false;
}

async function searchPublishers(query) {
  const contextPublisherId = getActivePublisherId() || bootstrapPublisherId;
  if (!accessToken || !contextPublisherId) {
    throw new Error("Missing auth token or publisher ID.");
  }

  const url =
    `https://api.getpublica.com/v1/settings/publishers_names` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&publisher_id=${encodeURIComponent(contextPublisherId)}` +
    `&query=${encodeURIComponent(query)}`;

  return fetchJson(url, { method: "GET" }).then(json => Array.isArray(json) ? json : []);
}

async function resolvePublisherDisplay(publisherIdValue) {
  const resolvedPublisherId = `${publisherIdValue || ""}`.trim();
  if (!resolvedPublisherId || !accessToken) {
    return;
  }

  try {
    const results = await searchPublishers(resolvedPublisherId);
    publisherSearchResults = results;
    renderPublisherSearchOptions(results);

    const matchedPublisher = results.find(item => `${item?.id ?? ""}`.trim() === resolvedPublisherId);
    if (matchedPublisher) {
      const formatted = formatPublisherOption(matchedPublisher);
      $("publisherSearchInput").value = formatted;
      setPublisherId(matchedPublisher.id);
      setPublisherHelper(`Selected publisher: ${formatted}`);
      return;
    }
  } catch (error) {
    console.error("Failed to resolve publisher display", error);
  }

  $("publisherSearchInput").value = resolvedPublisherId;
  setPublisherId(resolvedPublisherId);
  setPublisherHelper(`Selected publisher ID: ${resolvedPublisherId}`);
}

async function handlePublisherSearchInput() {
  const query = getPublisherSearchInput();

  if (publisherSearchTimer) {
    clearTimeout(publisherSearchTimer);
    publisherSearchTimer = null;
  }

  if (!query) {
    publisherSearchResults = [];
    renderPublisherSearchOptions([]);
    setPublisherId("");
    setPublisherHelper("Type to search publishers, then choose one to load Bidder Info.");
    return;
  }

  if (syncPublisherSelectionFromInput()) {
    return;
  }

  publisherSearchTimer = setTimeout(async () => {
    try {
      const results = await searchPublishers(query);
      publisherSearchResults = results;
      renderPublisherSearchOptions(results);
      setPublisherHelper(results.length
        ? `Found ${results.length} publisher${results.length === 1 ? "" : "s"}. Keep typing to narrow the list.`
        : "No matching publishers found yet.");
    } catch (error) {
      console.error("Failed to search publishers", error);
      setPublisherHelper(String(error?.message || error));
    }
  }, 250);
}

async function handlePublisherSelectionChange() {
  bidderRows = [];
  renderResults();

  if (!syncPublisherSelectionFromInput()) {
    return;
  }

  if (!getActivePublisherId()) {
    setAuthStatus("Enter a publisher to continue.", true);
    return;
  }

  try {
    await loadBidders();
  } catch (error) {
    console.error("Failed to load bidders", error);
    setAuthStatus(`Failed to load bidders: ${error.message}`, true);
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchAllBidderIds(activePublisherId, activeStatus) {
  const url =
    `https://api.getpublica.com/v2/settings/bidders` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&publisher_id=${encodeURIComponent(activePublisherId)}` +
    `&bidder_params_search=` +
    `&page_size=1000` +
    `&bidder_group_ids=` +
    `&page=0` +
    `&search=` +
    `&id_search=` +
    `&order_by=name` +
    `&order_direction=asc` +
    `&demand_sources=` +
    `&bidder_labels=` +
    `&priority=` +
    `&active=${encodeURIComponent(activeStatus)}`;

  const payload = {
    selectedChannelIds: [],
    preloads: [],
    uiFields: ["id", "name", "bidder", "active"]
  };

  const json = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return (Array.isArray(json?.HeaderBidderListInfo) ? json.HeaderBidderListInfo : [])
    .map(item => Number(item?.ID))
    .filter(Number.isFinite);
}

async function fetchBidderDetails(activePublisherId, bidderIds) {
  const batches = chunkArray(bidderIds, HB_ID_BATCH_SIZE);

  const results = await Promise.all(
    batches.map(batch => {
      const url =
        `https://api.getpublica.com/v1/settings/bidders` +
        `?publisher_id=${encodeURIComponent(activePublisherId)}` +
        `&site_ids=` +
        `&include_deleted=false` +
        `&all_fields=false` +
        `&hb_ids=${encodeURIComponent(batch.join(","))}` +
        `&access_token=${encodeURIComponent(accessToken)}`;

      return fetchJson(url, { method: "GET" });
    })
  );

  return results.flatMap(json => Array.isArray(json?.headerbidders) ? json.headerbidders : []);
}

function parseParams(paramsStr) {
  const raw = `${paramsStr || ""}`.trim();
  if (!raw) return [];

  try {
    const obj = JSON.parse(`{${raw}}`);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value)
    }));
  } catch {
    return [{ key: "raw", value: raw }];
  }
}

function renderEmpty(message) {
  const results = $("results");
  results.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = message;
  results.appendChild(empty);
}

function buildRowElement(row) {
  const rowEl = document.createElement("div");
  rowEl.className = "results-table-row";

  const idCell = document.createElement("div");
  idCell.className = "results-table-cell";
  idCell.textContent = row.id;
  rowEl.appendChild(idCell);

  const nameCell = document.createElement("div");
  nameCell.className = "results-table-cell";
  const nameEl = document.createElement("div");
  nameEl.className = "bidder-name";
  nameEl.textContent = row.name;
  nameCell.appendChild(nameEl);
  rowEl.appendChild(nameCell);

  const bidderCell = document.createElement("div");
  bidderCell.className = "results-table-cell";
  const bidderKeyEl = document.createElement("span");
  bidderKeyEl.className = "bidder-key";
  bidderKeyEl.textContent = row.bidder;
  bidderCell.appendChild(bidderKeyEl);
  rowEl.appendChild(bidderCell);

  const siteIdsCell = document.createElement("div");
  siteIdsCell.className = "results-table-cell";
  siteIdsCell.textContent = row.siteIds.length ? row.siteIds.join(", ") : "—";
  rowEl.appendChild(siteIdsCell);

  const paramsCell = document.createElement("div");
  paramsCell.className = "results-table-cell";
  if (row.params.length) {
    const paramsList = document.createElement("div");
    paramsList.className = "params-list";
    row.params.forEach(param => {
      const paramRow = document.createElement("div");
      paramRow.className = "params-row";

      const keyEl = document.createElement("span");
      keyEl.className = "params-key";
      keyEl.textContent = `${param.key}:`;
      paramRow.appendChild(keyEl);

      const valueEl = document.createElement("span");
      valueEl.className = "params-value";
      valueEl.textContent = param.value;
      paramRow.appendChild(valueEl);

      paramsList.appendChild(paramRow);
    });
    paramsCell.appendChild(paramsList);
  } else {
    paramsCell.textContent = "—";
  }
  rowEl.appendChild(paramsCell);

  return rowEl;
}

function getFilteredRows() {
  const query = $("searchInput").value.trim().toLowerCase();
  return query
    ? bidderRows.filter(row =>
        `${row.id}`.includes(query) ||
        row.name.toLowerCase().includes(query) ||
        row.bidder.toLowerCase().includes(query)
      )
    : bidderRows;
}

function renderResults() {
  const results = $("results");
  results.innerHTML = "";

  const filtered = getFilteredRows();

  if (filtered.length === 0) {
    renderEmpty("No bidders match the current search.");
    return;
  }

  const header = document.createElement("div");
  header.className = "results-table-header";
  ["ID", "Name", "Bidder", "Site IDs", "Params"].forEach(label => {
    const head = document.createElement("div");
    head.className = "results-table-head";
    head.textContent = label;
    header.appendChild(head);
  });
  results.appendChild(header);

  filtered.forEach(row => results.appendChild(buildRowElement(row)));
}

function toCsvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function formatParamsForCsv(params) {
  return params.map(param => `${param.key}=${param.value}`).join("; ");
}

function exportBidders() {
  const rows = getFilteredRows();
  if (rows.length === 0) {
    setAuthStatus("No bidders available to export.", true);
    return;
  }

  const headers = ["ID", "Name", "Bidder", "Site IDs", "Params"];
  const csvRows = [headers.map(toCsvCell).join(",")];

  rows.forEach(row => {
    csvRows.push(
      [
        row.id,
        row.name,
        row.bidder,
        row.siteIds.join(", "),
        formatParamsForCsv(row.params)
      ]
        .map(toCsvCell)
        .join(",")
    );
  });

  const blob = new Blob(["﻿", csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "bidder-info.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  setAuthStatus(`Exported ${rows.length} bidder${rows.length === 1 ? "" : "s"}.`);
}

async function loadBidders() {
  const activePublisherId = getActivePublisherId();
  if (!activePublisherId) {
    throw new Error("Missing publisher ID.");
  }

  const activeStatus = $("statusFilter").value;

  setAuthStatus("Loading bidder list...");
  const bidderIds = await fetchAllBidderIds(activePublisherId, activeStatus);

  if (bidderIds.length === 0) {
    bidderRows = [];
    renderResults();
    setAuthStatus("No bidders found for this publisher.");
    return;
  }

  setAuthStatus(`Loading details for ${bidderIds.length} bidder${bidderIds.length === 1 ? "" : "s"}...`);
  const headerbidders = await fetchBidderDetails(activePublisherId, bidderIds);

  bidderRows = headerbidders
    .map(item => ({
      id: Number(item?.ID),
      name: `${item?.Name || ""}`.trim(),
      bidder: `${item?.Bidder || ""}`.trim(),
      siteIds: Array.isArray(item?.SiteIDS) ? item.SiteIDS : [],
      params: parseParams(item?.Params)
    }))
    .filter(row => Number.isFinite(row.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  renderResults();
  setAuthStatus(`Loaded ${bidderRows.length} bidder${bidderRows.length === 1 ? "" : "s"}.`);
}

async function init() {
  accessToken = getBootstrapQueryValue("access_token");
  publisherId = getBootstrapQueryValue("publisher_id");
  bootstrapPublisherId = publisherId || "";

  if (!accessToken) {
    setAuthStatus("Missing auth token.", true);
    return;
  }

  $("publisherIdInput").value = publisherId;
  $("publisherSearchInput").value = publisherId;

  $("searchInput").addEventListener("input", renderResults);
  $("statusFilter").addEventListener("change", () => {
    loadBidders().catch(error => {
      console.error("Failed to load bidders", error);
      setAuthStatus(`Failed to load bidders: ${error.message}`, true);
    });
  });
  $("reloadButton").addEventListener("click", () => {
    loadBidders().catch(error => {
      console.error("Failed to load bidders", error);
      setAuthStatus(`Failed to load bidders: ${error.message}`, true);
    });
  });
  $("exportButton").addEventListener("click", exportBidders);

  $("publisherSearchInput").addEventListener("input", () => {
    handlePublisherSearchInput().catch(error => {
      console.error("Failed to handle publisher search input", error);
    });
  });

  $("publisherSearchInput").addEventListener("change", () => {
    handlePublisherSelectionChange().catch(error => {
      console.error("Failed to handle publisher selection", error);
      setAuthStatus(`Failed to load bidders: ${error.message}`, true);
    });
  });

  if (!getActivePublisherId()) {
    setAuthStatus("Missing publisher.", true);
    return;
  }

  await resolvePublisherDisplay(getActivePublisherId());

  try {
    await loadBidders();
  } catch (error) {
    console.error("Failed to load bidders", error);
    setAuthStatus(`Failed to load bidders: ${error.message}`, true);
  }
}

init();
