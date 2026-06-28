let accessToken = "";
let publisherId = "";
let channelRows = [];
let allChannels = [];
let allChannelGroups = [];
let allBidders = [];
let allDemandSources = [];
let publisherSearchTimer = null;
let publisherSearchResults = [];
let bootstrapPublisherId = "";
let sortState = { fieldId: "name", direction: "asc" };

const CHANNEL_FIELDS = [
  { id: "status", label: "Status", exportLabel: "Status", grid: "110px", sortType: "text", selected: true },
  { id: "siteId", label: "Channel_Id", exportLabel: "Channel_Id", grid: "120px", sortType: "number", selected: false },
  { id: "name", label: "Name", exportLabel: "Name", grid: "minmax(280px, 1.5fr)", sortType: "text", selected: true },
  { id: "channelGroups", label: "Channel Groups", exportLabel: "Channel Groups", grid: "minmax(240px, 1.1fr)", sortType: "text", selected: false },
  { id: "bidFloor", label: "BidFloor", exportLabel: "BidFloor", grid: "110px", sortType: "number", selected: false },
  { id: "cpm", label: "CPM", exportLabel: "CPM", grid: "100px", sortType: "number", selected: false },
  { id: "endpointRequest", label: "ENDPOINTREQUEST", exportLabel: "ENDPOINTREQUEST", grid: "160px", sortType: "number", selected: false },
  { id: "impressions", label: "IMPRESSION", exportLabel: "IMPRESSION", grid: "130px", sortType: "number", selected: false },
  { id: "revenue", label: "REVENUE", exportLabel: "REVENUE", grid: "110px", sortType: "number", selected: false },
  { id: "bidderId", label: "Bidder_ID", exportLabel: "Bidder_ID", grid: "120px", sortType: "number", selected: false },
  { id: "bidderName", label: "Bidder Name", exportLabel: "Bidder Name", grid: "minmax(240px, 1.2fr)", sortType: "text", selected: false },
  { id: "bidderType", label: "BidderType", exportLabel: "BidderType", grid: "140px", sortType: "text", selected: false },
  { id: "priority", label: "Priority", exportLabel: "Priority", grid: "110px", sortType: "text", selected: false },
  { id: "associatedBidders", label: "ASSOCIATED BIDDERS", exportLabel: "ASSOCIATED BIDDERS", grid: "minmax(360px, 2fr)", sortType: "text", selected: true },
  { id: "bidderCount", label: "BIDDER COUNT", exportLabel: "BIDDER COUNT", grid: "130px", sortType: "number", selected: true }
];

const BIDDER_VIEW_FIELD_IDS = new Set([
  "bidderId",
  "bidderName",
  "bidderType",
  "priority",
  "associatedBidders",
  "bidderCount"
]);

const BIDDER_OPTION_FIELD_IDS = new Set([
  "bidderId",
  "bidderName",
  "bidderType",
  "priority"
]);

const BIDDER_VIEW_TRIGGER_FIELD_IDS = new Set([
  "status",
  "siteId",
  "name"
]);

function $(id) {
  return document.getElementById(id);
}

function getActivePublisherId() {
  return $("publisherIdInput")?.value.trim() || publisherId;
}

function getPublisherSearchInput() {
  return $("publisherSearchInput")?.value.trim() || "";
}

function getMappingMode() {
  return $("mappingModeFilter")?.value || "channel_to_bidder";
}

function isBidderToChannelMode() {
  return getMappingMode() === "bidder_to_channel";
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
    setPublisherHelper("Type to search publishers, then choose one to load mappings.");
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
  channelRows = [];
  allChannels = [];
  allChannelGroups = [];
  allBidders = [];
  allDemandSources = [];
  renderResults();

  if (!syncPublisherSelectionFromInput()) {
    return;
  }

  if (!getActivePublisherId()) {
    setAuthStatus("Enter a publisher to continue.", true);
    return;
  }

  try {
    await loadMappings();
  } catch (error) {
    console.error(error);
    setAuthStatus(String(error?.message || error), true);
  }
}

function createPublicaChannelUrl(siteId) {
  const activePublisherId = getActivePublisherId();
  if (!activePublisherId || !siteId) {
    return "";
  }

  return `https://app.getpublica.com/#/app/pub/${encodeURIComponent(activePublisherId)}/channel/${encodeURIComponent(siteId)}`;
}

function createPublicaBidderUrl(bidderId) {
  const activePublisherId = getActivePublisherId();
  if (!activePublisherId || !bidderId) {
    return "";
  }

  return `https://app.getpublica.com/#/app/pub/${encodeURIComponent(activePublisherId)}/bidder-settings/bidder/${encodeURIComponent(bidderId)}`;
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

function normalizeList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  return value;
}

