const METRICS = [
  ["EndpointRequests", "Endpoint Requests", "count"],
  ["BidRequests", "Bid Requests", "count"],
  ["Auctions", "Auctions", "count"],
  ["BidResponses", "Bid Responses", "count"],
  ["BidResponseRate", "Bid Response Rate", "percent"],
  ["BidTimeouts", "Bid Timeouts", "count"],
  ["BidTimeoutRate", "Bid Timeout Rate", "percent"],
  ["BidErrors", "Bid Errors", "count"],
  ["BidWinRate", "Bid Win Rate", "percent"],
  ["Impressions", "Impressions", "count"],
  ["CPM", "CPM", "decimal"],
  ["Revenue", "Revenue", "decimal"],
  ["EndpointRequestsECPM", "Endpoint Requests eCPM", "decimal"],
  ["FillRate", "Fill Rate", "percent"],
  ["PodClearRate", "Pod Clear Rate", "percent"],
  ["RenderRate", "Render Rate", "percent"],
  ["WinningBids", "Winning Bids", "count"],
  ["AuctionLatency", "Auction Latency", "milliseconds"],
  ["EndpointLatency", "Endpoint Latency", "milliseconds"],
  ["BidderLatency", "Bidder Latency", "milliseconds"]
];
const SVG_NS = "http://www.w3.org/2000/svg";
const bootstrap = new URLSearchParams(window.location.search);
const accessToken = bootstrap.get("access_token")?.trim() || "";
const bootstrapPublisherId = bootstrap.get("publisher_id")?.trim() || "";
let publisherSearchTimer = null;
let publisherSearchController = null;
let publisherSearchGeneration = 0;
let publisherSearchResults = [];
const publisherNames = new Map();
let demandSources = [];
let bidderPublisher = "";
let selectedSources = new Set();
let selectedMetrics = new Set(["BidRequests"]);
let seriesData = new Map();
let currentSeries = new Map();
const filterSeriesColors = new Map();
let dataContext = "";
let loadedTimezone = "UTC";
let controller = null;
let generation = 0;
let loading = false;
let settingsDirty = false;
const chartViews = new Map();
let chartZoom = null;
const AUTO_REFRESH_MS = 60000;
// Empty key represents the publisher-wide response, cached separately from bidders.
const ALL_SOURCES = "";
const $ = id => document.getElementById(id);
const COLORS = ["#00b5aa", "#83bafa", "#b95124", "#7856ad", "#b03670", "#637522", "#3061c3", "#a36b00"];
const LATENCY_COLORS = { EndpointLatency: "#83bafa", AuctionLatency: "#ff9f32", BidderLatency: "#e91e87" };
const LATENCY_DASHES = { EndpointLatency: 0, AuctionLatency: 1, BidderLatency: 3 };
const LINE_DASHES = ["none", "8 4", "2 4", "12 3 2 3", "5 3 2 3", "12 5", "2 3 2 6", "8 3 2 3 2 3"];

function setStatus(text, warn = false) {
  $("status").textContent = text;
  $("status").classList.toggle("warn", warn);
}

function publisherOption(publisher) {
  return `[${publisher.id}] ${publisher.name}`;
}

function renderPublisherOptions(results) {
  $("publisherSearchList").replaceChildren();
  results.forEach(publisher => {
    publisherNames.set(String(publisher.id), publisher.name);
    const option = document.createElement("option"); option.value = publisherOption(publisher);
    $("publisherSearchList").appendChild(option);
  });
}

async function searchPublishers(query, signal) {
  const context = $("publisherId").value.trim() || bootstrapPublisherId;
  if (!accessToken || !context) throw new Error("Open this tool from your Publica session to search publishers.");
  const url = new URL("https://api.getpublica.com/v1/settings/publishers_names");
  url.search = new URLSearchParams({ access_token: accessToken, publisher_id: context, query }).toString();
  const json = await fetchJson(url, { method: "GET" }, signal);
  if (!Array.isArray(json)) throw new Error("Unable to read publisher search results.");
  return json.filter(item => item && /^\d+$/.test(String(item.id)) && typeof item.name === "string");
}

async function resolvePublisherDisplay(id) {
  if (!id || !accessToken) return;
  const gen = publisherSearchGeneration;
  try {
    const results = await searchPublishers(id, AbortSignal.timeout(10000));
    if (gen !== publisherSearchGeneration || $("publisherId").value !== id) return;
    publisherSearchResults = results; renderPublisherOptions(results);
    const match = results.find(item => String(item.id) === id);
    if (match) {
      $("publisherSearchInput").value = publisherOption(match);
      $("publisherHelper").textContent = `Selected publisher: ${publisherOption(match)}`;
    }
  } catch {
    if (gen === publisherSearchGeneration && $("publisherId").value === id) {
      $("publisherHelper").textContent = `Publisher ${id} selected. Name lookup unavailable; you can still load data.`;
    }
  }
}

