let accessToken = "";
let publisherId = "";
let bidderRows = [];

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
  const activePublisherId = publisherId;
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

  if (!accessToken) {
    setAuthStatus("Missing auth token.", true);
    return;
  }

  if (!publisherId) {
    setAuthStatus("Missing publisher ID.", true);
    return;
  }

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

  try {
    await loadBidders();
  } catch (error) {
    console.error("Failed to load bidders", error);
    setAuthStatus(`Failed to load bidders: ${error.message}`, true);
  }
}

init();
