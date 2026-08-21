let accessToken = "";
let publisherId = "";
let bootstrapPublisherId = "";
let publisherSearchTimer = null;
let publisherSearchResults = [];
let channels = [];
let bidders = [];
let bidderInfos = [];
let creativeRows = [];
let filteredCreativeRows = [];
let siteIdByUuid = new Map();
let siteNameById = new Map();
const PREVIEW_SECONDS = 3;
const API_PAGE_SIZE = 25;
let PAGE_SIZE = 25;
const EXPORT_FIELDS = [
  "BidderID",
  "BidderName",
  "Adomain",
  "AdomainOverride",
  "IABCategory",
  "IABCategoryOverride",
  "Impressions",
  "BidErrorBlockedResponses",
  "BidErrors",
  "BidErrorsBrandSafety",
  "BrandSafetyRuleIDs",
  "CreativeURL",
  "OriginalCreativeURL"
];
const creativeExportCache = new Map();
let currentPage = 0;
let lastFetchedCount = 0;
let totalCreativeCount = 0;
let displayPageApiStarts = [0];
let seenCreativeUrls = new Set();
let aggregatedRows = new Map();
let displayPageCache = new Map();
let hasMoreData = true;
let fetchGeneration = 0;
const CREATIVE_REVIEW_CONFIG_HIDDEN_KEY = "creativeReviewConfigHidden";
let reviewFilters = {
  adomain_filter: "",
  bidder_filter: "",
  site_filter: "",
  demand_source_filter: "",
  bidder_group_filter: "",
  bidder_tier_filter: "",
  category_filter: "",
  enriched_by_adomain_filter: "",
  enriched_by_category_filter: "",
  creative_url_filter: ""
};


function getReviewStatusScope() {
  return $("reviewStatusScope")?.value || "0";
}

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

function setAuthStatus(text, isWarn = false) {
  const el = $("authStatus");
  el.textContent = text;
  el.classList.toggle("warn", !!isWarn);
}

function setReviewSummary(text) {
  const el = $("reviewSummary");
  if (el) el.textContent = text;
}

function setResultsCount(text) {
  const el = $("resultsCount");
  if (el) el.textContent = text;
}

function setPageLabel(text) {
  const el = $("pageLabel");
  if (el) el.textContent = text;
}