function invalidateDashboardSettings(publisherChanged = false) {
  settingsDirty = true;
  generation++; controller?.abort(); loading = false; $("refreshButton").disabled = false;
  seriesData.clear(); chartViews.clear(); chartZoom = null;
  if (publisherChanged) {
    filterSeriesColors.clear();
    DashboardFilters.setAccount($("publisherId").value.trim());
    bidderPublisher = ""; demandSources = []; selectedSources.clear(); renderFilters();
  }
  renderCharts(); setStatus("Settings changed. Use Refresh data to load this context.");
}

function handlePublisherInput() {
  const gen = ++publisherSearchGeneration;
  clearTimeout(publisherSearchTimer); publisherSearchController?.abort();
  const query = $("publisherSearchInput").value.trim();
  const match = publisherSearchResults.find(item => publisherOption(item) === query) ||
    [...publisherNames].map(([id, name]) => ({ id, name })).find(item => publisherOption(item) === query);
  const id = match ? String(match.id) : /^\d+$/.test(query) ? query : "";
  if ($("publisherId").value !== id) {
    $("publisherId").value = id; invalidateDashboardSettings(true);
  }
  $("publisherSearchInput").setCustomValidity(id ? "" : "Choose a publisher suggestion or enter a publisher ID.");
  if (id) {
    $("publisherHelper").textContent = match ? `Selected publisher: ${publisherOption(match)}` : `Selected publisher ID: ${id}`;
    return;
  }
  publisherSearchResults = []; renderPublisherOptions([]);
  $("publisherHelper").textContent = query ? "Searching publishers…" : "Search by publisher name or ID.";
  if (!query) return;
  publisherSearchTimer = setTimeout(async () => {
    const requestController = new AbortController(); publisherSearchController = requestController;
    const timeout = setTimeout(() => requestController.abort(), 10000);
    try {
      const results = await searchPublishers(query, requestController.signal);
      if (gen !== publisherSearchGeneration) return;
      publisherSearchResults = results; renderPublisherOptions(results);
      $("publisherHelper").textContent = results.length ? "Choose a publisher from the suggestions." : "No matching publishers found.";
    } catch (error) {
      if (gen === publisherSearchGeneration) $("publisherHelper").textContent = error.name === "AbortError"
        ? "Publisher search timed out. Try again." : error.message;
    } finally { clearTimeout(timeout); }
  }, 250);
}

function normalizeLiveData(rows) {
  return rows.filter(row => row && typeof row.Date === "string")
    .map(row => ({ ...row, timestamp: Date.parse(row.Date) }))
    .filter(row => Number.isFinite(row.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function metricValue(row, key) {
  if (key === "Revenue") {
    const impressions = metricValue(row, "Impressions");
    const cpm = metricValue(row, "CPM");
    if (impressions === null || cpm === null) return null;
    const revenue = impressions * cpm / 1000;
    return Number.isFinite(revenue) ? revenue : null;
  }
  const value = row[key];
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareValuesDescending(a, b) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

function formatValue(value, unit, compact = false) {
  if (value === null) return "—";
  const number = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit === "count" && !compact ? 0 : 2,
    ...(compact ? { notation: "compact" } : {})
  }).format(value);
  return number + (unit === "percent" ? "%" : unit === "milliseconds" ? " ms" : "");
}

function formatDate(timestamp, short = false, showSeconds = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: loadedTimezone,
    ...(short ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      ...(showSeconds ? { second: "2-digit" } : {}) } :
      { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })
  }).format(timestamp);
}

