let accessToken = "";
let publisherId = "";

let channels = [];
let bidders = [];
let renderedItems = [];
let rawResults = [];
let sourceRecords = [];
let currentLoadSignature = "";
let publisherSearchTimer = null;
let publisherSearchResults = [];
let bootstrapPublisherId = "";
let isConfigCollapsed = false;

function $(id) {
  return document.getElementById(id);
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
  if (el) el.textContent = text || "";
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
    setPublisherHelper("Type to search publishers, then choose one to load Live Logs.");
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
  sourceRecords = [];
  currentLoadSignature = "";
  rawResults = [];
  renderResults();

  if (!syncPublisherSelectionFromInput()) {
    return;
  }

  if (!getActivePublisherId()) {
    $("loadLogsButton").disabled = true;
    setAuthStatus("Enter a publisher to continue.", true);
    return;
  }

  $("loadLogsButton").disabled = false;

  try {
    await refreshSelectableItems();
  } catch (error) {
    console.error(error);
    setAuthStatus(String(error?.message || error), true);
  }
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

function updateConfigVisibility() {
  $("configSection")?.classList.toggle("hidden", isConfigCollapsed);
  $("results")?.classList.toggle("expanded", isConfigCollapsed);
  const button = $("toggleConfigButton");
  if (button) {
    button.textContent = isConfigCollapsed ? "Show Config" : "Hide Config";
  }
}

function getEntityType() {
  return $("entityType").value;
}

function getTrafficType() {
  return $("trafficType").value;
}

function getBidderSignalType() {
  return $("bidderSignalType")?.value || "openrtb";
}

function getBidderDemandSource() {
  return $("bidderDemandSource")?.value?.trim().toLowerCase() || "";
}

function isVastTagBidderKey(value) {
  const bidderKey = `${value || ""}`.trim().toLowerCase();
  return bidderKey === "publica" || bidderKey === "publicacampaign";
}

function getCurrentItems() {
  if (getEntityType() !== "bidder") {
    return channels;
  }

  const trafficType = getTrafficType();
  const demandSource = getBidderDemandSource();

  if (trafficType === "request" || trafficType === "response") {
    return bidders.filter(item => {
      const bidderDemandSource = `${item.demandSource || ""}`.toLowerCase();
      return !demandSource || bidderDemandSource === demandSource;
    });
  }

  if (trafficType !== "signal") {
    return bidders;
  }

  const signalType = getBidderSignalType();
  return bidders.filter(item => {
    const isVastTagBidder = isVastTagBidderKey(item.bidderKey);
    const bidderDemandSource = `${item.demandSource || ""}`.toLowerCase();

    if (signalType === "openrtb" && !isVastTagBidder) {
      return !demandSource || bidderDemandSource === demandSource;
    }

    return signalType === "vast" && isVastTagBidder;
  });
}

function shouldShowFieldSelector() {
  return (getEntityType() === "bidder" && (getTrafficType() === "request" || getTrafficType() === "response"))
    || (getEntityType() === "channel" && getTrafficType() === "request")
    || (getEntityType() === "channel" && getTrafficType() === "response")
    || (getEntityType() === "bidder" && getTrafficType() === "signal" && getBidderSignalType() === "openrtb");
}

function updateFieldSelectorVisibility() {
  const visible = shouldShowFieldSelector();
  const isChannelRequest = getEntityType() === "channel" && getTrafficType() === "request";
  const isChannelResponse = getEntityType() === "channel" && getTrafficType() === "response";
  const isBidderRequest = getEntityType() === "bidder" && getTrafficType() === "request";
  const isBidderResponse = getEntityType() === "bidder" && getTrafficType() === "response";
  const isBidderOpenRtbSignal = getEntityType() === "bidder" && getTrafficType() === "signal" && getBidderSignalType() === "openrtb";

  $("fieldSelector").classList.toggle("hidden", !visible);
  $("channelRequestFieldGroup").classList.toggle("hidden", !isChannelRequest);
  $("channelResponseFieldGroup").classList.toggle("hidden", !isChannelResponse);
  $("bidderRequestFieldGroup").classList.toggle("hidden", !isBidderRequest);
  $("bidderResponseFieldGroup").classList.toggle("hidden", !isBidderResponse);
  $("bidderSignalFieldGroup").classList.toggle("hidden", !isBidderOpenRtbSignal);

  if (isChannelRequest) {
    $("fieldSelectorTitle").textContent = "Channel Request Fields";
    $("fieldSelectorHelper").textContent = "Choose which fields to include for Channel + Request output.";
    return;
  }

  if (isChannelResponse) {
    $("fieldSelectorTitle").textContent = "Channel Response Fields";
    $("fieldSelectorHelper").textContent = "Choose which fields to include for Channel + Response output.";
    return;
  }

  if (isBidderOpenRtbSignal) {
    $("fieldSelectorTitle").textContent = "Bidder Signal Audit Columns";
    $("fieldSelectorHelper").textContent = "Choose which columns to include. Selecting openrtb-version or bidderType also groups the audit by those values.";
    return;
  }

  $("fieldSelectorTitle").textContent = isBidderResponse ? "Bidder Response Fields" : "Bidder Request Fields";
  $("fieldSelectorHelper").textContent = isBidderResponse
    ? "Choose which fields to include for Bidder + Response output."
    : "Choose which fields to include for Bidder + Request output.";
}

function updateSignalOptionsVisibility() {
  const isSignal = getTrafficType() === "signal";
  const isBidder = getEntityType() === "bidder";
  const trafficType = getTrafficType();
  const isBidderSignal = isSignal && isBidder;
  const showDemandSource =
    isBidder && (
      trafficType === "request"
      || trafficType === "response"
      || (trafficType === "signal" && getBidderSignalType() === "openrtb")
    );
  const showBidderType = isBidderSignal;
  const showBidderFilterSection = showBidderType || showDemandSource;

  $("bidderFilterSection").classList.toggle("hidden", !showBidderFilterSection);
  $("bidderSignalTypeField").classList.toggle("hidden", !showBidderType);
  $("bidderDemandSourceField").classList.toggle("hidden", !showDemandSource);
}

function getSelectedBidderFields() {
  return {
    timestamp: $("fieldRequestTimestamp").checked,
    bidderType: $("fieldBidderType").checked,
    bidRequest: $("fieldBidRequest").checked,
    endpointRequest: $("fieldEndpointRequest").checked
  };
}

function getSelectedBidderResponseFields() {
  return {
    timestamp: $("fieldResponseTimestamp").checked,
    bidderType: $("fieldResponseBidderType").checked,
    bidRequest: $("fieldResponseBidRequest").checked,
    originalBidResponse: $("fieldOriginalBidResponse").checked,
    originalVast: $("fieldOriginalVast").checked,
    unwrappedVast: $("fieldUnwrappedVast").checked
  };
}

function getSelectedChannelRequestFields() {
  return {
    timestamp: $("fieldChannelRequestTimestamp").checked,
    request: $("fieldChannelRequestRequest").checked,
    OriginalEndpointURI: $("fieldChannelRequestOriginalEndpointUri").checked,
    userAgent: $("fieldChannelRequestUserAgent").checked
  };
}

function getSelectedBidderSignalFields() {
  return {
    openRtbVersion: $("fieldSignalOpenRtbVersion").checked,
    bidderType: $("fieldSignalBidderType").checked,
    signalPath: $("fieldSignalPath").checked,
    recordsWithValue: $("fieldSignalRecordsWithValue").checked,
    populationPct: $("fieldSignalPopulationPct").checked
  };
}

function getBidderSignalColumns() {
  const selectedFields = getSelectedBidderSignalFields();
  const columns = [];

  if (selectedFields.openRtbVersion) {
    columns.push("openrtb-version");
  }

  if (selectedFields.bidderType) {
    columns.push("bidderType");
  }

  if (selectedFields.signalPath) {
    columns.push("signalpath");
  }

  if (selectedFields.recordsWithValue) {
    columns.push("recordswithvalue");
  }

  if (selectedFields.populationPct) {
    columns.push("populationpc");
  }

  return columns;
}

function getSelectedChannelResponseFields() {
  return {
    timestamp: $("fieldChannelResponseTimestamp").checked,
    request: $("fieldChannelResponseRequest").checked,
    response: $("fieldChannelResponseResponse").checked,
    vastxml: $("fieldChannelResponseVastXml").checked
  };
}

function formatEntryFromSource(entry) {
  if (!entry?.sourceType || !entry?.sourceData) {
    return entry;
  }

  let valueObject = null;
  let columns = null;

  if (entry.sourceType === "channel-request") {
    valueObject = buildChannelRequestValue(entry.sourceData, entry.timestamp || "");
    columns = getChannelRequestColumns();
  } else if (entry.sourceType === "channel-response") {
    valueObject = buildChannelResponseValue(entry.sourceData);
    columns = getChannelResponseColumns();
  } else if (entry.sourceType === "bidder-request") {
    valueObject = buildBidderRequestValue(entry.sourceData);
    columns = getBidderRequestColumns();
  } else if (entry.sourceType === "bidder-response") {
    valueObject = buildBidderResponseValue(entry.sourceData);
    columns = getBidderResponseColumns();
  } else {
    return entry;
  }

  const serializedValue = normalizeJsonToSingleLine(valueObject);
  if (!serializedValue || serializedValue === "{}") {
    return null;
  }

  return {
    ...entry,
    preview: serializedValue,
    value: serializedValue,
    columns,
    rowData: valueObject
  };
}

function handleFieldSelectionChange() {
  rebuildRawResultsFromSourceRecords();
  renderResults();
  setAuthStatus("Field selection updated.");
}

function getSelectedItems() {
  return Array.from($("itemSelect").selectedOptions)
    .map(option => renderedItems.find(item => item.value === option.value))
    .filter(Boolean);
}

function getCurrentLoadSignature() {
  const selectedValues = getSelectedItems()
    .map(item => item.value)
    .sort()
    .join(",");

  return JSON.stringify({
    entityType: getEntityType(),
    trafficType: getTrafficType(),
    bidderSignalType: getBidderSignalType(),
    bidderDemandSource: getBidderDemandSource(),
    selectedValues
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${text}`);
  }
  return response.json();
}

async function loadChannels() {
  const activePublisherId = getActivePublisherId();
  const url =
    `https://api.getpublica.com/v2/settings/sites` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&publisher_id=${encodeURIComponent(activePublisherId)}` +
    `&preloads=SitesCronSummary` +
    `&order_by=past_week_revenue&order_direction=desc`;

  const json = await fetchJson(url, { method: "GET" });
  const sites = Array.isArray(json?.sites) ? json.sites : [];

  channels = sites
    .map(site => {
      const siteId = Number(site?.ID);
      return {
        raw: site,
        siteId
      };
    })
    .filter(({ raw, siteId }) => raw?.UUID && raw?.Name && Number.isFinite(siteId))
    .map(({ raw, siteId }) => ({
      value: raw.UUID,
      id: siteId,
      label: `${siteId} - ${raw.Name}`,
      name: raw.Name
    }));
}

async function loadBidders() {
  const activePublisherId = getActivePublisherId();
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
    `&order_by=past_week_revenue` +
    `&order_direction=desc` +
    `&demand_sources=` +
    `&bidder_labels=` +
    `&priority=` +
    `&active=2`;

  const payload = {
    selectedChannelIds: [],
    preloads: ["SiteIDS", "ChannelGroupIDS", "HeaderBidderPastWeekSummary", "BidderLabels"],
    uiFields: [
      "id",
      "name",
      "active",
      "bidder",
      "priority",
      "flexible_bidding_enabled",
      "flexible_bidding_thresholds",
      "super_only",
      "created_at",
      "updated_at"
    ]
  };

  const json = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const bidderInfos = Array.isArray(json?.HeaderBidderListInfo) ? json.HeaderBidderListInfo : [];

  bidders = bidderInfos
    .filter(item => Number.isFinite(item?.ID) && item?.Name)
    .map(item => ({
      value: String(item.ID),
      id: item.ID,
      label: `${item.ID} - ${item.Name}`,
      name: item.Name,
      bidderKey: `${item.Bidder || ""}`.trim(),
      demandSource: `${item.Bidder || ""}`.trim()
    }));
}

function renderBidderDemandSourceOptions() {
  const select = $("bidderDemandSource");
  const selectedValue = select.value;
  const demandSources = Array.from(new Set(
    bidders
      .filter(item => !isVastTagBidderKey(item.bidderKey))
      .map(item => `${item.demandSource || ""}`.trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All Demand Sources";
  select.appendChild(allOption);

  demandSources.forEach(source => {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    select.appendChild(option);
  });

  select.value = demandSources.includes(selectedValue) || selectedValue === ""
    ? selectedValue
    : "";
}

function renderItemList() {
  const select = $("itemSelect");
  const filterText = $("itemFilter").value.trim().toLowerCase();
  const selectedValues = new Set(Array.from(select.selectedOptions).map(option => option.value));
  const items = getCurrentItems();

  renderedItems = items.filter(item => {
    if (!filterText) return true;
    return `${item.label}`.toLowerCase().includes(filterText);
  });

  select.innerHTML = "";

  if (renderedItems.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No matching items";
    option.disabled = true;
    select.appendChild(option);
    return;
  }

  renderedItems.forEach(item => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    option.selected = selectedValues.has(item.value);
    select.appendChild(option);
  });
}

function buildPreview(entry) {
  return `${entry?.preview || entry?.value || ""}`.trim();
}

function getEntrySearchText(entry) {
  if (entry?.rowData && typeof entry.rowData === "object") {
    return JSON.stringify(entry.rowData);
  }

  return `${entry?.preview || ""} ${entry?.value || ""}`.trim();
}

function getGridTemplate(columnCount) {
  return `repeat(${Math.max(columnCount, 1)}, minmax(220px, 1fr))`;
}

function getTableGridTemplate(columns, entry) {
  if (entry?.sourceType === "channel-eleaai") {
    const columnWidths = {
      Preview: "minmax(240px, 280px)",
      timestamp: "minmax(200px, 1fr)",
      BidderName: "minmax(180px, 1fr)",
      DemandSource: "minmax(160px, 1fr)",
      "Channel Name": "minmax(220px, 1fr)",
      Adomain: "minmax(180px, 1fr)",
      "RecognitionResult.EnrichedAdomain": "minmax(220px, 1fr)",
      "RecognitionResult.DetectedLanguage": "minmax(180px, 1fr)",
      "RecognitionResult.EnrichedCategory": "minmax(220px, 1fr)"
    };
    return columns.map(column => columnWidths[column] || "minmax(180px, 1fr)").join(" ");
  }

  return getGridTemplate(columns.length);
}

function pausePreviewVideo(video) {
  if (!video) return;
  video.dataset.previewPaused = "true";
  try {
    video.pause();
  } catch {
    // no-op
  }
}

function tryPlayPreviewVideo(video) {
  if (!video) return;
  video.dataset.previewPaused = "false";
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function initializePreviewVideo(video) {
  if (!video) return;

  const stopAt = 3;
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.preload = "metadata";
  video.dataset.previewPaused = "false";
  video.dataset.previewHovering = "false";

  const maybePauseAtPreviewPoint = () => {
    if (video.dataset.previewHovering === "true") return;
    if (video.dataset.previewPaused === "true") return;
    if (video.currentTime >= stopAt) {
      pausePreviewVideo(video);
    }
  };

  video.addEventListener("loadedmetadata", () => {
    video.currentTime = 0;
    tryPlayPreviewVideo(video);
  });
  video.addEventListener("timeupdate", maybePauseAtPreviewPoint);
  video.addEventListener("mouseenter", () => {
    video.dataset.previewHovering = "true";
    tryPlayPreviewVideo(video);
  });
  video.addEventListener("mouseleave", () => {
    video.dataset.previewHovering = "false";
    pausePreviewVideo(video);
  });
}

function createEleaAiPreviewCell(item) {
  const wrapper = document.createElement("div");
  wrapper.className = "results-table-cell preview-cell";

  const previewUrl = `${item?.rowData?.Preview || ""}`.trim();
  if (!previewUrl) {
    const empty = document.createElement("div");
    empty.className = "video-preview-empty";
    empty.textContent = "No media file";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const link = document.createElement("a");
  link.className = "video-preview-link";
  link.href = previewUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = "Open media file in new tab";

  const video = document.createElement("video");
  video.className = "video-preview";
  video.src = previewUrl;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  initializePreviewVideo(video);

  link.appendChild(video);
  wrapper.appendChild(link);
  return wrapper;
}

function createEleaAiMetadataRow(label, value) {
  const row = document.createElement("div");
  row.className = "eleaai-meta-row";

  const labelEl = document.createElement("div");
  labelEl.className = "eleaai-meta-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "eleaai-meta-value";
  valueEl.textContent = `${value || ""}`.trim() || " ";

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function normalizeDomainHref(value) {
  const text = `${value || ""}`.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

function formatEleaAiValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => formatEleaAiValue(item))
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object") {
    return normalizeJsonToSingleLine(value);
  }

  return `${value || ""}`.trim();
}

function createEleaAiMetadataLinkRow(label, value) {
  const row = document.createElement("div");
  row.className = "eleaai-meta-row";

  const labelEl = document.createElement("div");
  labelEl.className = "eleaai-meta-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "eleaai-meta-value";

  const text = `${value || ""}`.trim();
  if (!text) {
    valueEl.textContent = " ";
  } else {
    const link = document.createElement("a");
    link.href = normalizeDomainHref(text);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    valueEl.appendChild(link);
  }

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function createEleaAiCard(item) {
  const card = document.createElement("div");
  card.className = "eleaai-card";

  const tile = document.createElement("div");
  tile.className = "eleaai-tile";
  const previewCell = createEleaAiPreviewCell(item);
  tile.appendChild(previewCell.firstChild || previewCell);

  const meta = document.createElement("div");
  meta.className = "eleaai-meta";
  meta.appendChild(createEleaAiMetadataRow("timestamp", item?.rowData?.timestamp));
  meta.appendChild(createEleaAiMetadataRow("Bidder Name", item?.rowData?.BidderName));
  meta.appendChild(createEleaAiMetadataRow("Demand Source", item?.rowData?.DemandSource));
  meta.appendChild(createEleaAiMetadataRow("Channel Name", item?.rowData?.["Channel Name"]));
  meta.appendChild(createEleaAiMetadataLinkRow("Adomain", item?.rowData?.Adomain));
  meta.appendChild(createEleaAiMetadataLinkRow("Recognition Result Adomain", item?.rowData?.["RecognitionResult.EnrichedAdomain"]));
  meta.appendChild(createEleaAiMetadataRow("Recognition Result Language", item?.rowData?.["RecognitionResult.DetectedLanguage"]));
  meta.appendChild(createEleaAiMetadataRow("Recognition Result Category", item?.rowData?.["RecognitionResult.EnrichedCategory"]));

  card.appendChild(tile);
  card.appendChild(meta);
  return card;
}

function detectEntryKind(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "text";
    if (/^<VAST[\s\S]*<\/VAST>$/i.test(text)) return "xml";
    try {
      JSON.parse(text);
      return "json";
    } catch {
      return "text";
    }
  }

  if (value && typeof value === "object") {
    return "json";
  }

  return "text";
}

function serializeEntryValue(value) {
  if (typeof value === "string") {
    return value;
  }

  return normalizeJsonToSingleLine(value);
}

function createCellEntry(item, column, value) {
  const serializedValue = serializeEntryValue(value);
  return {
    title: `${item?.title || "Entry"} - ${column}`,
    kind: detectEntryKind(value),
    preview: serializedValue,
    value: serializedValue
  };
}

function openResult(entry) {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(`log-viewer:${key}`, JSON.stringify(entry));

  const url = new URL(chrome.runtime.getURL("log-viewer.html"));
  url.searchParams.set("key", key);
  url.searchParams.set("title", entry?.title || "Log Viewer");

  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function getFilteredResults() {
  const filterText = $("resultFilter").value.trim().toLowerCase();
  return rawResults.filter(item => {
    const haystack = getEntrySearchText(item).toLowerCase();
    return !filterText || haystack.includes(filterText);
  });
}

function toCsvCell(value) {
  const text = typeof value === "string" ? value : normalizeJsonToSingleLine(value);
  return String(text ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function buildCsvRows(entries) {
  if (entries.length === 0) {
    return [];
  }

  const tableEntry = entries.find(item => Array.isArray(item?.columns) && item?.rowData);
  if (tableEntry) {
    const columns = tableEntry.columns;
    const rows = [columns.map(toCsvCell).join("\t")];

    entries.forEach(entry => {
      rows.push(columns.map(column => toCsvCell(entry?.rowData?.[column])).join("\t"));
    });

    return rows;
  }

  const columns = ["title", "kind", "value"];
  const rows = [columns.map(toCsvCell).join("\t")];

  entries.forEach(entry => {
    rows.push([
      toCsvCell(entry?.title || ""),
      toCsvCell(entry?.kind || ""),
      toCsvCell(entry?.value || "")
    ].join("\t"));
  });

  return rows;
}

function exportResultsAsCsv() {
  const entries = getFilteredResults();
  if (entries.length === 0) {
    setAuthStatus("No output available to export.", true);
    return;
  }

  const csvText = buildCsvRows(entries).join("\n");
  const blob = new Blob(["\uFEFF", csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `live-logs-${getEntityType()}-${getTrafficType()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function renderResults() {
  const container = $("results");
  const filtered = getFilteredResults();

  container.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = rawResults.length === 0
      ? "No output loaded yet."
      : "No output matches the current filter.";
    container.appendChild(empty);
    return;
  }

  if (filtered[0]?.sourceType === "channel-eleaai") {
    const cards = document.createElement("div");
    cards.className = "eleaai-cards";
    filtered.forEach(item => {
      cards.appendChild(createEleaAiCard(item));
    });
    container.appendChild(cards);
    return;
  }

  const tableEntry = filtered.find(item => Array.isArray(item?.columns) && item?.rowData);
  if (tableEntry) {
    const columns = tableEntry.columns;
    const table = document.createElement("div");
    table.className = "results-table";

    const header = document.createElement("div");
    header.className = "results-table-header";
    header.style.gridTemplateColumns = getTableGridTemplate(columns, tableEntry);

    columns.forEach(column => {
      const head = document.createElement("div");
      head.className = "results-table-head";
      head.textContent = column;
      header.appendChild(head);
    });

    table.appendChild(header);

    filtered.forEach(item => {
      const row = document.createElement("div");
      row.className = "results-table-row";
      row.style.gridTemplateColumns = getTableGridTemplate(columns, item);

      columns.forEach(column => {
        if (item?.sourceType === "channel-eleaai" && column === "Preview") {
          row.appendChild(createEleaAiPreviewCell(item));
          return;
        }

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "results-table-cell";
        const value = item?.rowData?.[column];
        cell.textContent = typeof value === "string" ? value : normalizeJsonToSingleLine(value);
        cell.title = cell.textContent;
        cell.addEventListener("click", () => {
          if ((column === "signalPath" || column === "signalpath") && Array.isArray(item?.signalValues)) {
            openSignalValueDetail(item);
            return;
          }
          openResult(createCellEntry(item, column, value));
        });
        row.appendChild(cell);
      });

      table.appendChild(row);
    });

    container.appendChild(table);
    return;
  }

  filtered.forEach(item => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-item";
    row.title = item?.title || "Open entry";
    row.textContent = buildPreview(item);
    row.addEventListener("click", () => {
      openResult(item);
    });
    container.appendChild(row);
  });
}

function syncLabels() {
  const isBidder = getEntityType() === "bidder";
  $("itemTitle").textContent = isBidder ? "Bidders" : "Channels";
  $("itemHelper").textContent = isBidder
    ? "Choose one or more bidders."
    : "Choose one or more channels.";
  updateFieldSelectorVisibility();
  updateSignalOptionsVisibility();
}

async function refreshSelectableItems() {
  syncLabels();
  setAuthStatus("Loading selection list...");

  if (getEntityType() === "bidder") {
    await loadBidders();
    renderBidderDemandSourceOptions();
  } else {
    await loadChannels();
  }

  renderItemList();
  setAuthStatus("Auth context received successfully.");
}

async function fetchChannelRequestSourceRecords() {
  const activePublisherId = getActivePublisherId();
  const selectedChannels = getSelectedItems();
  if (selectedChannels.length === 0) {
    throw new Error("Select one or more channels first.");
  }

  const records = [];

  for (const channel of selectedChannels) {
    const url =
      `https://api.getpublica.com/v1/settings/live_logs` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(activePublisherId)}`;

    const payload = {
      type: 3030,
      site_uuid: channel.value
    };

    const json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = Array.isArray(json) ? json : [];
    rows.forEach(row => {
      const uri = `${row?.endpointURI || row?.OriginalEndpointURI || ""}`.trim();
      if (!uri) return;

      records.push({
        timestamp: `${row?.timestamp || ""}`.trim(),
        requestText: uri,
        data: {
          request: `${row?.endpointURI || ""}`.trim(),
          OriginalEndpointURI: `${row?.OriginalEndpointURI || ""}`.trim(),
          userAgent: `${row?.httpHeaders?.["User-Agent"] || row?.httpHeaders?.["X-Device-User-Agent"] || ""}`.trim()
        }
      });
    });
  }

  return records;
}

function normalizeXmlToSingleLine(xmlText) {
  return String(xmlText || "")
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJsonToSingleLine(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function parseJsonText(value) {
  if (typeof value !== "string") return value ?? null;

  const text = value.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractXmlFromValue(value) {
  if (!value) return "";

  if (typeof value === "object") {
    if (typeof value.response === "string" || typeof value.response === "object") {
      return extractXmlFromValue(value.response);
    }

    const serialized = JSON.stringify(value);
    const xmlMatch = serialized.match(/<VAST[\s\S]*<\/VAST>/i);
    return xmlMatch ? normalizeXmlToSingleLine(xmlMatch[0]) : "";
  }

  const text = `${value}`.trim();
  if (!text) return "";

  const directXmlMatch = text.match(/<VAST[\s\S]*<\/VAST>/i);
  if (directXmlMatch) {
    return normalizeXmlToSingleLine(directXmlMatch[0]);
  }

  try {
    const parsed = JSON.parse(text);
    return extractXmlFromValue(parsed);
  } catch {
    return "";
  }
}

function extractVastXml(row) {
  return extractXmlFromValue(row?.response);
}

function extractChannelResponseData(row) {
  return {
    siteUUID: `${row?.siteUUID || ""}`.trim(),
    request: `${row?.endpointURI || ""}`.trim(),
    response: Array.isArray(row?.EndpointResponseAds) ? row.EndpointResponseAds : [],
    vastxml: extractVastXml(row)
  };
}

function getChannelNameByUuid(siteUuid) {
  const channel = channels.find(item => `${item?.value || ""}`.trim() === `${siteUuid || ""}`.trim());
  return channel?.name || "";
}

function extractFirstMediaFileUrlFromVast(vastXml) {
  const xml = `${vastXml || ""}`.trim();
  if (!xml) return "";

  const mediaFileMatch = xml.match(/<MediaFile\b[^>]*>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/MediaFile>/i);
  return mediaFileMatch?.[1]?.trim() || "";
}

function buildEleaAiRowsFromRecord(record) {
  const responseAds = Array.isArray(record?.data?.response) ? record.data.response : [];
  const siteUuid = record?.data?.siteUUID || "";
  const channelName = getChannelNameByUuid(siteUuid);
  const vastXml = record?.data?.vastxml || "";
  const fallbackMediaUrl = extractFirstMediaFileUrlFromVast(vastXml);
  const columns = [
    "Preview",
    "timestamp",
    "BidderName",
    "DemandSource",
    "Channel Name",
    "Adomain",
    "RecognitionResult.EnrichedAdomain",
    "RecognitionResult.DetectedLanguage",
    "RecognitionResult.EnrichedCategory"
  ];

  return responseAds
    .map(ad => {
      const recognitionResult = ad?.RecognitionResult || {};
      const enrichedAdomain = formatEleaAiValue(recognitionResult.EnrichedAdomain);
      if (!enrichedAdomain) {
        return null;
      }

      const previewUrl = `${ad?.MediaFileURLs?.[0] || fallbackMediaUrl || ""}`.trim();
      const rowData = {
        Preview: previewUrl,
        timestamp: `${record?.timestamp || ""}`.trim(),
        BidderName: `${ad?.BidderName || ""}`.trim(),
        DemandSource: `${ad?.DemandSource || ""}`.trim(),
        "Channel Name": channelName || `${siteUuid || ""}`.trim(),
        Adomain: `${ad?.Adomain || ""}`.trim(),
        "RecognitionResult.EnrichedAdomain": enrichedAdomain,
        "RecognitionResult.DetectedLanguage": formatEleaAiValue(recognitionResult.DetectedLanguage),
        "RecognitionResult.EnrichedCategory": formatEleaAiValue(recognitionResult.EnrichedCategory)
      };

      return {
        title: `EleaAI ${rowData.timestamp}`.trim(),
        kind: "json",
        preview: rowData.Preview,
        value: normalizeJsonToSingleLine(rowData),
        columns,
        rowData,
        sourceType: "channel-eleaai",
        timestamp: rowData.timestamp
      };
    })
    .filter(Boolean);
}

function buildChannelResponseValue(data, timestamp = "") {
  const selectedFields = getSelectedChannelResponseFields();
  const valueObject = {};

  if (selectedFields.timestamp) {
    valueObject.timestamp = timestamp;
  }

  if (selectedFields.request) {
    valueObject.request = data.request;
  }

  if (selectedFields.response) {
    valueObject.response = data.response;
  }

  if (selectedFields.vastxml) {
    valueObject.vastxml = data.vastxml;
  }

  return valueObject;
}

function buildChannelRequestValue(data, timestamp = "") {
  const selectedFields = getSelectedChannelRequestFields();
  const valueObject = {};

  if (selectedFields.timestamp) {
    valueObject.timestamp = timestamp;
  }

  if (selectedFields.request) {
    valueObject.request = data.request;
  }

  if (selectedFields.OriginalEndpointURI) {
    valueObject.OriginalEndpointURI = data.OriginalEndpointURI;
  }

  if (selectedFields.userAgent) {
    valueObject["User-Agent"] = data.userAgent;
  }

  return valueObject;
}

function getChannelRequestColumns() {
  const selectedFields = getSelectedChannelRequestFields();
  const columns = [];

  if (selectedFields.timestamp) {
    columns.push("timestamp");
  }

  if (selectedFields.request) {
    columns.push("request");
  }

  if (selectedFields.OriginalEndpointURI) {
    columns.push("OriginalEndpointURI");
  }

  if (selectedFields.userAgent) {
    columns.push("User-Agent");
  }

  return columns;
}

function getChannelResponseColumns() {
  const selectedFields = getSelectedChannelResponseFields();
  const columns = [];

  if (selectedFields.timestamp) {
    columns.push("timestamp");
  }

  if (selectedFields.request) {
    columns.push("request");
  }

  if (selectedFields.response) {
    columns.push("response");
  }

  if (selectedFields.vastxml) {
    columns.push("vastxml");
  }

  return columns;
}

function extractJsonObjectFromText(text) {
  const input = `${text || ""}`;
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const candidate = input.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractBidRequestPayload(bidRequestText) {
  const text = `${bidRequestText || ""}`.trim();
  if (!text) return null;

  if (text.startsWith("GET:")) {
    const firstLine = text.split("\n")[0]?.trim() || "";
    return firstLine;
  }

  if (text.startsWith("POST:")) {
    return extractJsonObjectFromText(text);
  }

  return extractJsonObjectFromText(text) || text;
}

function extractOpenRtbVersionFromText(text) {
  const match = `${text || ""}`.match(/x-openrtb-version:\s*([^\\\s"']+)/i);
  return match ? match[1].trim() : "";
}

function extractUrlFromRequestText(input) {
  const text = `${input || ""}`.trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  if (text.startsWith("/")) {
    return text;
  }

  const getMatch = text.match(/^GET:\s*(\S+)/i);
  if (getMatch) {
    return getMatch[1];
  }

  if (text.includes("?") && !/\s/.test(text)) {
    return text;
  }

  const firstUrlMatch = text.match(/https?:\/\/\S+/i);
  return firstUrlMatch ? firstUrlMatch[0] : "";
}

function parseQueryParamsFromUrl(input) {
  const normalizedUrl = extractUrlFromRequestText(input);
  if (!normalizedUrl) return null;

  try {
    const cleanedUrl = normalizedUrl
      .replace(/\\u0026/g, "&")
      .replace(/&amp;/gi, "&");
    const queryIndex = cleanedUrl.indexOf("?");
    const hashIndex = cleanedUrl.indexOf("#");
    const rawQuery = queryIndex >= 0
      ? cleanedUrl.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
      : "";
    const params = {};

    if (!rawQuery) {
      return buildParamsFromRegex(cleanedUrl);
    }

    rawQuery.split("&").forEach(part => {
      if (!part) return;

      const equalsIndex = part.indexOf("=");
      const rawKey = equalsIndex >= 0 ? part.slice(0, equalsIndex) : part;
      const rawValue = equalsIndex >= 0 ? part.slice(equalsIndex + 1) : "";

      const key = safeDecodeURIComponent(rawKey);
      const value = safeDecodeURIComponent(rawValue);

      if (!Object.prototype.hasOwnProperty.call(params, key)) {
        params[key] = [];
      }
      params[key].push(value);
    });

    return Object.keys(params).length > 0 ? params : buildParamsFromRegex(cleanedUrl);
  } catch {
    return buildParamsFromRegex(normalizedUrl);
  }
}

function safeDecodeURIComponent(value) {
  const text = `${value ?? ""}`.replace(/\+/g, " ");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function buildParamsFromRegex(text) {
  const input = `${text ?? ""}`
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/gi, "&");
  const params = {};
  const pattern = /(?:^|[?&])([^?&=]+)=([^&]*)/g;
  let match = null;

  while ((match = pattern.exec(input)) !== null) {
    const key = safeDecodeURIComponent(match[1]);
    const value = safeDecodeURIComponent(match[2]);

    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      params[key] = [];
    }
    params[key].push(value);
  }

  return params;
}

function formatPopulationPct(count, total) {
  if (!total) return "0.00%";
  return `${((count / total) * 100).toFixed(2)}%`;
}

function formatSignalValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  return normalizeJsonToSingleLine(value);
}

function incrementValueCount(bucketMap, signalPath, rawValue) {
  const value = formatSignalValue(rawValue);
  if (`${value}`.trim() === "") {
    return;
  }

  if (!bucketMap.has(signalPath)) {
    bucketMap.set(signalPath, new Map());
  }

  const valuesMap = bucketMap.get(signalPath);
  valuesMap.set(value, (valuesMap.get(value) || 0) + 1);
}

function buildSignalValueRows(valueCounts) {
  if (!(valueCounts instanceof Map)) {
    return [];
  }

  return Array.from(valueCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([value, count]) => ({ value, count }));
}

function buildPresenceSummaryEntries(counterMap, totalRecords, titlePrefix, valueCountsBySignal = new Map()) {
  return Array.from(counterMap.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([signalPath, recordsWithValue], index) => ({
      title: `${titlePrefix} ${index + 1}`,
      kind: "json",
      preview: normalizeJsonToSingleLine({
        signalPath,
        recordsWithValue,
        populationPct: formatPopulationPct(recordsWithValue, totalRecords)
      }),
      value: normalizeJsonToSingleLine({
        signalPath,
        recordsWithValue,
        populationPct: formatPopulationPct(recordsWithValue, totalRecords)
      }),
      columns: ["signalPath", "recordsWithValue", "populationPct"],
      rowData: {
        signalPath,
        recordsWithValue,
        populationPct: formatPopulationPct(recordsWithValue, totalRecords)
      },
      signalValues: buildSignalValueRows(valueCountsBySignal.get(signalPath))
    }));
}

function buildBidderSignalRowData(group, recordsWithValue, populationTotal) {
  const selectedFields = getSelectedBidderSignalFields();
  const rowData = {};

  if (selectedFields.openRtbVersion) {
    rowData["openrtb-version"] = group.openRtbVersion;
  }

  if (selectedFields.bidderType) {
    rowData.bidderType = group.bidderType;
  }

  if (selectedFields.signalPath) {
    rowData.signalpath = group.signalPath;
  }

  if (selectedFields.recordsWithValue) {
    rowData.recordswithvalue = recordsWithValue;
  }

  if (selectedFields.populationPct) {
    rowData.populationpc = formatPopulationPct(recordsWithValue, populationTotal);
  }

  return rowData;
}

function buildBidderSignalGroupKey({ signalPath, bidderType, openRtbVersion }) {
  const selectedFields = getSelectedBidderSignalFields();
  return JSON.stringify({
    signalPath,
    bidderType: selectedFields.bidderType ? bidderType : "",
    openRtbVersion: selectedFields.openRtbVersion ? openRtbVersion : ""
  });
}

function buildBidderSignalPopulationKey({ bidderType, openRtbVersion }) {
  const selectedFields = getSelectedBidderSignalFields();
  return JSON.stringify({
    bidderType: selectedFields.bidderType ? bidderType : "",
    openRtbVersion: selectedFields.openRtbVersion ? openRtbVersion : ""
  });
}

function summarizeBidderOpenRtbSignalPaths(records, titlePrefix) {
  const counts = new Map();
  const groups = new Map();
  const populationCounts = new Map();
  const valueCountsByGroup = new Map();

  records.forEach(record => {
    const bidRequest = record?.bidRequest;
    if (!bidRequest || typeof bidRequest !== "object" || Array.isArray(bidRequest)) {
      return;
    }

    const bidderType = `${record?.bidderType || ""}`.trim();
    const openRtbVersion = `${record?.openRtbVersion || ""}`.trim();
    const populationKey = buildBidderSignalPopulationKey({ bidderType, openRtbVersion });
    populationCounts.set(populationKey, (populationCounts.get(populationKey) || 0) + 1);

    const paths = new Set();
    const valueCountsBySignal = new Map();
    collectJsonSignalStats(bidRequest, "", paths, valueCountsBySignal);

    paths.forEach(signalPath => {
      const group = { signalPath, bidderType, openRtbVersion, populationKey };
      const groupKey = buildBidderSignalGroupKey(group);
      counts.set(groupKey, (counts.get(groupKey) || 0) + 1);
      groups.set(groupKey, group);
    });

    valueCountsBySignal.forEach((valueCounts, signalPath) => {
      const groupKey = buildBidderSignalGroupKey({ signalPath, bidderType, openRtbVersion });
      if (!valueCountsByGroup.has(groupKey)) {
        valueCountsByGroup.set(groupKey, new Map());
      }

      const destinationCounts = valueCountsByGroup.get(groupKey);
      valueCounts.forEach((count, value) => {
        destinationCounts.set(value, (destinationCounts.get(value) || 0) + count);
      });
    });
  });

  const columns = getBidderSignalColumns();

  return {
    totalRecords: records.length,
    entries: Array.from(counts.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }

        const groupA = groups.get(a[0]) || {};
        const groupB = groups.get(b[0]) || {};
        return [
          groupA.openRtbVersion,
          groupA.bidderType,
          groupA.signalPath
        ].join("|").localeCompare([
          groupB.openRtbVersion,
          groupB.bidderType,
          groupB.signalPath
        ].join("|"));
      })
      .map(([groupKey, recordsWithValue], index) => {
        const group = groups.get(groupKey);
        const populationTotal = populationCounts.get(group.populationKey) || 0;
        const rowData = buildBidderSignalRowData(group, recordsWithValue, populationTotal);
        const serializedValue = normalizeJsonToSingleLine(rowData);

        return {
          title: `${titlePrefix} ${index + 1}`,
          kind: "json",
          preview: serializedValue,
          value: serializedValue,
          columns,
          rowData,
          signalValues: buildSignalValueRows(valueCountsByGroup.get(groupKey))
        };
      })
  };
}

function dedupeEntriesByValue(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = `${entry.kind}:${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectJsonSignalPaths(value, basePath = "", sink = new Set()) {
  if (value === null || value === undefined) {
    return sink;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (basePath) sink.add(basePath);
      return sink;
    }

    if (basePath) sink.add(basePath);
    value.forEach(item => {
      const childPath = `${basePath}[]`;
      if (item !== null && typeof item === "object") {
        collectJsonSignalPaths(item, childPath, sink);
      } else if (item !== undefined && item !== "") {
        sink.add(childPath);
      }
    });
    return sink;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (basePath) sink.add(basePath);
    if (keys.length === 0) {
      return sink;
    }

    keys.forEach(key => {
      const childPath = basePath ? `${basePath}.${key}` : key;
      collectJsonSignalPaths(value[key], childPath, sink);
    });
    return sink;
  }

  if (basePath && value !== "") {
    sink.add(basePath);
  }

  return sink;
}

function collectJsonSignalStats(value, basePath = "", pathSink = new Set(), valueSink = new Map()) {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (basePath) {
        pathSink.add(basePath);
      }
      return;
    }

    if (basePath) {
      pathSink.add(basePath);
    }

    value.forEach(item => {
      const childPath = `${basePath}[]`;
      if (item !== null && typeof item === "object") {
        collectJsonSignalStats(item, childPath, pathSink, valueSink);
      } else if (item !== undefined && item !== "") {
        pathSink.add(childPath);
        incrementValueCount(valueSink, childPath, item);
      }
    });
    return;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (basePath) {
      pathSink.add(basePath);
    }

    if (keys.length === 0) {
      return;
    }

    keys.forEach(key => {
      const childPath = basePath ? `${basePath}.${key}` : key;
      collectJsonSignalStats(value[key], childPath, pathSink, valueSink);
    });
    return;
  }

  if (basePath && value !== "") {
    pathSink.add(basePath);
    incrementValueCount(valueSink, basePath, value);
  }
}

function summarizeUrlSignalPaths(requestTexts, titlePrefix) {
  const counts = new Map();
  const discoveredSignals = new Set();
  const valueCountsBySignal = new Map();
  let totalRecords = 0;

  requestTexts.forEach(requestText => {
    const params = parseQueryParamsFromUrl(requestText);
    if (!params) return;

    totalRecords += 1;
    Object.entries(params).forEach(([key, values]) => {
      discoveredSignals.add(key);
      const hasNonEmptyValue = Array.isArray(values)
        && values.some(value => `${value ?? ""}`.trim() !== "");

      if (Array.isArray(values)) {
        values.forEach(value => {
          if (`${value ?? ""}`.trim() !== "") {
            incrementValueCount(valueCountsBySignal, key, value);
          }
        });
      }

      if (hasNonEmptyValue) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  });

  discoveredSignals.forEach(key => {
    if (!counts.has(key)) {
      counts.set(key, 0);
    }
  });

  return {
    totalRecords,
    entries: buildPresenceSummaryEntries(counts, totalRecords, titlePrefix, valueCountsBySignal)
  };
}

function summarizeJsonSignalPaths(records, titlePrefix) {
  const counts = new Map();
  const valueCountsBySignal = new Map();
  let totalRecords = 0;

  records.forEach(record => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return;
    }

    totalRecords += 1;
    const paths = new Set();
    collectJsonSignalStats(record, "", paths, valueCountsBySignal);
    paths.forEach(path => {
      counts.set(path, (counts.get(path) || 0) + 1);
    });
  });

  return {
    totalRecords,
    entries: buildPresenceSummaryEntries(counts, totalRecords, titlePrefix, valueCountsBySignal)
  };
}

function openSignalValueDetail(item) {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const signalPath = item?.rowData?.signalPath || item?.rowData?.signalpath || "Signal values";
  localStorage.setItem(`signal-values:${key}`, JSON.stringify({
    title: signalPath,
    values: Array.isArray(item?.signalValues) ? item.signalValues : [],
    recordsWithValue: item?.rowData?.recordsWithValue || item?.rowData?.recordswithvalue || 0,
    populationPct: item?.rowData?.populationPct || item?.rowData?.populationpc || "0.00%"
  }));

  const url = new URL(chrome.runtime.getURL("signal-values.html"));
  url.searchParams.set("key", key);
  url.searchParams.set("title", signalPath);

  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function rebuildRawResultsFromSourceRecords() {
  const trafficType = getTrafficType();
  const entityType = getEntityType();

  if (entityType === "channel" && trafficType === "request") {
    rawResults = sourceRecords.map(record => {
      const valueObject = buildChannelRequestValue(record.data || {
        request: record.requestText,
        OriginalEndpointURI: "",
        userAgent: ""
      }, record.timestamp || "");
      const serializedValue = normalizeJsonToSingleLine(valueObject);
      if (!serializedValue || serializedValue === "{}") {
        return null;
      }
      return {
        title: `Request ${record.timestamp || ""}`.trim(),
        kind: "json",
        preview: serializedValue,
        value: serializedValue,
        columns: getChannelRequestColumns(),
        rowData: valueObject,
        sourceType: "channel-request",
        sourceData: record.data || {
          request: record.requestText,
          OriginalEndpointURI: "",
          userAgent: ""
        },
        timestamp: record.timestamp || ""
      };
    }).filter(Boolean);
    return;
  }

  if (entityType === "channel" && trafficType === "response") {
    rawResults = sourceRecords.map(record => {
      const valueObject = buildChannelResponseValue(record.data, record.timestamp || "");
      const serializedValue = normalizeJsonToSingleLine(valueObject);
      if (!serializedValue || serializedValue === "{}") {
        return null;
      }

      return {
        title: `Response ${record.timestamp || ""}`.trim(),
        kind: "json",
        preview: serializedValue,
        value: serializedValue,
        columns: getChannelResponseColumns(),
        rowData: valueObject,
        sourceType: "channel-response",
        sourceData: record.data,
        timestamp: record.timestamp || ""
      };
    }).filter(Boolean);
    return;
  }

  if (entityType === "channel" && trafficType === "eleaai") {
    rawResults = sourceRecords.flatMap(record => buildEleaAiRowsFromRecord(record));
    return;
  }

  if (entityType === "bidder" && trafficType === "request") {
    rawResults = sourceRecords.map(record => {
      const valueObject = buildBidderRequestValue(record.data, record.timestamp || "");
      const serializedValue = normalizeJsonToSingleLine(valueObject);
      if (!serializedValue) {
        return null;
      }

      return {
        title: record.data.bidderType
          ? `${record.data.bidderType} request`
          : `Bidder request ${record.timestamp || ""}`.trim(),
        kind: "json",
        preview: serializedValue,
        value: serializedValue,
        columns: getBidderRequestColumns(),
        rowData: valueObject,
        sourceType: "bidder-request",
        sourceData: record.data,
        timestamp: record.timestamp || ""
      };
    }).filter(Boolean);
    return;
  }

  if (entityType === "bidder" && trafficType === "response") {
    rawResults = sourceRecords.map(record => {
      const valueObject = buildBidderResponseValue(record.data, record.timestamp || "");
      const serializedValue = normalizeJsonToSingleLine(valueObject);
      if (!serializedValue || serializedValue === "{}") {
        return null;
      }

      return {
        title: record.data.bidderType
          ? `${record.data.bidderType} response`
          : `Bidder response ${record.timestamp || ""}`.trim(),
        kind: "json",
        preview: serializedValue,
        value: serializedValue,
        columns: getBidderResponseColumns(),
        rowData: valueObject,
        sourceType: "bidder-response",
        sourceData: record.data,
        timestamp: record.timestamp || ""
      };
    }).filter(Boolean);
    return;
  }

  if (entityType === "channel" && trafficType === "signal") {
    rawResults = summarizeUrlSignalPaths(
      sourceRecords.map(record => record.requestText),
      "Channel signal"
    ).entries;
    return;
  }

  if (entityType === "bidder" && trafficType === "signal") {
    if (getBidderSignalType() === "vast") {
      rawResults = summarizeUrlSignalPaths(
        sourceRecords.map(record => record.requestText),
        "Bidder VAST signal"
      ).entries;
      return;
    }

    rawResults = summarizeBidderOpenRtbSignalPaths(
      sourceRecords.filter(record => record?.bidRequest),
      "Bidder OpenRTB signal"
    ).entries;
    return;
  }

  rawResults = [];
}

function getTimestampSortValue(record) {
  const timestamp = `${record?.timestamp || ""}`.trim();
  if (!timestamp) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortSourceRecordsNewestFirst(records) {
  return [...records].sort((a, b) => getTimestampSortValue(b) - getTimestampSortValue(a));
}

function mergeSourceRecords(records, appendMode) {
  const nextSignature = getCurrentLoadSignature();
  const shouldReset = !appendMode || currentLoadSignature !== nextSignature;

  if (shouldReset) {
    sourceRecords = sortSourceRecordsNewestFirst(records);
    currentLoadSignature = nextSignature;
    rebuildRawResultsFromSourceRecords();
    return records.length;
  }

  const seenTimestamps = new Set(sourceRecords.map(record => `${record.timestamp || ""}`));
  let addedCount = 0;

  records.forEach(record => {
    const timestampKey = `${record.timestamp || ""}`;
    if (!timestampKey || seenTimestamps.has(timestampKey)) {
      return;
    }
    seenTimestamps.add(timestampKey);
    sourceRecords.push(record);
    addedCount += 1;
  });

  sourceRecords = sortSourceRecordsNewestFirst(sourceRecords);
  rebuildRawResultsFromSourceRecords();
  return addedCount;
}

function extractBidderRequestData(row) {
  const bidderType = `${row?.bidderType || ""}`.trim();
  const endpointRequest = `${row?.endpointRequest || row?.endpointUri || ""}`.trim();
  const debugInfoRaw = `${row?.debugInfo || ""}`.trim();

  return {
    bidderType,
    endpointRequest,
    openRtbVersion: extractOpenRtbVersionFromText(debugInfoRaw),
    bidRequest: extractBidRequestFromDebugInfo(debugInfoRaw)
  };
}

function extractBidRequestFromDebugInfo(debugInfoRaw) {
  if (!debugInfoRaw) return null;

  const extractFromParsedContainer = (container) => {
    if (!container || typeof container !== "object") {
      return null;
    }

    if (typeof container.bidRequest === "string") {
      return extractBidRequestPayload(container.bidRequest);
    }

    const responseValue = container.response;
    if (typeof responseValue === "string") {
      try {
        const nestedResponse = JSON.parse(responseValue);
        if (typeof nestedResponse?.bidRequest === "string") {
          return extractBidRequestPayload(nestedResponse.bidRequest);
        }
      } catch {
        const direct = extractJsonObjectFromText(responseValue);
        if (direct) return direct;
      }
    } else if (responseValue && typeof responseValue === "object") {
      if (typeof responseValue?.bidRequest === "string") {
        return extractBidRequestPayload(responseValue.bidRequest);
      }
    }

    return null;
  };

  try {
    const debugInfoParsed = JSON.parse(debugInfoRaw);
    const extracted = extractFromParsedContainer(debugInfoParsed);
    if (extracted) return extracted;
  } catch {
    const direct = extractJsonObjectFromText(debugInfoRaw);
    if (direct) return direct;
  }

  return extractJsonObjectFromText(debugInfoRaw);
}

function normalizeVastString(value) {
  const text = `${value || ""}`.trim();
  return text ? normalizeXmlToSingleLine(text) : "";
}

function extractBidderResponseData(row) {
  const bidderType = `${row?.bidderType || ""}`.trim();
  const debugInfoRaw = `${row?.debugInfo || ""}`.trim();
  const bidRequestSource = typeof row?.bid_request === "string" && row.bid_request.trim()
    ? row.bid_request
    : debugInfoRaw;

  const bidRequest = extractBidRequestFromDebugInfo(bidRequestSource);
  const originalBidResponse = parseJsonText(`${row?.original_bid_response || ""}`.trim());
  const originalVast = normalizeVastString(row?.original_vast);
  const unwrappedVast = normalizeVastString(row?.unwrapped_vast);

  return {
    bidderType,
    bidRequest,
    originalBidResponse,
    originalVast,
    unwrappedVast
  };
}

function buildBidderRequestValue(data, timestamp = "") {
  const selectedFields = getSelectedBidderFields();
  const valueObject = {};

  if (selectedFields.timestamp) {
    valueObject.timestamp = timestamp;
  }

  if (selectedFields.bidderType) {
    valueObject.bidderType = data.bidderType;
  }

  if (selectedFields.bidRequest) {
    valueObject.bidRequest = data.bidRequest;
  }

  if (selectedFields.endpointRequest) {
    valueObject.endpointRequest = data.endpointRequest;
  }

  return valueObject;
}

function getBidderRequestColumns() {
  const selectedFields = getSelectedBidderFields();
  const columns = [];

  if (selectedFields.timestamp) {
    columns.push("timestamp");
  }

  if (selectedFields.bidderType) {
    columns.push("bidderType");
  }

  if (selectedFields.bidRequest) {
    columns.push("bidRequest");
  }

  if (selectedFields.endpointRequest) {
    columns.push("endpointRequest");
  }

  return columns;
}

function buildBidderResponseValue(data, timestamp = "") {
  const selectedFields = getSelectedBidderResponseFields();
  const valueObject = {};

  if (selectedFields.timestamp) {
    valueObject.timestamp = timestamp;
  }

  if (selectedFields.bidderType) {
    valueObject.bidderType = data.bidderType;
  }

  if (selectedFields.bidRequest) {
    valueObject.bidRequest = data.bidRequest;
  }

  if (selectedFields.originalBidResponse) {
    valueObject.original_bid_response = data.originalBidResponse;
  }

  if (selectedFields.originalVast) {
    valueObject.original_vast = data.originalVast;
  }

  if (selectedFields.unwrappedVast) {
    valueObject.unwrapped_vast = data.unwrappedVast;
  }

  return valueObject;
}

function getBidderResponseColumns() {
  const selectedFields = getSelectedBidderResponseFields();
  const columns = [];

  if (selectedFields.timestamp) {
    columns.push("timestamp");
  }

  if (selectedFields.bidderType) {
    columns.push("bidderType");
  }

  if (selectedFields.bidRequest) {
    columns.push("bidRequest");
  }

  if (selectedFields.originalBidResponse) {
    columns.push("original_bid_response");
  }

  if (selectedFields.originalVast) {
    columns.push("original_vast");
  }

  if (selectedFields.unwrappedVast) {
    columns.push("unwrapped_vast");
  }

  return columns;
}

async function fetchChannelResponseSourceRecords() {
  const activePublisherId = getActivePublisherId();
  const selectedChannels = getSelectedItems();
  if (selectedChannels.length === 0) {
    throw new Error("Select one or more channels first.");
  }

  const records = [];

  for (const channel of selectedChannels) {
    const url =
      `https://api.getpublica.com/v1/settings/live_logs` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(activePublisherId)}`;

    const payload = {
      type: 3028,
      site_uuid: channel.value
    };

    const json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = Array.isArray(json) ? json : [];
    rows.forEach((row, rowIndex) => {
      const data = extractChannelResponseData(row);
      if (data.request || data.vastxml || (Array.isArray(data.response) && data.response.length > 0)) {
        records.push({
          timestamp: `${row?.timestamp || ""}`.trim(),
          data
        });
        return;
      }

      const rawResponse = typeof row?.response === "string"
        ? row.response.trim()
        : JSON.stringify(row?.response || "");

      if (rawResponse) {
        console.warn("Unable to extract VAST XML from response row", {
          channel: channel.label,
          rowIndex,
          row
        });
      }
    });
  }

  return records;
}

async function fetchBidderRequestSourceRecords() {
  const activePublisherId = getActivePublisherId();
  const selectedBidders = getSelectedItems();
  if (selectedBidders.length === 0) {
    throw new Error("Select one or more bidders first.");
  }

  const records = [];

  for (const bidder of selectedBidders) {
    const url =
      `https://api.getpublica.com/v1/settings/live_logs` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(activePublisherId)}`;

    const payload = {
      type: 3029,
      bid_request: {
        bids: [
          {
            headerbidder_id: Number(bidder.id)
          }
        ]
      }
    };

    const json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = Array.isArray(json) ? json : [];
    rows.forEach(row => {
      const data = extractBidderRequestData(row);
      const valueObject = buildBidderRequestValue(data);
      const serializedValue = normalizeJsonToSingleLine(valueObject);
      if (!serializedValue) {
        return;
      }

      records.push({
        timestamp: `${row?.timestamp || ""}`.trim(),
        data
      });
    });
  }

  return records;
}

async function fetchChannelSignalSourceRecords() {
  const activePublisherId = getActivePublisherId();
  const selectedChannels = getSelectedItems();
  if (selectedChannels.length === 0) {
    throw new Error("Select one or more channels first.");
  }

  const records = [];

  for (const channel of selectedChannels) {
    const url =
      `https://api.getpublica.com/v1/settings/live_logs` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(activePublisherId)}`;

    const payload = {
      type: 3030,
      site_uuid: channel.value
    };

    const json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = Array.isArray(json) ? json : [];
    rows.forEach(row => {
      const uri = `${row?.endpointURI || row?.OriginalEndpointURI || ""}`.trim();
      if (uri) {
        records.push({
          timestamp: `${row?.timestamp || ""}`.trim(),
          requestText: uri
        });
      }
    });
  }

  return records;
}

async function fetchBidderSignalSourceRecords() {
  const activePublisherId = getActivePublisherId();
  const selectedBidders = getSelectedItems();
  if (selectedBidders.length === 0) {
    throw new Error("Select one or more bidders first.");
  }

  const signalType = getBidderSignalType();
  const records = [];

  for (const bidder of selectedBidders) {
    const url =
      `https://api.getpublica.com/v1/settings/live_logs` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(activePublisherId)}`;

    const payload = {
      type: 3029,
      bid_request: {
        bids: [
          {
            headerbidder_id: Number(bidder.id)
          }
        ]
      }
    };

    const json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = Array.isArray(json) ? json : [];
    rows.forEach(row => {
      const data = extractBidderRequestData(row);

      if (signalType === "vast") {
        const requestText =
          typeof data.bidRequest === "string" && data.bidRequest.trim()
            ? data.bidRequest
            : data.endpointRequest;
        if (requestText) {
          records.push({
            timestamp: `${row?.timestamp || ""}`.trim(),
            requestText
          });
        }
        return;
      }

      if (data.bidRequest && typeof data.bidRequest === "object" && !Array.isArray(data.bidRequest)) {
        records.push({
          timestamp: `${row?.timestamp || ""}`.trim(),
          bidderType: data.bidderType,
          openRtbVersion: data.openRtbVersion,
          bidRequest: data.bidRequest
        });
      }
    });
  }

  return records;
}

async function fetchBidderResponseSourceRecords() {
  const activePublisherId = getActivePublisherId();
  const selectedBidders = getSelectedItems();
  if (selectedBidders.length === 0) {
    throw new Error("Select one or more bidders first.");
  }

  const records = [];

  for (const bidder of selectedBidders) {
    const url =
      `https://api.getpublica.com/v1/settings/live_logs` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(activePublisherId)}`;

    const payload = {
      type: 3027,
      bid_response: {
        headerbidder_id: Number(bidder.id)
      }
    };

    const json = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = Array.isArray(json) ? json : [];
    rows.forEach(row => {
      const data = extractBidderResponseData(row);
      const valueObject = buildBidderResponseValue(data);
      const serializedValue = normalizeJsonToSingleLine(valueObject);
      if (!serializedValue || serializedValue === "{}") {
        return;
      }

      records.push({
        timestamp: `${row?.timestamp || ""}`.trim(),
        data
      });
    });
  }

  return records;
}

async function loadLogs(appendMode = false) {
  const entityType = getEntityType();
  const trafficType = getTrafficType();

  if (entityType === "channel" && trafficType === "request") {
    setAuthStatus(appendMode ? "Appending live log requests..." : "Loading live log requests...");
    const records = await fetchChannelRequestSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new request record${addedCount === 1 ? "" : "s"}. Total rows: ${rawResults.length}.`
        : `Loaded ${rawResults.length} request entr${rawResults.length === 1 ? "y" : "ies"}.`
    );
    return;
  }

  if (entityType === "channel" && trafficType === "response") {
    setAuthStatus(appendMode ? "Appending live log responses..." : "Loading live log responses...");
    const records = await fetchChannelResponseSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new response record${addedCount === 1 ? "" : "s"}. Total rows: ${rawResults.length}.`
        : `Loaded ${rawResults.length} response entr${rawResults.length === 1 ? "y" : "ies"}.`
    );
    return;
  }

  if (entityType === "channel" && trafficType === "eleaai") {
    setAuthStatus(appendMode ? "Appending EleaAI responses..." : "Loading EleaAI responses...");
    const records = await fetchChannelResponseSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new EleaAI source record${addedCount === 1 ? "" : "s"}. Total rows: ${rawResults.length}.`
        : `Loaded ${rawResults.length} EleaAI entr${rawResults.length === 1 ? "y" : "ies"}.`
    );
    return;
  }

  if (entityType === "bidder" && trafficType === "request") {
    setAuthStatus(appendMode ? "Appending bidder requests..." : "Loading bidder requests...");
    const records = await fetchBidderRequestSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new bidder request record${addedCount === 1 ? "" : "s"}. Total rows: ${rawResults.length}.`
        : `Loaded ${rawResults.length} bidder request entr${rawResults.length === 1 ? "y" : "ies"}.`
    );
    return;
  }

  if (entityType === "channel" && trafficType === "signal") {
    setAuthStatus(appendMode ? "Appending channel Signal Insight..." : "Building channel Signal Insight...");
    const records = await fetchChannelSignalSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new channel request record${addedCount === 1 ? "" : "s"}. Total signals: ${rawResults.length}.`
        : `Built ${rawResults.length} channel signals from ${sourceRecords.length} request record${sourceRecords.length === 1 ? "" : "s"}.`
    );
    return;
  }

  if (entityType === "bidder" && trafficType === "signal") {
    const signalType = getBidderSignalType();
    setAuthStatus(`${appendMode ? "Appending" : "Building"} bidder Signal Insight (${signalType === "vast" ? "VAST Tag" : "OpenRTB"})...`);
    const records = await fetchBidderSignalSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new bidder ${signalType === "vast" ? "VAST Tag" : "OpenRTB"} request record${addedCount === 1 ? "" : "s"}. Total signals: ${rawResults.length}.`
        : `Built ${rawResults.length} bidder signals from ${sourceRecords.length} ${signalType === "vast" ? "VAST Tag" : "OpenRTB"} request record${sourceRecords.length === 1 ? "" : "s"}.`
    );
    return;
  }

  if (entityType === "bidder" && trafficType === "response") {
    setAuthStatus(appendMode ? "Appending bidder responses..." : "Loading bidder responses...");
    const records = await fetchBidderResponseSourceRecords();
    const addedCount = mergeSourceRecords(records, appendMode);
    renderResults();
    setAuthStatus(
      appendMode
        ? `Appended ${addedCount} new bidder response record${addedCount === 1 ? "" : "s"}. Total rows: ${rawResults.length}.`
        : `Loaded ${rawResults.length} bidder response entr${rawResults.length === 1 ? "y" : "ies"}.`
    );
    return;
  }

  sourceRecords = [];
  currentLoadSignature = "";
  rawResults = [];
  renderResults();
  setAuthStatus("This combination is not implemented yet.", true);
}

function selectAllVisibleItems() {
  Array.from($("itemSelect").options).forEach(option => {
    if (!option.disabled) option.selected = true;
  });
}

function clearVisibleItems() {
  Array.from($("itemSelect").options).forEach(option => {
    option.selected = false;
  });
}

async function init() {
  accessToken = getBootstrapQueryValue("access_token");
  publisherId = getBootstrapQueryValue("publisher_id");
  bootstrapPublisherId = publisherId || "";

  if (!accessToken) {
    setAuthStatus("Missing auth token.", true);
    $("loadLogsButton").disabled = true;
    return;
  }

  $("publisherIdInput").value = publisherId;
  $("publisherSearchInput").value = publisherId;

  $("entityType").addEventListener("change", () => {
    sourceRecords = [];
    currentLoadSignature = "";
    rawResults = [];
    refreshSelectableItems().catch(error => {
      console.error(error);
      setAuthStatus(String(error?.message || error), true);
    });
  });

  $("trafficType").addEventListener("change", () => {
    sourceRecords = [];
    currentLoadSignature = "";
    rawResults = [];
    updateFieldSelectorVisibility();
    updateSignalOptionsVisibility();
    renderItemList();
    renderResults();
  });

  $("bidderSignalType").addEventListener("change", () => {
    sourceRecords = [];
    currentLoadSignature = "";
    rawResults = [];
    updateFieldSelectorVisibility();
    updateSignalOptionsVisibility();
    renderItemList();
    renderResults();
  });

  $("bidderDemandSource").addEventListener("change", () => {
    sourceRecords = [];
    currentLoadSignature = "";
    rawResults = [];
    renderItemList();
    selectAllVisibleItems();
    renderResults();
  });

  $("publisherSearchInput").addEventListener("input", () => {
    handlePublisherSearchInput().catch(error => {
      console.error("Failed to handle publisher search input", error);
    });
  });

  $("publisherSearchInput").addEventListener("change", () => {
    handlePublisherSelectionChange().catch(error => {
      console.error("Failed to handle publisher selection", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });

  $("fieldChannelResponseRequest").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelResponseResponse").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelResponseVastXml").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelResponseTimestamp").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelRequestTimestamp").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelRequestRequest").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelRequestOriginalEndpointUri").addEventListener("change", handleFieldSelectionChange);
  $("fieldChannelRequestUserAgent").addEventListener("change", handleFieldSelectionChange);
  $("fieldBidderType").addEventListener("change", handleFieldSelectionChange);
  $("fieldBidRequest").addEventListener("change", handleFieldSelectionChange);
  $("fieldEndpointRequest").addEventListener("change", handleFieldSelectionChange);
  $("fieldRequestTimestamp").addEventListener("change", handleFieldSelectionChange);
  $("fieldResponseBidderType").addEventListener("change", handleFieldSelectionChange);
  $("fieldResponseBidRequest").addEventListener("change", handleFieldSelectionChange);
  $("fieldOriginalBidResponse").addEventListener("change", handleFieldSelectionChange);
  $("fieldOriginalVast").addEventListener("change", handleFieldSelectionChange);
  $("fieldUnwrappedVast").addEventListener("change", handleFieldSelectionChange);
  $("fieldResponseTimestamp").addEventListener("change", handleFieldSelectionChange);
  $("fieldSignalOpenRtbVersion").addEventListener("change", handleFieldSelectionChange);
  $("fieldSignalBidderType").addEventListener("change", handleFieldSelectionChange);
  $("fieldSignalPath").addEventListener("change", handleFieldSelectionChange);
  $("fieldSignalRecordsWithValue").addEventListener("change", handleFieldSelectionChange);
  $("fieldSignalPopulationPct").addEventListener("change", handleFieldSelectionChange);

  $("itemFilter").addEventListener("input", renderItemList);
  $("resultFilter").addEventListener("input", renderResults);
  $("exportCsvButton").addEventListener("click", exportResultsAsCsv);

  $("selectAllItems").addEventListener("click", () => {
    selectAllVisibleItems();
  });

  $("clearItems").addEventListener("click", () => {
    clearVisibleItems();
  });

  $("loadLogsButton").addEventListener("click", () => {
    loadLogs(false).catch(error => {
      console.error(error);
      setAuthStatus(String(error?.message || error), true);
    });
  });

  $("appendLogsButton").addEventListener("click", () => {
    loadLogs(true).catch(error => {
      console.error(error);
      setAuthStatus(String(error?.message || error), true);
    });
  });

  $("toggleConfigButton").addEventListener("click", () => {
    isConfigCollapsed = !isConfigCollapsed;
    updateConfigVisibility();
  });

  updateConfigVisibility();

  if (!getActivePublisherId()) {
    $("loadLogsButton").disabled = true;
    setAuthStatus("Missing publisher.", true);
    renderResults();
    return;
  }

  await resolvePublisherDisplay(getActivePublisherId());

  await refreshSelectableItems();
  renderResults();
}

init().catch(error => {
  console.error("Failed to initialize Live Logs", error);
  setAuthStatus(String(error?.message || error), true);
});