function parseCommaSeparatedIds(value) {
  return `${value || ""}`
    .split(",")
    .map(item => Number(`${item}`.trim()))
    .filter(Number.isFinite);
}

function buildChannelGroupInfo(channelGroupsPayload) {
  const groups = Array.isArray(channelGroupsPayload?.ChannelGroups)
    ? channelGroupsPayload.ChannelGroups
    : [];
  const groupSiteMap = new Map();
  const groupById = new Map();
  const siteGroupMap = new Map();

  groups.forEach(group => {
    const groupId = Number(group?.id);
    if (!Number.isFinite(groupId)) {
      return;
    }

    const name = `${group?.Name || `Channel Group ${groupId}`}`.trim();
    const siteIds = parseCommaSeparatedIds(group?.ChannelIDs);
    const normalizedGroup = {
      id: groupId,
      name,
      label: `${groupId} - ${name}`,
      siteIds
    };

    groupById.set(groupId, normalizedGroup);
    groupSiteMap.set(groupId, siteIds);
    siteIds.forEach(siteId => {
      if (!siteGroupMap.has(siteId)) {
        siteGroupMap.set(siteId, []);
      }
      siteGroupMap.get(siteId).push(normalizedGroup);
    });
  });

  return {
    groups: Array.from(groupById.values()).sort((a, b) => a.name.localeCompare(b.name)),
    groupById,
    groupSiteMap,
    siteGroupMap
  };
}

function formatChannelStatus(value) {
  const status = Number(value);
  if (status === 2) return "Active";
  if (status === 1) return "Inactive";
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("en-US", options).format(number);
}