function svgNode(tag, attributes = {}, text = "") {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

// Monotone cubic curves keep peaks and troughs within the measured values.
function smoothSegment(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x - 1},${points[0].y} L${points[0].x + 1},${points[0].y}`;
  const slopes = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x));
  const tangents = points.map((point, i) => {
    if (!i) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    const before = point.x - points[i - 1].x;
    const after = points[i + 1].x - point.x;
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]);
  });
  let path = `M${points[0].x},${points[0].y}`;
  points.slice(1).forEach((point, i) => {
    const previous = points[i], dx = (point.x - previous.x) / 3;
    const low = Math.min(previous.y, point.y), high = Math.max(previous.y, point.y);
    const clamp = value => Math.max(low, Math.min(high, value));
    path += ` C${previous.x + dx},${clamp(previous.y + tangents[i] * dx)} ${point.x - dx},${clamp(point.y - tangents[i + 1] * dx)} ${point.x},${point.y}`;
  });
  return path;
}

function checkboxOption(value, label, checked, onChange) {
  const wrapper = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = value;
  checkbox.checked = checked;
  checkbox.addEventListener("change", () => onChange(checkbox.checked));
  wrapper.append(checkbox, document.createTextNode(label));
  return wrapper;
}

function renderFilters() {
  const query = $("sourceSearch").value.trim().toLowerCase();
  $("sourceOptions").replaceChildren();
  demandSources.filter(source => source.toLowerCase().includes(query)).forEach(source => {
    $("sourceOptions").appendChild(checkboxOption(source, source, selectedSources.has(source), checked => {
      if (checked) { selectedSources.add(source); DashboardFilters.demandSourcesSelected(); } else selectedSources.delete(source);
      updateSummaries();
      loadDashboard();
    }));
  });
  $("kpiOptions").replaceChildren();
  METRICS.forEach(([key, label]) => {
    $("kpiOptions").appendChild(checkboxOption(key, label, selectedMetrics.has(key), checked => {
      if (checked) selectedMetrics.add(key); else selectedMetrics.delete(key);
      updateSummaries();
      renderCharts();
    }));
  });
  updateSummaries();
}

function updateSummaries() {
  $("sourceSummary").textContent = selectedSources.size
    ? `${selectedSources.size} of ${demandSources.length} selected` : "All (no filter)";
  $("kpiSummary").textContent = `${selectedMetrics.size} selected`;
}

function activeSources() {
  const definitions = DashboardFilters.series(demandSources.filter(source => selectedSources.has(source)));
  currentSeries = new Map(definitions.map(series => [series.id, series]));
  return [...currentSeries.keys()];
}

function sourceLabel(source) {
  return currentSeries.get(source)?.label || (source === ALL_SOURCES ? "All demand sources" : source);
}

function sourcePaletteIndex(source) {
  const index = demandSources.indexOf(source);
  if (index >= 0) return index;
  if (!filterSeriesColors.has(source)) filterSeriesColors.set(source, filterSeriesColors.size);
  return filterSeriesColors.get(source);
}

function sourceColor(source) {
  if (source === ALL_SOURCES) return COLORS[0];
  const index = sourcePaletteIndex(source);
  return COLORS[index] || `hsl(${index * 137.508 % 360} 65% 35%)`;
}

async function fetchJson(url, options, signal) {
  const response = await fetch(url.toString(), { ...options, signal });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Session expired or access denied. Open Publica and relaunch this tool."
    : `Request failed (HTTP ${response.status}).`);
  return response.json();
}

async function fetchDemandSources(publisherId, signal) {
  const sources = new Set();
  const bidderOptions = [];
  const pageSize = 1000;
  for (let page = 0; ; page++) {
    const url = new URL("https://api.getpublica.com/v2/settings/bidders");
    url.search = new URLSearchParams({ access_token: accessToken, publisher_id: publisherId,
      bidder_params_search: "", page_size: String(pageSize), bidder_group_ids: "", page: String(page), search: "",
      id_search: "", order_by: "past_week_revenue", order_direction: "desc", demand_sources: "",
      bidder_labels: "", priority: "", active: "2" }).toString();
    const json = await fetchJson(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedChannelIds: [], preloads: [], uiFields: ["id", "name", "bidder", "active"] })
    }, signal);
    if (!Array.isArray(json?.HeaderBidderListInfo)) throw new Error("The bidder response did not contain HeaderBidderListInfo.");
    const rows = json.HeaderBidderListInfo;
    bidderOptions.push(...rows);
    rows.forEach(row => { if (typeof row?.Bidder === "string" && row.Bidder.trim()) sources.add(row.Bidder.trim()); });
    const total = Number(json.TotalCount);
    if (!rows.length || (Number.isFinite(total) && total > 0 ? (page + 1) * pageSize >= total : rows.length < pageSize)) break;
  }
  DashboardFilters.setBidders(bidderOptions, publisherId);
  return [...sources].sort((a, b) => a.localeCompare(b));
}

async function fetchSourceData(publisherId, timezone, source, signal) {
  const url = new URL("https://api.getpublica.com/v1/settings/get_home_dashboard_live_data");
  url.search = new URLSearchParams({ access_token: accessToken, publisher_id: publisherId }).toString();
  const definition = currentSeries.get(source);
  const body = new URLSearchParams({ publisher_id: publisherId, timezone, currency_type: "0",
    ...DashboardFilters.payload(definition.demandSource, definition.chosen) });
  const json = await fetchJson(url, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  }, signal);
  if (json && Object.hasOwn(json, "LiveData") && json.LiveData === null) return [];
  if (!Array.isArray(json?.LiveData)) throw new Error("The response did not contain a LiveData array.");
  return normalizeLiveData(json.LiveData);
}

function renderCharts() {
  $("charts").replaceChildren();
  const sources = activeSources();
  const metrics = METRICS.filter(([key]) => selectedMetrics.has(key));
  const hasData = sources.some(source => seriesData.get(source)?.length);
  $("emptyState").hidden = hasData && !!metrics.length;
  $("emptyState").textContent = !metrics.length
    ? "Select at least one KPI." : loading ? "Loading live data…" : "No live data returned for the selected demand sources.";
  if (!hasData || !metrics.length) return;
  // Reconcile the shared window once, so individual tiles never alter each other's range.
  if (chartZoom) {
    let earliest = Infinity, latest = -Infinity;
    sources.forEach(source => (seriesData.get(source) || []).forEach(row => {
      earliest = Math.min(earliest, row.timestamp); latest = Math.max(latest, row.timestamp);
    }));
    chartZoom = chartZoom[1] < earliest || chartZoom[0] > latest ? null :
      [Math.max(earliest, chartZoom[0]), Math.min(latest, chartZoom[1])];
  }
  const latencies = metrics.filter(([, , unit]) => unit === "milliseconds");
  let renderedLatencies = false;
  metrics.forEach(metric => {
    if (metric[2] === "milliseconds") {
      if (!renderedLatencies) renderMetricChart(latencies, sources);
      renderedLatencies = true;
    } else {
      renderMetricChart([metric], sources);
    }
  });
}

function renderMetricChart(metrics, sources) {
  const unit = metrics[0][2];
  const latencyChart = unit === "milliseconds";
  const label = latencyChart ? "Key Latencies" : metrics[0][1];
  const chartId = latencyChart ? "latencies" : metrics[0][0];
  if (!chartViews.has(chartId)) chartViews.set(chartId, { hiddenSources: new Set() });
  const view = chartViews.get(chartId);
  const panel = document.createElement("section");
  panel.className = "chart-card";
  panel.dataset.chartId = chartId;
  const heading = document.createElement("h2");
  heading.textContent = latencyChart ? `${label} (ms)` : label;
  panel.appendChild(heading);
  const legend = document.createElement("div");
  legend.className = "legend";
  const series = metrics.flatMap(([key, metricLabel]) => sources.map(source => ({ source, key, metricLabel,
    color: latencyChart && source === ALL_SOURCES ? LATENCY_COLORS[key] : sourceColor(source),
    dash: source === ALL_SOURCES ? 0 : latencyChart && metrics.length > 1 ? LATENCY_DASHES[key] : Math.floor(sourcePaletteIndex(source) / COLORS.length) % 3,
    points: (seriesData.get(source) || []).map(row => ({ timestamp: row.timestamp, value: metricValue(row, key) })) })));
  const legendSeries = [...series].sort((a, b) =>
    compareValuesDescending(a.points.at(-1)?.value ?? null, b.points.at(-1)?.value ?? null) ||
    sourceLabel(a.source).localeCompare(sourceLabel(b.source)) || a.metricLabel.localeCompare(b.metricLabel));
  legendSeries.forEach(({ source, metricLabel, color, dash, points }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "legend-item";
    item.dataset.source = source;
    item.setAttribute("aria-pressed", String(!view.hiddenSources.has(source)));
    item.title = `Show or hide ${sourceLabel(source)} in this graph`;
    item.addEventListener("click", () => {
      if (view.hiddenSources.has(source)) view.hiddenSources.delete(source); else view.hiddenSources.add(source);
      renderCharts();
      const updatedPanel = [...document.querySelectorAll(".chart-card")].find(card => card.dataset.chartId === chartId);
      [...updatedPanel.querySelectorAll(".legend-item")].find(button => button.dataset.source === source)?.focus();
    });
    const swatch = document.createElement("span");
    swatch.className = "swatch"; swatch.style.borderColor = color;
    if (dash) swatch.style.borderTopStyle = "dashed";
    const latest = points[points.length - 1];
    const seriesLabel = latencyChart ? `${metricLabel} · ${sourceLabel(source)}` : sourceLabel(source);
    item.append(swatch, document.createTextNode(`${seriesLabel} · ${latest ? formatValue(latest.value, unit) : "No data"}`));
    legend.appendChild(item);
  });
  panel.appendChild(legend);
  const tools = document.createElement("div"); tools.className = "chart-tools";
  const addTool = (text, action, handler, disabled = false) => {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = text; button.dataset.action = action; button.disabled = disabled;
    button.addEventListener("click", handler); tools.appendChild(button);
  };
  addTool("Show all", "show-all", () => { view.hiddenSources.clear(); renderCharts(); });
  addTool("Hide all", "hide-all", () => { sources.forEach(source => view.hiddenSources.add(source)); renderCharts(); });
  addTool("Reset zoom", "reset-zoom", () => { chartZoom = null; renderCharts(); }, !chartZoom);
  const instructions = document.createElement("span"); instructions.className = "hint";
  instructions.textContent = "Click legend names to show/hide sources. Drag across a graph to zoom all tiles.";
  tools.appendChild(instructions); panel.appendChild(tools);
  const visibleSeries = series.filter(s => !view.hiddenSources.has(s.source));
  const fullTimestamps = series.flatMap(s => s.points.map(p => p.timestamp));
  let fullStart = Infinity, fullEnd = -Infinity;
  fullTimestamps.forEach(timestamp => { fullStart = Math.min(fullStart, timestamp); fullEnd = Math.max(fullEnd, timestamp); });
  tools.querySelector('[data-action="reset-zoom"]').disabled = !chartZoom;
  if (chartZoom) {
    const range = document.createElement("p"); range.className = "hint zoom-range";
    range.textContent = `${formatDate(chartZoom[0])} – ${formatDate(chartZoom[1])}`; panel.appendChild(range);
  }
  const displaySeries = visibleSeries.map(s => ({ ...s,
    points: chartZoom ? s.points.filter(point => point.timestamp >= chartZoom[0] && point.timestamp <= chartZoom[1]) : s.points }));
  const scroll = document.createElement("div"); scroll.className = "chart-scroll";
  const svg = svgNode("svg", { class: "chart", viewBox: "0 0 1100 350", role: "img", "aria-label": `${label} by demand source over time in ${loadedTimezone}` });
  scroll.appendChild(svg); panel.appendChild(scroll);
  $("charts").appendChild(panel);
  const valid = displaySeries.flatMap(s => s.points.filter(p => p.value !== null));
  if (!valid.length) {
    const empty = document.createElement("p"); empty.className = "hint";
    empty.textContent = !visibleSeries.length ? "All sources are hidden. Select a legend name or Show all." : chartZoom
      ? "No values in this range. Use Reset zoom to see the full graph." : `No values available for ${label}.`;
    panel.appendChild(empty); scroll.hidden = true; return;
  }
  const left = 112, right = 1060, top = 20, bottom = 280;
  const [start, end] = chartZoom || [fullStart, fullEnd];
  panel.dataset.rangeStart = String(start); panel.dataset.rangeEnd = String(end);
  let min = 0, max = 0;
  valid.forEach(({ value }) => { min = Math.min(min, value); max = Math.max(max, value); });
  if (max === min) max = min + 1;
  const y = value => bottom - (value - min) / (max - min) * (bottom - top);
  const x = timestamp => start === end ? (left + right) / 2 : left + (timestamp - start) / (end - start) * (right - left);
  for (let i = 0; i <= 5; i++) {
    const value = min + (max - min) * i / 5;
    svg.appendChild(svgNode("line", { x1: left, x2: right, y1: y(value), y2: y(value), stroke: "#dce3e5", "stroke-dasharray": "3 3" }));
    svg.appendChild(svgNode("text", { x: left - 12, y: y(value) + 4, "text-anchor": "end", fill: "#5f7172", "font-size": 12 }, formatValue(value, unit, true)));
  }
  const tickCount = start === end ? 1 : 5;
  for (let i = 0; i < tickCount; i++) {
    const timestamp = start + (end - start) * i / Math.max(1, tickCount - 1);
    svg.appendChild(svgNode("text", { x: x(timestamp), y: bottom + 26, "text-anchor": "middle", fill: "#5f7172", "font-size": 12 }, formatDate(timestamp, true, end - start < 300000)));
  }
  svg.appendChild(svgNode("text", { x: (left + right) / 2, y: 338, "text-anchor": "middle", fill: "#5f7172", "font-size": 13 }, `Date (${loadedTimezone})`));
  svg.appendChild(svgNode("text", { transform: "translate(20 150) rotate(-90)", "text-anchor": "middle", fill: "#5f7172", "font-size": 13 }, label + (unit === "milliseconds" ? " (ms)" : unit === "percent" ? " (%)" : "")));
  displaySeries.forEach(({ source, key, metricLabel, color, dash, points }) => {
    const byDate = new Map(points.map(point => [point.timestamp, point.value]));
    let path = "", segment = [];
    // Each request can have different seconds in its timestamps. Only this
    // source's own missing values should break its line, not another source's dates.
    byDate.forEach((value, timestamp) => {
      if (value === null || value === undefined) {
        path += smoothSegment(segment); segment = []; return;
      }
      segment.push({ x: x(timestamp), y: y(value) });
    });
    path += smoothSegment(segment);
    if (path) svg.appendChild(svgNode("path", { d: path, fill: "none", stroke: color, "stroke-width": 2,
      "stroke-dasharray": LINE_DASHES[dash], "stroke-linecap": "round", "stroke-linejoin": "round", "data-source": source, "data-kpi": key }));
    points.filter(p => p.value !== null).forEach(point => {
      const description = `${sourceLabel(source)} · ${metricLabel} · ${formatDate(point.timestamp)}: ${formatValue(point.value, unit)}`;
      const circle = svgNode("circle", { class: "data-point", cx: x(point.timestamp), cy: y(point.value), r: 5,
        fill: "transparent", style: `--point-color: ${color}`, tabindex: 0, "aria-label": description,
        "data-timestamp": point.timestamp, "aria-describedby": `hover-${chartId}` });
      svg.appendChild(circle);
    });
  });
  enableChartHover(panel, svg, displaySeries, { left, right, top, bottom, start, end, x, y, unit, label, chartId });
  enableChartZoom(svg, { left, right, top, bottom, start, end }, range => {
    chartZoom = range; renderCharts();
  });
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "View selected KPI data"; details.appendChild(summary);
  const wrap = document.createElement("div"); wrap.className = "table-wrap";
  const table = document.createElement("table"), head = document.createElement("thead"), header = document.createElement("tr");
  ["Date", "Selection", "KPI", "Value"].forEach(text => { const th = document.createElement("th"); th.scope = "col"; th.textContent = text; header.appendChild(th); });
  head.appendChild(header); table.appendChild(head);
  const body = document.createElement("tbody");
  displaySeries.flatMap(s => s.points.map(point => ({ ...point, source: s.source, metricLabel: s.metricLabel }))).sort((a, b) => a.timestamp - b.timestamp).forEach(point => {
    const row = document.createElement("tr");
    [formatDate(point.timestamp), sourceLabel(point.source), point.metricLabel, formatValue(point.value, unit)].forEach(text => { const cell = document.createElement("td"); cell.textContent = text; row.appendChild(cell); });
    body.appendChild(row);
  });
  table.appendChild(body); wrap.appendChild(table); details.appendChild(wrap); panel.appendChild(details);
}

function nearestPoint(points, timestamp) {
  if (!points.length) return null;
  let low = 0, high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid].timestamp < timestamp) low = mid + 1; else high = mid;
  }
  const before = points[Math.max(0, low - 1)], after = points[Math.min(points.length - 1, low)];
  return Math.abs(before.timestamp - timestamp) <= Math.abs(after.timestamp - timestamp) ? before : after;
}

function enableChartHover(panel, svg, series, { left, right, top, bottom, start, end, x, y, unit, label, chartId }) {
  const tooltip = document.createElement("div"); tooltip.className = "chart-tooltip";
  tooltip.id = `hover-${chartId}`; tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true;
  panel.appendChild(tooltip);
  const overlay = svgNode("g", { class: "hover-overlay", "pointer-events": "none", hidden: "" });
  svg.appendChild(overlay);
  // Compare nearby samples while preserving each request's exact timestamp.
  const sampledSeries = series.map(s => {
    const intervals = s.points.slice(1).map((p, i) => p.timestamp - s.points[i].timestamp).filter(n => n > 0).sort((a, b) => a - b);
    const tolerance = intervals.length ? intervals[Math.floor(intervals.length / 2)] / 2 + 1000 : 1000;
    return { ...s, tolerance };
  });
  let lastTimestamp = null;
  const hide = () => { tooltip.hidden = true; overlay.setAttribute("hidden", ""); lastTimestamp = null; };
  const position = (clientX, clientY) => {
    const panelRect = panel.getBoundingClientRect(), cardRect = tooltip.getBoundingClientRect();
    const minX = Math.max(panelRect.left + 8, 8), maxX = Math.min(panelRect.right - 8, window.innerWidth - 8);
    let px = clientX + 18;
    if (px + cardRect.width > maxX) px = clientX - cardRect.width - 18;
    px = Math.max(minX, Math.min(px, maxX - cardRect.width));
    const py = Math.max(8, Math.min(clientY - 20, window.innerHeight - cardRect.height - 8));
    tooltip.style.left = `${px - panelRect.left}px`;
    tooltip.style.top = `${py - panelRect.top}px`;
  };
  const show = (timestamp, clientX, clientY) => {
    const candidates = sampledSeries.map(s => nearestPoint(s.points, timestamp)).filter(Boolean);
    if (!candidates.length) { hide(); return; }
    const anchor = candidates.reduce((a, b) => Math.abs(a.timestamp - timestamp) <= Math.abs(b.timestamp - timestamp) ? a : b).timestamp;
    if (lastTimestamp !== anchor) {
      lastTimestamp = anchor; tooltip.replaceChildren(); overlay.replaceChildren();
      const title = document.createElement("strong"); title.className = "tooltip-title"; title.textContent = label;
      const date = document.createElement("div"); date.className = "tooltip-date"; date.textContent = formatDate(anchor);
      tooltip.append(title, date);
      overlay.appendChild(svgNode("line", { class: "hover-guide", x1: x(anchor), x2: x(anchor), y1: top, y2: bottom }));
      const groups = new Map();
      const hoverSeries = sampledSeries.map(s => {
        const nearest = nearestPoint(s.points, anchor);
        const point = nearest && Math.abs(nearest.timestamp - anchor) <= s.tolerance ? nearest : null;
        return { ...s, point };
      }).sort((a, b) => compareValuesDescending(a.point?.value ?? null, b.point?.value ?? null) ||
        sourceLabel(a.source).localeCompare(sourceLabel(b.source)) || a.metricLabel.localeCompare(b.metricLabel));
      // First occurrence places each partner by its highest displayed KPI value;
      // rows within that partner also remain in descending order.
      hoverSeries.forEach(s => {
        if (!groups.has(s.source)) {
          const group = document.createElement("section"); group.className = "tooltip-partner"; group.dataset.source = s.source;
          const name = document.createElement("strong"); name.textContent = sourceLabel(s.source); group.appendChild(name);
          tooltip.appendChild(group); groups.set(s.source, group);
        }
        const point = s.point;
        const row = document.createElement("div"); row.className = "tooltip-row"; row.dataset.kpi = s.key;
        const dot = document.createElement("span"); dot.className = "tooltip-dot"; dot.style.backgroundColor = s.color;
        const text = document.createElement("span"); text.className = "tooltip-metric"; text.textContent = s.metricLabel;
        const value = document.createElement("strong"); value.className = "tooltip-value";
        value.textContent = point ? formatValue(point.value, unit) : "No data";
        const exactDate = document.createElement("small"); exactDate.className = "tooltip-sample-date";
        exactDate.textContent = point ? formatDate(point.timestamp) : "No sample near this time";
        row.append(dot, text, value, exactDate); groups.get(s.source).appendChild(row);
        if (point && point.value !== null) overlay.appendChild(svgNode("circle", {
          class: "hover-marker", cx: x(point.timestamp), cy: y(point.value), r: 5, fill: s.color, stroke: "white", "stroke-width": 2
        }));
      });
    }
    tooltip.hidden = false; overlay.removeAttribute("hidden"); position(clientX, clientY);
  };
  svg.addEventListener("pointermove", event => {
    if (event.buttons) { hide(); return; }
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    if (local.x < left || local.x > right || local.y < top || local.y > bottom) { hide(); return; }
    show(start === end ? start : start + (local.x - left) / (right - left) * (end - start), event.clientX, event.clientY);
  });
  svg.addEventListener("pointerdown", hide);
  svg.addEventListener("pointerleave", event => { if (!tooltip.contains(event.relatedTarget)) hide(); });
  panel.addEventListener("pointerleave", hide);
  svg.addEventListener("focusin", event => {
    if (!event.target.matches(".data-point")) return;
    const bounds = event.target.getBoundingClientRect();
    show(Number(event.target.dataset.timestamp), bounds.left + bounds.width / 2, bounds.top);
  });
  svg.addEventListener("focusout", event => { if (!svg.contains(event.relatedTarget)) hide(); });
  panel.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
}

function enableChartZoom(svg, { left, right, top, bottom, start, end }, onZoom) {
  if (start === end) return;
  const selection = svgNode("rect", { class: "zoom-selection", y: top, height: bottom - top, hidden: "" });
  svg.appendChild(selection);
  let drag = null;
  const coordinates = event => {
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  };
  const clampX = x => Math.max(left, Math.min(right, x));
  const cancel = () => { drag = null; selection.setAttribute("hidden", ""); };
  svg.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    const point = coordinates(event);
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) return;
    drag = { x: point.x, pointerId: event.pointerId };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  svg.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const x = clampX(coordinates(event).x);
    selection.setAttribute("x", Math.min(x, drag.x));
    selection.setAttribute("width", Math.abs(x - drag.x));
    selection.removeAttribute("hidden");
  });
  svg.addEventListener("pointerup", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const x = clampX(coordinates(event).x), initial = drag.x;
    cancel(); svg.releasePointerCapture(event.pointerId);
    if (Math.abs(x - initial) < 10) return;
    const date = position => start + (position - left) / (right - left) * (end - start);
    onZoom([date(Math.min(initial, x)), date(Math.max(initial, x))]);
  });
  svg.addEventListener("pointercancel", cancel);
  svg.addEventListener("lostpointercapture", cancel);
  svg.addEventListener("dblclick", () => onZoom(null));
}

async function loadDashboard(refresh = false, autoRefresh = false) {
  const gen = ++generation;
  controller?.abort();
  loading = false;
  $("refreshButton").disabled = false;
  const publisherId = $("publisherId").value.trim();
  const timezone = $("timezone").value.trim();
  if (!accessToken) { setStatus("Open Publica, then launch Live Dashboard again to capture your session.", true); return; }
  if (!publisherId) { setStatus("Choose a publisher by name or enter a publisher ID to load the dashboard.", true); return; }
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
  catch { setStatus("Enter a valid timezone, such as America/New_York or Australia/Brisbane.", true); return; }
  DashboardFilters.setAccount(publisherId);
  try { DashboardFilters.payload(selectedSources.size ? "selected" : ""); }
  catch (error) { seriesData.clear(); renderCharts(); setStatus(error.message, true); return; }
  settingsDirty = false;
  const requestController = new AbortController(); controller = requestController;
  const timeout = setTimeout(() => requestController.abort(), 60000);
  const context = JSON.stringify([publisherId, timezone, DashboardFilters.snapshot()]);
  if (dataContext !== context) { seriesData.clear(); chartViews.clear(); chartZoom = null; dataContext = context; }
  loading = true;
  $("refreshButton").disabled = true;
  renderCharts();
  try {
    if (bidderPublisher !== publisherId || refresh) {
      setStatus(`Loading demand sources for publisher ${publisherId}…`);
      const sources = await fetchDemandSources(publisherId, requestController.signal);
      if (gen !== generation) return;
      const samePublisher = bidderPublisher === publisherId;
      selectedSources = new Set(samePublisher ? sources.filter(source => selectedSources.has(source)) : []);
      demandSources = sources; bidderPublisher = publisherId;
      renderFilters();
    }
    const sources = activeSources();
    setStatus(sources[0] === ALL_SOURCES ? "Loading all demand sources…" : `Loading ${sources.length} selected series…`);
    // Keep source responses separate so bidder data cannot be accidentally combined.
    const pending = sources.filter(source => refresh || autoRefresh || !seriesData.has(source));
    const failures = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        const source = pending[next++];
        try {
          const rows = await fetchSourceData(publisherId, timezone, source, requestController.signal);
          if (gen !== generation) return;
          seriesData.set(source, rows);
        } catch (error) {
          if (requestController.signal.aborted) throw error;
          failures.push(`${sourceLabel(source)}: ${error.message}`);
        }
      }
    }));
    if (gen !== generation) return;
    loadedTimezone = timezone;
    setStatus(failures.length ? `Some sources could not load. Previous data is retained where available. ${failures.join(" ")}` :
      `Publisher ${publisherId} · ${demandSources.length} available demand sources · ${sources[0] === ALL_SOURCES ? "All demand sources" : `${sources.length} selected series`} · Updated ${new Date().toLocaleTimeString()}`, !!failures.length);
  } catch (error) {
    if (gen !== generation) return;
    setStatus(error.name === "AbortError" ? "Request timed out. Use Refresh data to try again." : error.message || "Unable to load live data.", true);
  } finally {
    clearTimeout(timeout);
    if (gen === generation) {
      loading = false; $("refreshButton").disabled = false; renderCharts();
    }
  }
}

$("publisherId").value = bootstrapPublisherId;
$("publisherSearchInput").value = bootstrapPublisherId;
$("publisherSearchInput").addEventListener("input", handlePublisherInput);
$("publisherSearchInput").addEventListener("change", () => {
  if (!$("publisherId").value) return;
  if (settingsDirty) loadDashboard();
  resolvePublisherDisplay($("publisherId").value);
});
$("sourceSearch").addEventListener("input", renderFilters);
$("selectAllSources").addEventListener("click", () => {
  const query = $("sourceSearch").value.trim().toLowerCase();
  demandSources.filter(source => source.toLowerCase().includes(query)).forEach(source => selectedSources.add(source));
  if (selectedSources.size) DashboardFilters.demandSourcesSelected();
  renderFilters(); loadDashboard();
});
$("clearSources").addEventListener("click", () => { selectedSources.clear(); renderFilters(); loadDashboard(); });
$("selectAllKpis").addEventListener("click", () => { selectedMetrics = new Set(METRICS.map(([key]) => key)); renderFilters(); renderCharts(); });
$("clearKpis").addEventListener("click", () => { selectedMetrics.clear(); renderFilters(); renderCharts(); });
$("requestForm").addEventListener("submit", event => { event.preventDefault(); loadDashboard(true); });
// Avoid displaying results for an old publisher or timezone while edits are pending.
$("timezone").addEventListener("input", () => invalidateDashboardSettings());
document.addEventListener("click", event => {
  document.querySelectorAll(".multiselect[open]").forEach(dropdown => {
    // A checkbox can rerender its list before this event reaches document.
    if (!event.composedPath().includes(dropdown)) dropdown.open = false;
  });
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") document.querySelectorAll(".multiselect[open]").forEach(dropdown => {
    dropdown.open = false; dropdown.querySelector("summary").focus();
  });
});
DashboardFilters.initialize({ accessToken, hasDemandSources: () => selectedSources.size > 0,
  onChange: ({ clearSources }) => {
    if (clearSources) selectedSources.clear();
    renderFilters(); loadDashboard();
  }
});
DashboardFilters.setAccount($("publisherId").value.trim());
renderFilters();
loadDashboard();
resolvePublisherDisplay(bootstrapPublisherId);
const autoRefreshTimer = setInterval(() => {
  if ($("autoRefresh").checked && !loading && !settingsDirty && accessToken && selectedMetrics.size) {
    loadDashboard(false, true);
  }
}, AUTO_REFRESH_MS);
window.addEventListener("pagehide", () => {
  clearInterval(autoRefreshTimer); clearTimeout(publisherSearchTimer);
  publisherSearchController?.abort(); controller?.abort();
});