function isConfigHidden() {
  try {
    return window.localStorage.getItem(CREATIVE_REVIEW_CONFIG_HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

function setConfigHidden(hidden) {
  ["configScopeSection", "configFilterSection", "configMetaSection"].forEach(id => {
    const section = $(id);
    if (section) {
      section.hidden = !!hidden;
    }
  });

  const button = $("configToggleButton");
  if (button) {
    button.textContent = hidden ? "Show Config" : "Hide Config";
    button.setAttribute("aria-expanded", hidden ? "false" : "true");
  }

  try {
    window.localStorage.setItem(CREATIVE_REVIEW_CONFIG_HIDDEN_KEY, hidden ? "true" : "false");
  } catch {}
}

function toggleConfigVisibility() {
  setConfigHidden(!isConfigHidden());
}

function updatePaginationButtons() {
  const previousButton = $("previousPageButton");
  const nextButton = $("nextPageButton");
  if (previousButton) previousButton.disabled = currentPage <= 0;
  if (nextButton) {
    const knownNextPage = displayPageApiStarts.length > currentPage + 1;
    nextButton.disabled = !knownNextPage && !hasMoreData;
  }
}

function stopAndReleaseVideo(video) {
  if (!video) return;
  try { videoObserver.unobserve(video); } catch {}
  try { video.pause(); } catch {}
  try {
    video.removeAttribute("src");
    video.load();
  } catch {}
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${text}`);
  }
  return response.json();
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
    setPublisherHelper("Type to search publishers, then choose one to load creative review filters.");
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

function populateSelect(selectId, values, allLabel) {
  const select = $(selectId);
  const previous = select.value;
  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  values.forEach(item => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });

  select.value = values.some(item => item.value === previous) ? previous : "";
}

function toOptionList(values) {
  return Array.from(new Set(values.filter(Boolean).map(value => `${value}`.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
    .map(value => ({ value, label: value }));
}

function syncReviewFiltersFromInputs() {
  reviewFilters = {
    adomain_filter: $("adomainFilter")?.value || "",
    bidder_filter: $("bidderFilter")?.value || "",
    site_filter: $("channelFilter")?.value || "",
    demand_source_filter: $("demandSourceFilter")?.value || "",
    bidder_group_filter: $("bidderGroupFilter")?.value || "",
    bidder_tier_filter: $("bidderTierFilter")?.value || "",
    category_filter: $("categoryFilter")?.value || "",
    enriched_by_adomain_filter: $("enrichedByAdomainFilter")?.value || "",
    enriched_by_category_filter: $("enrichedByCategoryFilter")?.value || "",
    creative_url_filter: $("creativeUrlFilter")?.value.trim() || ""
  };
}

function applyReviewFiltersToInputs() {
  const fieldMap = {
    adomainFilter: reviewFilters.adomain_filter,
    bidderFilter: reviewFilters.bidder_filter,
    channelFilter: reviewFilters.site_filter,
    demandSourceFilter: reviewFilters.demand_source_filter,
    bidderGroupFilter: reviewFilters.bidder_group_filter,
    bidderTierFilter: reviewFilters.bidder_tier_filter,
    categoryFilter: reviewFilters.category_filter,
    enrichedByAdomainFilter: reviewFilters.enriched_by_adomain_filter,
    enrichedByCategoryFilter: reviewFilters.enriched_by_category_filter,
    creativeUrlFilter: reviewFilters.creative_url_filter
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    const field = $(id);
    if (field) field.value = value || "";
  });
}

function populateReviewFilterOptions() {
  populateSelect("demandSourceFilter", toOptionList(bidderInfos.map(item => item?.Bidder)), "All Demand Sources");
  populateSelect(
    "bidderGroupFilter",
    toOptionList(bidderInfos.flatMap(item => Array.isArray(item?.BidderLabels) ? item.BidderLabels.map(label => label?.Name) : [])),
    "All Bidder Groups"
  );
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeDomSafeKey(value) {
  return `${value ?? ""}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function formatReviewStatus(value) {
  const numeric = Number(value);
  if (numeric === 1) return "Approved";
  if (numeric === 2) return "Blocked";
  if (numeric === 3) return "Allowed";
  return "Pending";
}

function getCreativeReviewUpdatePayload(row, reviewStatus) {
  return {
    OriginalCreativeURL: `${row?.OriginalCreativeURL || ""}`.trim(),
    CreativeURL: `${row?.CreativeURL || row?.OriginalCreativeURL || ""}`.trim(),
    Adomain: `${row?.Adomain || ""}`.trim(),
    IABCategory: `${row?.IABCategory || ""}`.trim(),
    ReviewStatus: reviewStatus,
    Notes: `${row?.Notes || ""}`,
    AdomainOverride: `${row?.AdomainOverride || row?.Adomain || ""}`.trim(),
    AdomainEnrichedBy: `${row?.AdomainEnrichedBy || ""}`,
    IABCategoryOverride: `${row?.IABCategoryOverride || row?.IABCategory || ""}`.trim(),
    IABCategoryEnrichedBy: `${row?.CategoryEnrichedBy || row?.IABCategoryEnrichedBy || ""}`,
    BrandSafetyRuleIDs: Array.isArray(row?.BrandSafetyRuleIDs) ? row.BrandSafetyRuleIDs : []
  };
}

function createEditableMetadataRow(label, value, inputId) {
  const row = document.createElement("div");
  row.className = "meta-row";

  const labelEl = document.createElement("div");
  labelEl.className = "meta-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "meta-value";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "meta-input";
  input.value = value || "";
  input.id = inputId;

  valueEl.appendChild(input);
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
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
  siteIdByUuid = new Map();
  siteNameById = new Map();

  channels = sites
    .map(site => {
      const siteId = Number(site?.ID);
      const siteUuid = `${site?.UUID || ""}`.trim();
      const siteName = `${site?.Name || ""}`.trim();
      return {
        raw: site,
        siteId,
        siteUuid,
        siteName
      };
    })
    .filter(({ raw, siteId, siteUuid, siteName }) => raw && Number.isFinite(siteId) && siteUuid && siteName)
    .map(({ siteId, siteUuid, siteName }) => {
      const normalizedSiteId = String(siteId);
      siteIdByUuid.set(siteUuid, normalizedSiteId);
      siteNameById.set(normalizedSiteId, siteName);
      return {
        value: normalizedSiteId,
        id: siteId,
        label: `${siteId} - ${siteName}`,
        name: siteName
      };
    });
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

  bidderInfos = Array.isArray(json?.HeaderBidderListInfo) ? json.HeaderBidderListInfo : [];
  bidders = bidderInfos
    .filter(item => Number.isFinite(item?.ID) && item?.Name)
    .map(item => ({
      value: String(item.ID),
      label: `${item.ID} - ${item.Name}`
    }));
}

function getCreativeReviewUrl() {
  const activePublisherId = getActivePublisherId();
  return (
    `https://api.getpublica.com/v1/settings/publishers/${encodeURIComponent(activePublisherId)}/creative_validation/${encodeURIComponent(getReviewStatusScope())}` +
    `?access_token=${encodeURIComponent(accessToken)}`
  );
}

function getCreativeReviewPayload(page) {
  return {
    order_by: "",
    order: "desc",
    page,
    active_column_keys: ["ReviewAd", "Adomain", "IABCategory", "Impressions", "BidErrorsBrandSafety", "CPM", "BlockedRuleIDs", "BidderID"],
    creative_url_filter: reviewFilters.creative_url_filter,
    brand_safety_rule_ids: "",
    user_filter: "",
    adomain_filter: reviewFilters.adomain_filter,
    bidder_filter: reviewFilters.bidder_filter,
    site_filter: reviewFilters.site_filter,
    demand_source_filter: reviewFilters.demand_source_filter,
    bidder_group_filter: reviewFilters.bidder_group_filter,
    bidder_tier_filter: reviewFilters.bidder_tier_filter,
    category_filter: reviewFilters.category_filter
  };
}

async function fetchCreativeReviewPage(page) {
  const json = await fetchJson(getCreativeReviewUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getCreativeReviewPayload(page))
  });

  return Array.isArray(json) ? json : [];
}

function getTotalCreativeCount(rows) {
  const count = Number(rows?.[0]?.TotalCount);
  return Number.isFinite(count) && count >= 0 ? count : rows.length;
}

async function loadCreativeRows() {
  if (displayPageCache.has(currentPage)) {
    creativeRows = displayPageCache.get(currentPage);
    lastFetchedCount = creativeRows.length;
    totalCreativeCount = getTotalCreativeCount(creativeRows);
    applyResultFilters();
    clearResults();
    appendNewResults();
    return;
  }

  const gen = ++fetchGeneration;
  creativeRows = [];
  clearResults();

  const unique = [];
  let apiPage = displayPageApiStarts[currentPage] ?? 0;

  while (unique.length < PAGE_SIZE) {
    const rows = await fetchCreativeReviewPage(apiPage);
    if (gen !== fetchGeneration) return; // superseded by newer fetch

    for (const row of rows) {
      const url = `${row?.CreativeURL || ""}`.trim();
      if (!url) continue;
      if (seenCreativeUrls.has(url)) {
        const agg = aggregatedRows.get(url);
        if (agg) {
          agg.Impressions = (Number(agg.Impressions) || 0) + (Number(row.Impressions) || 0);
          agg.BidErrorBlockedResponses = (Number(agg.BidErrorBlockedResponses) || 0) + (Number(row.BidErrorBlockedResponses) || 0);
          agg.BidErrors = (Number(agg.BidErrors) || 0) + (Number(row.BidErrors) || 0);
          agg.BidErrorsBrandSafety = (Number(agg.BidErrorsBrandSafety) || 0) + (Number(row.BidErrorsBrandSafety) || 0);
          updateAggregatedCardFields(agg);
        }
      } else {
        seenCreativeUrls.add(url);
        const agg = {
          ...row,
          Impressions: Number(row.Impressions) || 0,
          BidErrorBlockedResponses: Number(row.BidErrorBlockedResponses) || 0,
          BidErrors: Number(row.BidErrors) || 0,
          BidErrorsBrandSafety: Number(row.BidErrorsBrandSafety) || 0
        };
        aggregatedRows.set(url, agg);
        unique.push(agg);
        if (unique.length >= PAGE_SIZE) break;
      }
    }

    creativeRows = [...unique];
    applyResultFilters();
    appendNewResults();

    if (rows.length < API_PAGE_SIZE) {
      hasMoreData = false;
      break;
    }

    apiPage++;
    if (unique.length >= PAGE_SIZE) {
      hasMoreData = true;
      break;
    }
  }

  if (gen !== fetchGeneration) return;

  if (displayPageApiStarts.length <= currentPage + 1) {
    displayPageApiStarts.push(apiPage);
  }

  lastFetchedCount = unique.length;
  totalCreativeCount = getTotalCreativeCount(unique);
  displayPageCache.set(currentPage, [...unique]);
}

function getCreativeExportCacheKey() {
  return JSON.stringify({
    publisherId: getActivePublisherId(),
    reviewStatusScope: getReviewStatusScope(),
    filters: reviewFilters
  });
}

function formatCsvValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(";");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsvValue(value) {
  const text = formatCsvValue(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createCreativeReviewCsv(rows) {
  const lines = [
    EXPORT_FIELDS.map(escapeCsvValue).join(","),
    ...rows.map(row => EXPORT_FIELDS.map(field => escapeCsvValue(row?.[field])).join(","))
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function aggregateRowsForExport(rows) {
  const seen = new Set();
  const aggMap = new Map();
  const ordered = [];

  for (const row of rows) {
    const url = `${row?.CreativeURL || ""}`.trim();
    if (!url) continue;
    if (seen.has(url)) {
      const agg = aggMap.get(url);
      if (agg) {
        agg.Impressions = (Number(agg.Impressions) || 0) + (Number(row.Impressions) || 0);
        agg.BidErrorBlockedResponses = (Number(agg.BidErrorBlockedResponses) || 0) + (Number(row.BidErrorBlockedResponses) || 0);
        agg.BidErrors = (Number(agg.BidErrors) || 0) + (Number(row.BidErrors) || 0);
        agg.BidErrorsBrandSafety = (Number(agg.BidErrorsBrandSafety) || 0) + (Number(row.BidErrorsBrandSafety) || 0);
      }
    } else {
      seen.add(url);
      const agg = {
        ...row,
        Impressions: Number(row.Impressions) || 0,
        BidErrorBlockedResponses: Number(row.BidErrorBlockedResponses) || 0,
        BidErrors: Number(row.BidErrors) || 0,
        BidErrorsBrandSafety: Number(row.BidErrorsBrandSafety) || 0
      };
      aggMap.set(url, agg);
      ordered.push(agg);
    }
  }

  return ordered;
}

async function loadAllCreativeRowsForExport() {
  const cacheKey = getCreativeExportCacheKey();
  const cachedRows = creativeExportCache.get(cacheKey);
  if (cachedRows) {
    return { rows: cachedRows, fromCache: true };
  }

  const firstPageRows = await fetchCreativeReviewPage(0);
  const totalCount = getTotalCreativeCount(firstPageRows);
  const totalPages = Math.ceil(totalCount / API_PAGE_SIZE);
  const rows = [...firstPageRows];

  for (let page = 1; page < totalPages; page += 1) {
    setAuthStatus(`Preparing CSV export: loading page ${page + 1} of ${totalPages}...`);
    const pageRows = await fetchCreativeReviewPage(page);
    rows.push(...pageRows);
  }

  const filtered = filterCreativeRows(rows.slice(0, totalCount));
  const completeRows = aggregateRowsForExport(filtered);
  creativeExportCache.set(cacheKey, completeRows);
  return { rows: completeRows, fromCache: false };
}

async function handleExportCsv() {
  if (!getActivePublisherId() || !accessToken) {
    throw new Error("Missing publisher or access token.");
  }

  const button = $("exportCsvButton");
  if (button) {
    button.disabled = true;
    button.textContent = "Exporting...";
  }

  try {
    setAuthStatus("Preparing CSV export: loading page 1...");
    const { rows, fromCache } = await loadAllCreativeRowsForExport();
    const filename = `creative-review-${getActivePublisherId()}-status-${getReviewStatusScope()}.csv`;
    downloadCsv(createCreativeReviewCsv(rows), filename);
    setAuthStatus(`Exported ${rows.length} creative rows to CSV${fromCache ? " from memory cache" : ""}.`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Export CSV";
    }
  }
}

function getSelectedChannelId() {
  return reviewFilters.site_filter || "";
}

function getSelectedBidderId() {
  return reviewFilters.bidder_filter || "";
}

function getSelectedMetadataFields() {
  return Array.from(document.querySelectorAll('#metaFieldSelection input[type="checkbox"]:checked'))
    .map(input => input.value);
}

function bidderMatchesSelectedChannel(row, selectedChannelId) {
  if (!selectedChannelId) {
    return true;
  }

  const bidderId = String(row?.BidderID || "");
  const bidderInfo = bidderInfos.find(item => String(item?.ID || "") === bidderId);
  if (!bidderInfo) {
    return false;
  }

  const siteIds = Array.isArray(bidderInfo?.SiteIDS) ? bidderInfo.SiteIDS.map(id => String(id)) : [];
  return siteIds.includes(selectedChannelId);
}

function filterCreativeRows(rows) {
  const selectedChannelId = getSelectedChannelId();
  const selectedBidderId = getSelectedBidderId();
  const enrichedByAdomainFilter = reviewFilters.enriched_by_adomain_filter;
  const enrichedByCategoryFilter = reviewFilters.enriched_by_category_filter;

  return rows.filter(row => {
    const bidderMatches = !selectedBidderId || String(row?.BidderID || "") === selectedBidderId;
    const channelMatches = bidderMatchesSelectedChannel(row, selectedChannelId);
    const isAdomainEnriched = Boolean(`${row?.AdomainEnrichedBy || ""}`.trim());
    const isCategoryEnriched = Boolean(`${row?.CategoryEnrichedBy || ""}`.trim());
    const adomainEnrichmentMatches =
      !enrichedByAdomainFilter || String(isAdomainEnriched) === enrichedByAdomainFilter;
    const categoryEnrichmentMatches =
      !enrichedByCategoryFilter || String(isCategoryEnriched) === enrichedByCategoryFilter;

    return bidderMatches && channelMatches && adomainEnrichmentMatches && categoryEnrichmentMatches;
  });
}

function applyResultFilters() {
  filteredCreativeRows = filterCreativeRows(creativeRows);
}

function createMetadataRow(label, value, isLink = false, href = "") {
  const row = document.createElement("div");
  row.className = "meta-row";

  const labelEl = document.createElement("div");
  labelEl.className = "meta-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "meta-value";

  if (isLink && (href || value)) {
    const link = document.createElement("a");
    link.href = href || "#";
    if (href) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    link.textContent = value;
    valueEl.appendChild(link);
  } else {
    valueEl.textContent = value || "";
  }

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function createCreativeUrlFilterValue(row) {
  const creativeUrl = `${row?.CreativeURL || ""}`.trim();
  if (!creativeUrl || !accessToken || !getActivePublisherId()) return "";

  const query = new URLSearchParams({
    access_token: accessToken,
    publisher_id: getActivePublisherId(),
    creative_url: creativeUrl,
    status_scope: getReviewStatusScope()
  });

  return `creative-review-detail.html?${query.toString()}`;
}

const videoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      if (video._previewComplete) return;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } else {
      try { video.pause(); } catch {}
    }
  });
}, { threshold: 0.5 });

function createVideoPreviewElement(url) {
  if (!url) {
    const placeholder = document.createElement("div");
    placeholder.className = "creative-placeholder";
    placeholder.textContent = "No preview URL available for this creative.";
    return placeholder;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.autoplay = false;
  video.src = url;
  video._previewComplete = false;

  const pauseVideo = () => {
    try { video.pause(); } catch {}
  };

  video.addEventListener("timeupdate", () => {
    if (!video._previewComplete && !video._hoverActive && video.currentTime >= PREVIEW_SECONDS) {
      video._previewComplete = true;
      pauseVideo();
    }
  });

  video.addEventListener("ended", () => {
    video._previewComplete = true;
  });

  video.addEventListener("mouseenter", () => {
    video._hoverActive = true;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  });

  video.addEventListener("mouseleave", () => {
    video._hoverActive = false;
    pauseVideo();
  });

  videoObserver.observe(video);

  link.appendChild(video);
  return link;
}

function appendIfSelected(container, selectedFields, fieldKey, label, value, isLink = false, href = "") {
  if (!selectedFields.includes(fieldKey)) return;
  container.appendChild(createMetadataRow(label, value, isLink, href));
}

function appendAggregatedField(container, selectedFields, fieldKey, label, value, creativeKey) {
  if (!selectedFields.includes(fieldKey)) return;
  const row = createMetadataRow(label, value);
  const valueEl = row.querySelector(".meta-value");
  if (valueEl) valueEl.dataset.aggField = `${creativeKey}:${fieldKey}`;
  container.appendChild(row);
}

function updateAggregatedCardFields(agg) {
  const key = makeDomSafeKey(`${agg.CreativeURL || agg.OriginalCreativeURL || ""}`);
  const fields = {
    Impressions: agg.Impressions,
    BidErrorBlockedResponses: agg.BidErrorBlockedResponses
  };
  Object.entries(fields).forEach(([fieldKey, val]) => {
    const el = document.querySelector(`[data-agg-field="${key}:${fieldKey}"]`);
    if (el) el.textContent = `${val}`;
  });
}

async function updateCreativeReviewStatus(row, reviewStatus) {
  return updateCreativeReviewRow(row, {
    reviewStatus,
    adomainOverride: `${row?.AdomainOverride || row?.Adomain || ""}`.trim(),
    iabCategoryOverride: `${row?.IABCategoryOverride || row?.IABCategory || ""}`.trim()
  });
}

async function updateCreativeReviewRow(row, { reviewStatus, adomainOverride, iabCategoryOverride }) {
  const activePublisherId = getActivePublisherId();
  if (!activePublisherId || !accessToken) {
    throw new Error("Missing publisher or access token.");
  }

  const url =
    `https://api.getpublica.com/v1/settings/publishers/${encodeURIComponent(activePublisherId)}/update_creative_validation` +
    `?access_token=${encodeURIComponent(accessToken)}`;

  const payload = getCreativeReviewUpdatePayload({
    ...row,
    AdomainOverride: adomainOverride,
    IABCategoryOverride: iabCategoryOverride
  }, reviewStatus);

  await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  creativeExportCache.clear();
  const targetCreativeUrl = `${row?.CreativeURL || row?.OriginalCreativeURL || ""}`.trim();
  await refreshFilters();
  setAuthStatus(`Updated creative review to ${formatReviewStatus(reviewStatus)} for ${targetCreativeUrl}.`);
}

let renderedRowCount = 0;

function clearResults() {
  const body = $("resultsBody");
  if (!body) return;
  body.querySelectorAll("video").forEach(video => stopAndReleaseVideo(video));
  body.innerHTML = "";
  renderedRowCount = 0;
}

function updateResultsStatus() {
  setResultsCount(`Showing ${filteredCreativeRows.length} of ${creativeRows.length} creative rows.`);
  setPageLabel(`Page ${currentPage + 1}`);
  updatePaginationButtons();
}

function createCard(row, selectedFields) {
    const card = document.createElement("div");
    card.className = "review-card";

    const tile = document.createElement("div");
    tile.className = "creative-tile";
    tile.appendChild(createVideoPreviewElement(`${row?.OriginalCreativeURL || ""}`.trim()));

    const metadata = document.createElement("div");
    metadata.className = "metadata";
    const creativeKey = makeDomSafeKey(`${row?.CreativeURL || row?.OriginalCreativeURL || Math.random()}`);
    appendIfSelected(metadata, selectedFields, "ReviewStatus", "Review Status", formatReviewStatus(row?.ReviewStatus));
    const creativeUrlFilterValue = createCreativeUrlFilterValue(row);
    appendIfSelected(
      metadata,
      selectedFields,
      "CreativeURL",
      "Creative URL",
      `${row?.CreativeURL ?? ""}`,
      !!creativeUrlFilterValue,
      creativeUrlFilterValue
    );
    if (selectedFields.includes("Adomain")) {
      metadata.appendChild(
        createEditableMetadataRow(
          "Adomain",
          `${row?.AdomainOverride || row?.Adomain || ""}`,
          `adomain-override-${creativeKey}`
        )
      );
    }
    appendIfSelected(
      metadata,
      selectedFields,
      "EnrichedByAdomain",
      "Enriched Adomain",
      `${Boolean(`${row?.AdomainEnrichedBy || ""}`.trim())}`
    );
    if (selectedFields.includes("IABCategory")) {
      metadata.appendChild(
        createEditableMetadataRow(
          "IAB Category",
          `${row?.IABCategoryOverride || row?.IABCategory || ""}`,
          `iab-category-override-${creativeKey}`
        )
      );
    }
    appendIfSelected(
      metadata,
      selectedFields,
      "EnrichedByCategory",
      "Enriched Category",
      `${Boolean(`${row?.CategoryEnrichedBy || ""}`.trim())}`
    );
    appendAggregatedField(metadata, selectedFields, "Impressions", "Impressions", `${row?.Impressions ?? ""}`, creativeKey);
    appendAggregatedField(metadata, selectedFields, "BidErrorBlockedResponses", "Bid Error Blocked Responses", `${row?.BidErrorBlockedResponses ?? ""}`, creativeKey);

    if (!metadata.children.length) {
      metadata.appendChild(createMetadataRow("Metadata", "No metadata fields selected."));
    }

    const actions = document.createElement("div");
    actions.className = "review-actions";
    const currentScope = getReviewStatusScope();
    const adomainInputId = `adomain-override-${creativeKey}`;
    const iabCategoryInputId = `iab-category-override-${creativeKey}`;

    const unreviewedButton = document.createElement("button");
    unreviewedButton.type = "button";
    unreviewedButton.className = "button unreviewed";
    unreviewedButton.textContent = "Unreviewed";
    unreviewedButton.disabled = currentScope === "0";
    unreviewedButton.addEventListener("click", async () => {
      unreviewedButton.disabled = true;
      reviewedButton.disabled = true;
      allowButton.disabled = true;
      blockButton.disabled = true;
      try {
        await updateCreativeReviewStatus(row, 0);
      } catch (error) {
        console.error("Failed to set creative to unreviewed", error);
        setAuthStatus(String(error?.message || error), true);
      } finally {
        const scope = getReviewStatusScope();
        unreviewedButton.disabled = scope === "0";
        reviewedButton.disabled = scope === "1";
        allowButton.disabled = Number(row?.ReviewStatus) === 3;
        blockButton.disabled = Number(row?.ReviewStatus) === 2;
      }
    });

    const reviewedButton = document.createElement("button");
    reviewedButton.type = "button";
    reviewedButton.className = "button reviewed";
    reviewedButton.textContent = "Reviewed";
    reviewedButton.disabled = currentScope === "1";
    reviewedButton.addEventListener("click", async () => {
      unreviewedButton.disabled = true;
      reviewedButton.disabled = true;
      allowButton.disabled = true;
      blockButton.disabled = true;
      try {
        await updateCreativeReviewStatus(row, 1);
      } catch (error) {
        console.error("Failed to set creative to reviewed", error);
        setAuthStatus(String(error?.message || error), true);
      } finally {
        const scope = getReviewStatusScope();
        unreviewedButton.disabled = scope === "0";
        reviewedButton.disabled = scope === "1";
        allowButton.disabled = Number(row?.ReviewStatus) === 3;
        blockButton.disabled = Number(row?.ReviewStatus) === 2;
      }
    });

    const allowButton = document.createElement("button");
    allowButton.type = "button";
    allowButton.className = "button allow";
    allowButton.textContent = "Allow";
    allowButton.disabled = Number(row?.ReviewStatus) === 3;
    allowButton.addEventListener("click", async () => {
      unreviewedButton.disabled = true;
      reviewedButton.disabled = true;
      allowButton.disabled = true;
      blockButton.disabled = true;
      try {
        await updateCreativeReviewStatus(row, 3);
      } catch (error) {
        console.error("Failed to allow creative", error);
        setAuthStatus(String(error?.message || error), true);
      } finally {
        const scope = getReviewStatusScope();
        unreviewedButton.disabled = scope === "0";
        reviewedButton.disabled = scope === "1";
        allowButton.disabled = false;
        blockButton.disabled = false;
      }
    });

    const blockButton = document.createElement("button");
    blockButton.type = "button";
    blockButton.className = "button block";
    blockButton.textContent = "Block";
    blockButton.disabled = Number(row?.ReviewStatus) === 2;
    blockButton.addEventListener("click", async () => {
      unreviewedButton.disabled = true;
      reviewedButton.disabled = true;
      allowButton.disabled = true;
      blockButton.disabled = true;
      try {
        await updateCreativeReviewStatus(row, 2);
      } catch (error) {
        console.error("Failed to block creative", error);
        setAuthStatus(String(error?.message || error), true);
      } finally {
        const scope = getReviewStatusScope();
        unreviewedButton.disabled = scope === "0";
        reviewedButton.disabled = scope === "1";
        allowButton.disabled = false;
        blockButton.disabled = false;
      }
    });

    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "button update";
    updateButton.textContent = "Update";
    updateButton.addEventListener("click", async () => {
      const adomainInput = document.getElementById(adomainInputId);
      const iabCategoryInput = document.getElementById(iabCategoryInputId);
      const nextAdomainOverride = adomainInput ? adomainInput.value.trim() : `${row?.AdomainOverride || row?.Adomain || ""}`.trim();
      const nextIabCategoryOverride = iabCategoryInput ? iabCategoryInput.value.trim() : `${row?.IABCategoryOverride || row?.IABCategory || ""}`.trim();

      unreviewedButton.disabled = true;
      reviewedButton.disabled = true;
      allowButton.disabled = true;
      blockButton.disabled = true;
      updateButton.disabled = true;
      try {
        await updateCreativeReviewRow(row, {
          reviewStatus: Number(row?.ReviewStatus || 0),
          adomainOverride: nextAdomainOverride,
          iabCategoryOverride: nextIabCategoryOverride
        });
      } catch (error) {
        console.error("Failed to update creative overrides", error);
        setAuthStatus(String(error?.message || error), true);
      } finally {
        const scope = getReviewStatusScope();
        unreviewedButton.disabled = scope === "0";
        reviewedButton.disabled = scope === "1";
        allowButton.disabled = Number(row?.ReviewStatus) === 3;
        blockButton.disabled = Number(row?.ReviewStatus) === 2;
        updateButton.disabled = false;
      }
    });

    actions.appendChild(unreviewedButton);
    actions.appendChild(reviewedButton);
    actions.appendChild(allowButton);
    actions.appendChild(blockButton);
    actions.appendChild(updateButton);
    metadata.appendChild(actions);

    card.appendChild(tile);
    card.appendChild(metadata);
    return card;
}

function appendNewResults() {
  const body = $("resultsBody");
  if (!body) return;

  const newRows = filteredCreativeRows.slice(renderedRowCount);

  if (renderedRowCount === 0 && newRows.length === 0) {
    body.innerHTML = '<div class="empty-state">No creative review rows match the current filters.</div>';
    updateResultsStatus();
    return;
  }

  const emptyState = body.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  const selectedFields = getSelectedMetadataFields();
  newRows.forEach(row => body.appendChild(createCard(row, selectedFields)));
  renderedRowCount = filteredCreativeRows.length;
  updateResultsStatus();
  setReviewSummary("Creative review results are ready. Each tile plays a short preview, resumes on hover, and opens the original creative in a new tab. Clicking Creative URL opens a filtered detail review in a new tab.");
}

function renderResults() {
  clearResults();
  appendNewResults();
}

function handleResultFilterChange() {
  applyResultFilters();
  renderResults();
}

async function refreshFilters() {
  if (!getActivePublisherId()) {
    setAuthStatus("Enter a publisher to continue.", true);
    setResultsCount("No creatives loaded yet.");
    setPageLabel("Page 1");
    lastFetchedCount = 0;
    totalCreativeCount = 0;
    updatePaginationButtons();
    return;
  }

  setAuthStatus("Loading...");

  const [, ] = await Promise.all([loadChannels(), loadBidders()]);
  populateSelect("channelFilter", channels, "All Channels");
  populateSelect("bidderFilter", bidders, "All Bidders");
  populateReviewFilterOptions();
  applyReviewFiltersToInputs();
  setAuthStatus(`Loaded ${channels.length} channels, ${bidders.length} bidders. Fetching creatives...`);

  await loadCreativeRows();
  setAuthStatus(`Loaded ${channels.length} channels, ${bidders.length} bidders, and ${creativeRows.length} creative rows.`);
}

function resetPaginationState() {
  fetchGeneration++;
  currentPage = 0;
  displayPageApiStarts = [0];
  seenCreativeUrls = new Set();
  aggregatedRows = new Map();
  displayPageCache = new Map();
  hasMoreData = true;
}

async function handlePublisherSelectionChange() {
  if (!syncPublisherSelectionFromInput()) {
    return;
  }

  resetPaginationState();
  reviewFilters = {
    adomain_filter: "",
    bidder_filter: "",
    site_filter: "",
    demand_source_filter: "",
    bidder_group_filter: "",
    bidder_tier_filter: "",
    category_filter: "",
    enriched_by_adomain_filter: "",
    enriched_by_category_filter: "",
    creative_url_filter: ""
  };
  await refreshFilters();
}

async function handleReviewStatusScopeChange() {
  resetPaginationState();
  await refreshFilters();
}

async function handleNextPage() {
  fetchGeneration++;
  currentPage += 1;
  try {
    await refreshFilters();
  } catch (error) {
    currentPage = Math.max(0, currentPage - 1);
    throw error;
  }
}

async function handlePreviousPage() {
  if (currentPage <= 0) return;
  fetchGeneration++;
  currentPage -= 1;
  try {
    await refreshFilters();
  } catch (error) {
    currentPage += 1;
    throw error;
  }
}

async function handleApplyReviewFilters() {
  syncReviewFiltersFromInputs();
  resetPaginationState();
  await refreshFilters();
}

async function handleClearReviewFilters() {
  [
    "creativeUrlFilter",
    "adomainFilter",
    "channelFilter",
    "bidderFilter",
    "demandSourceFilter",
    "bidderGroupFilter",
    "bidderTierFilter",
    "categoryFilter",
    "enrichedByAdomainFilter",
    "enrichedByCategoryFilter"
  ]
    .forEach(id => {
      const field = $(id);
      if (field) field.value = "";
    });
  syncReviewFiltersFromInputs();
  resetPaginationState();
  await refreshFilters();
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
  setConfigHidden(isConfigHidden());
  $("configToggleButton").addEventListener("click", toggleConfigVisibility);

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
  $("reviewStatusScope").addEventListener("change", () => {
    handleReviewStatusScopeChange().catch(error => {
      console.error("Failed to change review status scope", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });
  document.querySelectorAll('#metaFieldSelection input[type="checkbox"]').forEach(input => {
    input.addEventListener("change", handleResultFilterChange);
  });
  $("applyReviewFiltersButton").addEventListener("click", () => {
    handleApplyReviewFilters().catch(error => {
      console.error("Failed to apply creative review filters", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });
  $("clearReviewFiltersButton").addEventListener("click", () => {
    handleClearReviewFilters().catch(error => {
      console.error("Failed to clear creative review filters", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });
  $("nextPageButton").addEventListener("click", () => {
    handleNextPage().catch(error => {
      console.error("Failed to load next creative review page", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });
  $("previousPageButton").addEventListener("click", () => {
    handlePreviousPage().catch(error => {
      console.error("Failed to load previous creative review page", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });
  $("exportCsvButton").addEventListener("click", () => {
    handleExportCsv().catch(error => {
      console.error("Failed to export creative review CSV", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });

  $("pageSizeSelect").addEventListener("change", () => {
    PAGE_SIZE = Number($("pageSizeSelect").value) || 25;
    resetPaginationState();
    refreshFilters().catch(error => {
      console.error("Failed to reload after page size change", error);
      setAuthStatus(String(error?.message || error), true);
    });
  });

  if (!getActivePublisherId()) {
    setAuthStatus("Missing publisher.", true);
    updatePaginationButtons();
    return;
  }

  await resolvePublisherDisplay(getActivePublisherId());
  await refreshFilters();
}

init().catch(error => {
  console.error("Failed to initialize Creative Review", error);
  setAuthStatus(String(error?.message || error), true);
});