function getChannelMetrics(site) {
  const summary = site?.SitesCronSummary || {};
  return {
    status: formatChannelStatus(site?.Active),
    bidFloor: formatNumber(site?.BidFloor, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    cpm: formatNumber(summary?.Last24HrAverageCPM, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    endpointRequest: formatNumber(summary?.Last24HrEndpointRequests),
    impressions: formatNumber(summary?.Last24HrImpressions),
    revenue: formatNumber(summary?.Last24HrRevenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  };
}

function getChannelRawMetrics(site) {
  const summary = site?.SitesCronSummary || {};
  return {
    status: Number(site?.Active),
    bidFloor: Number(site?.BidFloor),
    cpm: Number(summary?.Last24HrAverageCPM),
    endpointRequest: Number(summary?.Last24HrEndpointRequests),
    impressions: Number(summary?.Last24HrImpressions),
    revenue: Number(summary?.Last24HrRevenue)
  };
}

function getSelectedChannelFields() {
  const inputs = Array.from(document.querySelectorAll("[data-channel-field]"));
  if (inputs.length === 0) return CHANNEL_FIELDS;

  const checkedIds = inputs
    .filter(input => input.checked)
    .map(input => input.value);
  return CHANNEL_FIELDS.filter(field => checkedIds.includes(field.id));
}

function getSelectedFieldIds() {
  const inputs = Array.from(document.querySelectorAll("[data-channel-field]"));
  if (inputs.length === 0) {
    return CHANNEL_FIELDS
      .filter(field => field.selected)
      .map(field => field.id);
  }

  return inputs
    .filter(input => input.checked)
    .map(input => input.value);
}

function areBidderOptionFieldsVisible(selectedIds = getSelectedFieldIds()) {
  return !selectedIds.some(id => BIDDER_VIEW_TRIGGER_FIELD_IDS.has(id));
}

function handleFieldSelectionChange() {
  renderFieldSelection();
  renderResults();
}

function formatChannelGroups(channelGroups = []) {
  if (!Array.isArray(channelGroups) || channelGroups.length === 0) {
    return "-";
  }

  return channelGroups
    .map(group => `${group.name || group.label || group.id || ""}`.trim())
    .filter(Boolean)
    .join("; ");
}

function formatChannelSummary(channel) {
  return [
    channel.channelName,
    `ID ${channel.siteId}`,
    formatChannelGroups(channel.channelGroups) !== "-" ? formatChannelGroups(channel.channelGroups) : ""
  ].filter(Boolean).join(" | ");
}

function formatBidderSummary(bidder) {
  return [
    bidder.name,
    bidder.bidderKey,
    `ID ${bidder.id}`,
    bidder.priority ? `P${bidder.priority}` : ""
  ].filter(Boolean).join(" | ");
}

function getFieldLabel(field) {
  if (!isBidderToChannelMode()) {
    return field.label;
  }

  if (field.id === "name") return "Bidder";
  if (field.id === "siteId") return "Bidder_ID";
  if (field.id === "associatedBidders") return "ASSOCIATED CHANNELS";
  if (field.id === "bidderCount") return "CHANNEL COUNT";
  return field.label;
}

function getFieldExportLabel(field) {
  if (!isBidderToChannelMode()) {
    return field.exportLabel;
  }

  if (field.id === "name") return "Bidder";
  if (field.id === "siteId") return "Bidder_ID";
  if (field.id === "associatedBidders") return "ASSOCIATED CHANNELS";
  if (field.id === "bidderCount") return "CHANNEL COUNT";
  return field.exportLabel;
}

function isBidderAggregateMode(selectedFields) {
  return selectedFields.length > 0 && selectedFields.every(field => BIDDER_VIEW_FIELD_IDS.has(field.id));
}

function rowLabelForSort(row) {
  return row?.isBidderAggregate
    ? `${row.bidders?.[0]?.name || ""}`
    : `${row.channelName || ""}`;
}

function getChannelFieldValue(row, fieldId) {
  if (fieldId === "siteId") return row.isBidderAggregate ? row.bidderId : row.siteId;
  if (fieldId === "name") return row.channelName;
  if (fieldId === "channelGroups") return formatChannelGroups(row.channelGroups);
  if (fieldId === "bidderId") return row.bidderId ?? "-";
  if (fieldId === "bidderName") return row.bidderName || "-";
  if (fieldId === "bidderType") return row.bidderType || "-";
  if (fieldId === "priority") return row.priority || "-";
  if (fieldId === "associatedBidders") {
    if (row.isBidderAggregate) {
      return row.channels.map(formatChannelSummary).join("; ");
    }
    return row.bidders.map(formatBidderSummary).join("; ");
  }
  if (fieldId === "bidderCount") return row.isBidderAggregate ? row.matchedChannelCount : row.bidders.length;
  return row.metrics?.[fieldId] || "-";
}

function getChannelSortValue(row, field) {
  if (field.id === "siteId") return row.isBidderAggregate ? row.bidderId : row.siteId;
  if (field.id === "name") return rowLabelForSort(row).toLowerCase();
  if (field.id === "channelGroups") return formatChannelGroups(row.channelGroups).toLowerCase();
  if (field.id === "bidderId") return Number.isFinite(row.bidderId) ? row.bidderId : Number.NEGATIVE_INFINITY;
  if (field.id === "bidderName") return `${row.bidderName || ""}`.toLowerCase();
  if (field.id === "bidderType") return `${row.bidderType || ""}`.toLowerCase();
  if (field.id === "priority") return `${row.priority || ""}`.toLowerCase();
  if (field.id === "associatedBidders") {
    if (row.isBidderAggregate) {
      return row.channels.map(channel => channel.channelName).join(" ").toLowerCase();
    }
    return row.bidders.map(bidder => bidder.name).join(" ").toLowerCase();
  }
  if (field.id === "bidderCount") return row.isBidderAggregate ? row.matchedChannelCount : row.bidders.length;
  if (field.sortType === "number") {
    const value = row.rawMetrics?.[field.id];
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  }
  return String(getChannelFieldValue(row, field.id) || "").toLowerCase();
}

function sortRows(rows, selectedFields) {
  if (!selectedFields.some(field => field.id === sortState.fieldId)) {
    sortState = { fieldId: selectedFields[0]?.id || "name", direction: "asc" };
  }

  const field = CHANNEL_FIELDS.find(item => item.id === sortState.fieldId) || CHANNEL_FIELDS[1];
  const direction = sortState.direction === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const aValue = getChannelSortValue(a, field);
    const bValue = getChannelSortValue(b, field);
    const aLabel = rowLabelForSort(a);
    const bLabel = rowLabelForSort(b);

    if (field.sortType === "number") {
      const aMissing = aValue === Number.NEGATIVE_INFINITY;
      const bMissing = bValue === Number.NEGATIVE_INFINITY;
      if (aMissing && bMissing) return aLabel.localeCompare(bLabel);
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (aValue === bValue) return aLabel.localeCompare(bLabel);
      return (aValue - bValue) * direction;
    }

    const compared = String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
    if (compared === 0) return aLabel.localeCompare(bLabel);
    return compared * direction;
  });
}

function setSortField(fieldId) {
  if (sortState.fieldId === fieldId) {
    sortState = {
      fieldId,
      direction: sortState.direction === "asc" ? "desc" : "asc"
    };
  } else {
    sortState = { fieldId, direction: "asc" };
  }
  renderResults();
}

function handleMappingModeChange() {
  renderFieldSelection();
  renderResults();
}

function getTableGridTemplate(fields) {
  return fields.map(field => field.grid).join(" ");
}

function renderFieldSelection() {
  const container = $("fieldSelection");
  if (!container) return;

  const selectedIds = new Set(getSelectedFieldIds());
  const showBidderOptionFields = areBidderOptionFieldsVisible(Array.from(selectedIds));

  if (!showBidderOptionFields) {
    BIDDER_OPTION_FIELD_IDS.forEach(id => selectedIds.delete(id));
  }

  container.innerHTML = "";
  CHANNEL_FIELDS.forEach(field => {
    if (BIDDER_OPTION_FIELD_IDS.has(field.id) && !showBidderOptionFields) {
      return;
    }

    const label = document.createElement("label");
    label.className = "field-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = field.id;
    input.checked = selectedIds.has(field.id);
    input.dataset.channelField = "true";
    input.addEventListener("change", handleFieldSelectionChange);

    label.appendChild(input);
    label.append(getFieldLabel(field));
    container.appendChild(label);
  });
}

function populateSelect(selectId, values, allLabel) {
  const select = $(selectId);
  const previous = select.value;
  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  select.value = values.includes(previous) ? previous : "";
}

function populateOptionSelect(selectId, items, allLabel) {
  const select = $(selectId);
  if (!select) return;

  const previous = select.value;
  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  items.forEach(item => {
    const option = document.createElement("option");
    option.value = `${item.value}`;
    option.textContent = item.label;
    select.appendChild(option);
  });

  select.value = items.some(item => `${item.value}` === previous) ? previous : "";
}

function buildBidderSiteAssociations(item, channelGroupInfo) {
  const siteAssociations = new Map();

  function ensureAssociation(siteId) {
    if (!siteAssociations.has(siteId)) {
      siteAssociations.set(siteId, {
        siteId,
        channelGroups: []
      });
    }
    return siteAssociations.get(siteId);
  }

  normalizeList(item?.SiteIDS).forEach(siteIdValue => {
    const siteId = Number(siteIdValue);
    if (Number.isFinite(siteId)) {
      ensureAssociation(siteId);
    }
  });

  normalizeList(item?.ChannelGroupIDS).forEach(groupIdValue => {
    const groupId = Number(groupIdValue);
    const group = channelGroupInfo.groupById.get(groupId);
    const groupSiteIds = channelGroupInfo.groupSiteMap.get(groupId) || [];

    groupSiteIds.forEach(siteId => {
      const association = ensureAssociation(siteId);
      if (group && !association.channelGroups.some(item => item.id === group.id)) {
        association.channelGroups.push(group);
      }
    });
  });

  return Array.from(siteAssociations.values());
}

function buildDemandSources(biddersPayload) {
  return Array.from(
    new Set(
      (Array.isArray(biddersPayload?.HeaderBidderListInfo) ? biddersPayload.HeaderBidderListInfo : [])
        .map(item => `${item?.Bidder || ""}`.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function buildChannelRows(biddersPayload, sitesPayload, channelGroupsPayload) {
  const siteMap = new Map(
    (Array.isArray(sitesPayload?.sites) ? sitesPayload.sites : [])
      .map(site => ({
        siteId: Number(site?.ID),
        name: `${site?.Name || ""}`.trim(),
        metrics: getChannelMetrics(site),
        rawMetrics: getChannelRawMetrics(site)
      }))
      .filter(site => Number.isFinite(site.siteId) && site.name)
      .map(site => [site.siteId, site])
  );

  const channelGroupInfo = buildChannelGroupInfo(channelGroupsPayload);
  const grouped = new Map();
  allDemandSources = buildDemandSources(biddersPayload);
  allChannelGroups = channelGroupInfo.groups.map(group => ({
    value: group.id,
    label: group.label
  }));

  (Array.isArray(biddersPayload?.HeaderBidderListInfo) ? biddersPayload.HeaderBidderListInfo : []).forEach(item => {
    const bidderId = Number(item?.ID);
    const bidderName = `${item?.Name || ""}`.trim();
    if (!Number.isFinite(bidderId) || !bidderName) {
      return;
    }

    const bidderKey = `${item?.Bidder || ""}`.trim();
    const priority = Number.isFinite(item?.Priority) ? String(item.Priority) : "";
    buildBidderSiteAssociations(item, channelGroupInfo).forEach(association => {
      const siteId = association.siteId;
      const site = siteMap.get(siteId);
      const channelName = site?.name || `Unknown (${siteId})`;
      const key = `${siteId}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          siteId,
          channelName,
          metrics: site?.metrics || getChannelMetrics(null),
          rawMetrics: site?.rawMetrics || getChannelRawMetrics(null),
          channelGroups: [...(channelGroupInfo.siteGroupMap.get(siteId) || [])],
          bidders: []
        });
      }

      const row = grouped.get(key);
      const existingBidder = row.bidders.find(bidder => bidder.id === bidderId);
      if (existingBidder) {
        association.channelGroups.forEach(group => {
          if (!existingBidder.channelGroups.some(item => item.id === group.id)) {
            existingBidder.channelGroups.push(group);
          }
        });
      } else {
        row.bidders.push({
          id: bidderId,
          name: bidderName,
          bidderKey,
          demandSource: bidderKey,
          channelGroups: association.channelGroups,
          priority
        });
      }
    });
  });

  const rows = Array.from(grouped.values())
    .map(row => {
      return {
        ...row,
        channelGroups: row.channelGroups.sort((a, b) => a.name.localeCompare(b.name)),
        bidders: row.bidders.sort((a, b) => a.name.localeCompare(b.name))
      };
    })
    .sort((a, b) => a.channelName.localeCompare(b.channelName));

  allChannels = rows.map(row => row.channelName);
  allBidders = Array.from(
    new Set(
      rows.flatMap(row => row.bidders.map(bidder => bidder.name))
    )
  ).sort((a, b) => a.localeCompare(b));

  return rows;
}

function getFilteredRows() {
  const channelFilter = $("channelFilter").value.trim().toLowerCase();
  const channelGroupFilter = $("channelGroupFilter")?.value.trim() || "";
  const bidderFilter = $("bidderFilter").value.trim().toLowerCase();
  const demandSourceFilter = $("demandSourceFilter")?.value.trim().toLowerCase() || "";
  const statusFilterEl = $("statusFilter");
  const statusFilter = statusFilterEl ? statusFilterEl.value.trim().toLowerCase() : "active";
  const searchFilter = $("resultFilter").value.trim().toLowerCase();

  return channelRows.filter(row => {
    const matchesChannel = !channelFilter || row.channelName.toLowerCase() === channelFilter;
    const matchesChannelGroup = !channelGroupFilter || (row.channelGroups || []).some(group => `${group.id}` === channelGroupFilter);
    const filteredBidders = row.bidders.filter(bidder => {
      const matchesBidderFilter = !bidderFilter || bidder.name.toLowerCase() === bidderFilter;
      const matchesDemandSourceFilter = !demandSourceFilter || `${bidder.demandSource || bidder.bidderKey || ""}`.toLowerCase() === demandSourceFilter;
      return matchesBidderFilter && matchesDemandSourceFilter;
    });
    const matchesBidder = !bidderFilter || filteredBidders.length > 0;
    const matchesDemandSource = !demandSourceFilter || filteredBidders.length > 0;
    const rowStatus = `${row.metrics?.status || ""}`.toLowerCase();
    const matchesStatus = !statusFilter || rowStatus === statusFilter;

    if (!matchesChannel || !matchesChannelGroup || !matchesBidder || !matchesDemandSource || !matchesStatus || filteredBidders.length === 0) {
      return false;
    }

    if (!searchFilter) {
      return true;
    }

    const haystack = [
      row.channelName,
      row.metrics?.status,
      row.metrics?.bidFloor,
      row.metrics?.cpm,
      row.metrics?.endpointRequest,
      row.metrics?.impressions,
      row.metrics?.revenue,
      formatChannelGroups(row.channelGroups),
      ...filteredBidders.map(bidder => `${bidder.name} ${bidder.demandSource || bidder.bidderKey} ${bidder.id} ${bidder.priority} ${formatChannelGroups(bidder.channelGroups)}`)
    ].join(" ").toLowerCase();

    return haystack.includes(searchFilter);
  }).map(row => ({
    ...row,
    bidders: row.bidders.filter(bidder => {
      const activeBidderFilter = $("bidderFilter").value.trim().toLowerCase();
      const activeDemandSourceFilter = $("demandSourceFilter")?.value.trim().toLowerCase() || "";
      const matchesBidderFilter = !activeBidderFilter || bidder.name.toLowerCase() === activeBidderFilter;
      const matchesDemandSourceFilter = !activeDemandSourceFilter || `${bidder.demandSource || bidder.bidderKey || ""}`.toLowerCase() === activeDemandSourceFilter;
      return matchesBidderFilter && matchesDemandSourceFilter;
    })
  }));
}

function aggregateBidderRows(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    row.bidders.forEach(bidder => {
      const key = `${bidder.id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          isBidderAggregate: true,
          siteId: "",
          channelName: bidder.name,
          bidderId: bidder.id,
          bidderName: bidder.name,
          bidderType: bidder.bidderKey,
          priority: bidder.priority ? `P${bidder.priority}` : "",
          bidders: [bidder],
          channels: [],
          channelGroups: [],
          matchedChannelCount: 0,
          statusValues: new Set(),
          bidFloorTotal: 0,
          bidFloorCount: 0,
          cpmTotal: 0,
          cpmCount: 0,
          endpointRequest: 0,
          impressions: 0,
          revenue: 0
        });
      }

      const aggregate = grouped.get(key);
      if (!aggregate.channels.some(channel => channel.siteId === row.siteId)) {
        aggregate.channels.push({
          siteId: row.siteId,
          channelName: row.channelName,
          channelGroups: row.channelGroups || [],
          metrics: row.metrics,
          rawMetrics: row.rawMetrics
        });
        aggregate.matchedChannelCount += 1;
      }
      [...(row.channelGroups || []), ...(bidder.channelGroups || [])].forEach(group => {
        if (!aggregate.channelGroups.some(item => item.id === group.id)) {
          aggregate.channelGroups.push(group);
        }
      });
      const statusValue = `${row.metrics?.status || ""}`.trim();
      if (statusValue) {
        aggregate.statusValues.add(statusValue);
      }

      const bidFloor = row.rawMetrics?.bidFloor;
      if (Number.isFinite(bidFloor)) {
        aggregate.bidFloorTotal += bidFloor;
        aggregate.bidFloorCount += 1;
      }

      const cpm = row.rawMetrics?.cpm;
      if (Number.isFinite(cpm)) {
        aggregate.cpmTotal += cpm;
        aggregate.cpmCount += 1;
      }

      const endpointRequest = row.rawMetrics?.endpointRequest;
      if (Number.isFinite(endpointRequest)) {
        aggregate.endpointRequest += endpointRequest;
      }

      const impressions = row.rawMetrics?.impressions;
      if (Number.isFinite(impressions)) {
        aggregate.impressions += impressions;
      }

      const revenue = row.rawMetrics?.revenue;
      if (Number.isFinite(revenue)) {
        aggregate.revenue += revenue;
      }
    });
  });

  return Array.from(grouped.values()).map(row => {
    const statusValues = Array.from(row.statusValues);
    const status = statusValues.length <= 1
      ? (statusValues[0] || "-")
      : "Mixed";

    return {
      isBidderAggregate: true,
      siteId: "",
      channelName: row.channelName,
      bidderId: row.bidderId,
      bidderName: row.bidderName,
      bidderType: row.bidderType,
      priority: row.priority,
      bidders: row.bidders,
      channels: row.channels.sort((a, b) => a.channelName.localeCompare(b.channelName)),
      channelGroups: row.channelGroups.sort((a, b) => a.name.localeCompare(b.name)),
      matchedChannelCount: row.matchedChannelCount,
      metrics: {
        status,
        bidFloor: row.bidFloorCount
          ? formatNumber(row.bidFloorTotal / row.bidFloorCount, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
          : "-",
        cpm: row.cpmCount
          ? formatNumber(row.cpmTotal / row.cpmCount, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
          : "-",
        endpointRequest: formatNumber(row.endpointRequest),
        impressions: formatNumber(row.impressions),
        revenue: formatNumber(row.revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
      rawMetrics: {
        status: Number.NaN,
        bidFloor: row.bidFloorCount ? row.bidFloorTotal / row.bidFloorCount : Number.NaN,
        cpm: row.cpmCount ? row.cpmTotal / row.cpmCount : Number.NaN,
        endpointRequest: row.endpointRequest,
        impressions: row.impressions,
        revenue: row.revenue
      }
    };
  });
}

function getDisplayRows(selectedFields) {
  const filteredRows = getFilteredRows();
  if (isBidderToChannelMode() || isBidderAggregateMode(selectedFields)) {
    return aggregateBidderRows(filteredRows);
  }
  return filteredRows;
}

function toCsvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function expandRowsForExport(rows) {
  if (isBidderToChannelMode()) {
    return rows.flatMap(row => {
      if (!row.isBidderAggregate || !Array.isArray(row.channels) || row.channels.length === 0) {
        return [row];
      }

      return row.channels.map(channel => ({
        ...row,
        channels: [channel],
        channelGroups: channel.channelGroups || [],
        matchedChannelCount: 1,
        metrics: channel.metrics || row.metrics,
        rawMetrics: channel.rawMetrics || row.rawMetrics
      }));
    });
  }

  return rows.flatMap(row => {
    if (!Array.isArray(row.bidders) || row.bidders.length <= 1) {
      return [row];
    }

    return row.bidders.map(bidder => ({
      ...row,
      bidderId: bidder.id,
      bidderName: bidder.name,
      bidderType: bidder.bidderKey,
      priority: bidder.priority ? `P${bidder.priority}` : "",
      bidders: [bidder]
    }));
  });
}

function exportMappings() {
  const selectedFields = getSelectedChannelFields();
  if (selectedFields.length === 0) {
    setAuthStatus("Select at least one field to export.", true);
    return;
  }

  const rows = expandRowsForExport(sortRows(getDisplayRows(selectedFields), selectedFields));
  if (rows.length === 0) {
    setAuthStatus("No mappings available to export.", true);
    return;
  }

  const csvRows = [
    selectedFields.map(field => toCsvCell(getFieldExportLabel(field))).join(",")
  ];

  rows.forEach(row => {
    csvRows.push(
      selectedFields
        .map(field => toCsvCell(getChannelFieldValue(row, field.id)))
        .join(",")
    );
  });

  const blob = new Blob(["\uFEFF", csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "bidder-channel-mappings.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  setAuthStatus(`Exported ${rows.length} channel mapping${rows.length === 1 ? "" : "s"}.`);
}

function renderResults() {
  const container = $("results");
  const selectedFields = getSelectedChannelFields();
  const rows = sortRows(getDisplayRows(selectedFields), selectedFields);
  const gridTemplate = getTableGridTemplate(selectedFields);

  container.innerHTML = "";

  if (selectedFields.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Select at least one field.";
    container.appendChild(empty);
    return;
  }

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = channelRows.length === 0
      ? "No mappings loaded yet."
      : "No channel mappings match the current filters.";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("div");
  table.className = "results-table";

  const header = document.createElement("div");
  header.className = "results-table-header";
  header.style.gridTemplateColumns = gridTemplate;
  selectedFields.forEach(field => {
    const head = document.createElement("div");
    head.className = "results-table-head";
    const sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = "sort-button";
    const fieldLabel = getFieldLabel(field);
    sortButton.textContent = fieldLabel;
    sortButton.setAttribute("aria-label", `Sort by ${fieldLabel}`);
    sortButton.addEventListener("click", () => setSortField(field.id));
    sortButton.setAttribute(
      "aria-sort",
      sortState.fieldId === field.id
        ? (sortState.direction === "asc" ? "ascending" : "descending")
        : "none"
    );

    if (sortState.fieldId === field.id) {
      const sortIndicator = document.createElement("span");
      sortIndicator.className = "sort-indicator";
      sortIndicator.textContent = sortState.direction.toUpperCase();
      sortIndicator.setAttribute("aria-hidden", "true");
      sortButton.appendChild(sortIndicator);
    }

    head.appendChild(sortButton);
    header.appendChild(head);
  });
  table.appendChild(header);

  rows.forEach(row => {
    const rowEl = document.createElement("div");
    rowEl.className = "results-table-row";
    rowEl.style.gridTemplateColumns = gridTemplate;

    selectedFields.forEach(field => {
      const cell = document.createElement("div");
      cell.className = `results-table-cell field-${field.id}`;

      if (field.id === "name") {
        const channelTitle = document.createElement("div");
        channelTitle.className = "channel-title";
        const titleLink = document.createElement("a");
        titleLink.className = row.isBidderAggregate ? "bidder-link" : "channel-link";
        titleLink.href = row.isBidderAggregate
          ? createPublicaBidderUrl(row.bidderId)
          : createPublicaChannelUrl(row.siteId);
        titleLink.target = "_blank";
        titleLink.rel = "noopener noreferrer";
        titleLink.textContent = row.channelName;
        titleLink.title = row.isBidderAggregate
          ? `Open bidder in Publica: ${row.channelName}`
          : `Open channel in Publica: ${row.channelName}`;
        channelTitle.appendChild(titleLink);
        cell.appendChild(channelTitle);
      } else if (field.id === "bidderName") {
        const bidderTitle = document.createElement("div");
        bidderTitle.className = "channel-title";
        const bidderLink = document.createElement("a");
        bidderLink.className = "bidder-link";
        bidderLink.href = createPublicaBidderUrl(row.bidderId);
        bidderLink.target = "_blank";
        bidderLink.rel = "noopener noreferrer";
        bidderLink.textContent = row.bidderName;
        bidderLink.title = `Open bidder in Publica: ${row.bidderName}`;
        bidderTitle.appendChild(bidderLink);
        cell.appendChild(bidderTitle);
      } else if (field.id === "associatedBidders") {
        const bidderList = document.createElement("div");
        bidderList.className = "bidder-list";
        if (row.isBidderAggregate) {
          row.channels.forEach(channel => {
            const chip = document.createElement("div");
            chip.className = "bidder-chip";
            const groupLabel = formatChannelGroups(channel.channelGroups);
            chip.title = `${channel.channelName} | ID ${channel.siteId} | Channel Groups ${groupLabel}`;
            const channelLink = document.createElement("a");
            channelLink.className = "channel-link";
            channelLink.href = createPublicaChannelUrl(channel.siteId);
            channelLink.target = "_blank";
            channelLink.rel = "noopener noreferrer";
            const channelName = document.createElement("strong");
            channelName.textContent = channel.channelName;
            channelLink.appendChild(channelName);
            chip.appendChild(channelLink);
            chip.append(` | ID ${channel.siteId}`);
            if (groupLabel !== "-") {
              chip.append(` | ${groupLabel}`);
            }
            bidderList.appendChild(chip);
          });
        } else {
          row.bidders.forEach(bidder => {
            const chip = document.createElement("div");
            chip.className = "bidder-chip";
            const groupLabel = formatChannelGroups(bidder.channelGroups);
            chip.title = `${bidder.name} | ${bidder.bidderKey || "-"} | ID ${bidder.id} | Priority ${bidder.priority || "-"} | Channel Groups ${groupLabel}`;
            const bidderLink = document.createElement("a");
            bidderLink.className = "bidder-link";
            bidderLink.href = createPublicaBidderUrl(bidder.id);
            bidderLink.target = "_blank";
            bidderLink.rel = "noopener noreferrer";
            const bidderName = document.createElement("strong");
            bidderName.textContent = bidder.name;
            bidderLink.appendChild(bidderName);
            chip.appendChild(bidderLink);
            if (bidder.bidderKey) {
              chip.append(` | ${bidder.bidderKey}`);
            }
            chip.append(` | ID ${bidder.id}`);
            if (bidder.priority) {
              chip.append(` | P${bidder.priority}`);
            }
            if (groupLabel !== "-") {
              chip.append(` | ${groupLabel}`);
            }
            bidderList.appendChild(chip);
          });
        }
        cell.appendChild(bidderList);
      } else {
        cell.classList.add("metric");
        cell.textContent = getChannelFieldValue(row, field.id);
      }

      rowEl.appendChild(cell);
    });

    table.appendChild(rowEl);
  });

  container.appendChild(table);
}

async function loadMappings() {
  const activePublisherId = getActivePublisherId();
  if (!activePublisherId) {
    throw new Error("Enter a publisher ID to load mappings.");
  }

  setAuthStatus("Loading channel mappings...");

  const sitesUrl =
    `https://api.getpublica.com/v2/settings/sites` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&publisher_id=${encodeURIComponent(activePublisherId)}` +
    `&preloads=SitesCronSummary` +
    `&order_by=past_week_revenue` +
    `&order_direction=desc`;

  const biddersUrl =
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

  const channelGroupsUrl =
    `https://api.getpublica.com/v1/settings/channel_groups` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&publisher_id=${encodeURIComponent(activePublisherId)}` +
    `&id_search=` +
    `&name_search=` +
    `&order_by=name` +
    `&order_direction=desc` +
    `&preloads=ChannelGroupLabels` +
    `&ui_fields=`;

  const bidderPayload = {
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

  const [sitesJson, biddersJson, channelGroupsJson] = await Promise.all([
    fetchJson(sitesUrl, { method: "GET" }),
    fetchJson(biddersUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bidderPayload)
    }),
    fetchJson(channelGroupsUrl, { method: "GET" })
  ]);

  channelRows = buildChannelRows(biddersJson, sitesJson, channelGroupsJson);
  populateSelect("channelFilter", allChannels, "All Channels");
  populateOptionSelect("channelGroupFilter", allChannelGroups, "All Channel Groups");
  populateSelect("bidderFilter", allBidders, "All Bidders");
  populateSelect("demandSourceFilter", allDemandSources, "All Demand Sources");
  renderResults();
  setAuthStatus(`Loaded ${channelRows.length} channel mapping${channelRows.length === 1 ? "" : "s"}.`);
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

  $("mappingModeFilter").addEventListener("change", handleMappingModeChange);
  $("channelFilter").addEventListener("change", renderResults);
  $("channelGroupFilter").addEventListener("change", renderResults);
  $("bidderFilter").addEventListener("change", renderResults);
  $("demandSourceFilter").addEventListener("change", renderResults);
  $("statusFilter").addEventListener("change", renderResults);
  $("resultFilter").addEventListener("input", renderResults);
  $("exportButton").addEventListener("click", exportMappings);
  renderFieldSelection();
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

  if (!getActivePublisherId()) {
    setAuthStatus("Missing publisher.", true);
    renderResults();
    return;
  }

  await resolvePublisherDisplay(getActivePublisherId());

  setAuthStatus(`Auth ready for publisher ${getActivePublisherId()}. Loading mappings...`);
  await loadMappings();
}

init().catch(error => {
  console.error("Failed to initialize Bidder/Channel Mappings", error);
  setAuthStatus(String(error?.message || error), true);
});
