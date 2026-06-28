  /**
   * SECURITY NOTE:
   * Doing a password-grant token request in browser JS exposes credentials to the page/runtime.
   * If this is for internal/local use only, it can be acceptable; otherwise prefer a backend proxy.
   */

  // ----------------------------
  // VIDEO PERFORMANCE SETTINGS
  // ----------------------------
  const activeVideos = new Set();

  function getMaxActiveVideos() {
    const v = Number(document.getElementById("maxActiveVideos")?.value);
    return isFinite(v) && v >= 0 ? v : 8;
  }

  function getVideoPlaySeconds() {
    const v = Number(document.getElementById("videoPlaySeconds")?.value);
    return isFinite(v) && v > 0 ? v : 10;
  }

  function getTileWidthPx() {
    const v = Number(document.getElementById("tileWidthPx")?.value);
    return isFinite(v) && v >= 120 ? v : VISUAL_DEFAULTS.tileWidthPx;
  }

  function getFontSizePx() {
    const v = Number(document.getElementById("fontSizePx")?.value);
    return isFinite(v) && v >= 8 ? v : 16;
  }

  function getScaledFontPx(basePx, multiplier = 1) {
    const configuredPx = getFontSizePx();
    const fallbackPx = Math.max(12, Math.round(basePx));
    return Math.max(8, Math.round((configuredPx || fallbackPx) * multiplier));
  }

  function stopAndReleaseVideo(v) {
    try { v.pause(); } catch {}
    try { v.removeAttribute("src"); v.load(); } catch {}
    activeVideos.delete(v);
  }

  function temporarilyResumeVideoOnHover(video) {
    if (!video || video.dataset.previewOnly === "true") return;

    try {
      if (video.paused) {
        video.dataset.hoverResumeActive = "true";
        if (isPaused) {
          video.dataset.pauseOverrideState = "playing";
        }
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
      } else {
        video.dataset.hoverResumeActive = "";
      }
    } catch {}
  }

  function rePauseVideoAfterHover(video) {
    if (!video || video.dataset.previewOnly === "true") return;
    if (video.dataset.hoverResumeActive !== "true") return;

    try {
      video.dataset.hoverResumeActive = "";
      if (isPaused) {
        video.dataset.pauseOverrideState = "paused";
      }
      video.pause();
    } catch {}
  }

  function enforceVideoCap() {
    const maxActive = getMaxActiveVideos();
    if (maxActive > 0 && activeVideos.size > maxActive) {
      const oldest = activeVideos.values().next().value;
      if (oldest) stopAndReleaseVideo(oldest);
    }
  }

  function canStartAnotherVideo() {
    const maxActive = getMaxActiveVideos();
    return maxActive === 0 || activeVideos.size < maxActive;
  }

  // ----------------------------
  // LOOKBACK FILTER
  // ----------------------------
  function getLookbackHours() {
    const v = Number(document.getElementById("logLookbackHours")?.value);
    return isFinite(v) && v > 0 ? v : 0; // 0 => ALL
  }

  function getSelectedStreamType() {
    return document.getElementById("streamType")?.value || "creative";
  }

  function getSelectedDemandSource() {
    return document.getElementById("demandSourceSelect")?.value || "";
  }

  function getDemandSourceValue(ad) {
    return `${ad?.DemandSource || ""}`.trim();
  }

  function collectDemandSourcesFromLogs(dataArray) {
    const found = new Set();

    for (const item of Array.isArray(dataArray) ? dataArray : []) {
      const ads = Array.isArray(item?.EndpointResponseAds) ? item.EndpointResponseAds : [];
      for (const ad of ads) {
        const demandSource = getDemandSourceValue(ad);
        if (demandSource) found.add(demandSource);
      }
    }

    return Array.from(found).sort((a, b) => a.localeCompare(b));
  }

  function renderDemandSourceOptions(nextDemandSources = knownDemandSources) {
    const demandSourceSelect = document.getElementById("demandSourceSelect");
    if (!demandSourceSelect) return;

    const previousValue = demandSourceSelect.value || "";
    const sortedDemandSources = Array.from(new Set((nextDemandSources || []).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

    knownDemandSources = sortedDemandSources;
    demandSourceSelect.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All Demand Sources";
    demandSourceSelect.appendChild(allOption);

    sortedDemandSources.forEach(demandSource => {
      const option = document.createElement("option");
      option.value = demandSource;
      option.textContent = demandSource;
      demandSourceSelect.appendChild(option);
    });

    demandSourceSelect.value = sortedDemandSources.includes(previousValue) ? previousValue : "";
    syncDemandSourceControls();
  }

  function mergeDemandSources(newDemandSources) {
    const merged = Array.from(new Set([...(knownDemandSources || []), ...(newDemandSources || [])].filter(Boolean)));
    renderDemandSourceOptions(merged);
  }

  function syncDemandSourceControls() {
    const streamType = getSelectedStreamType();
    const demandSourceSelect = document.getElementById("demandSourceSelect");
    const demandSourceLabel = document.querySelector('label[for="demandSourceSelect"]');
    const fieldHelp = demandSourceSelect?.parentElement?.querySelector(".field-help");
    const hasOptions = knownDemandSources.length > 0;
    const visible = streamType === "creative";

    if (demandSourceSelect) {
      demandSourceSelect.disabled = !visible || !hasOptions;
    }

    if (demandSourceLabel) demandSourceLabel.style.display = visible ? "" : "none";
    if (demandSourceSelect) demandSourceSelect.style.display = visible ? "" : "none";
    if (fieldHelp) fieldHelp.style.display = visible ? "" : "none";
  }

  function adMatchesDemandSource(ad) {
    const selectedDemandSource = getSelectedDemandSource();
    if (!selectedDemandSource) return true;
    return getDemandSourceValue(ad) === selectedDemandSource;
  }

  function isWithinLookback(ts) {
    const hours = getLookbackHours();
    if (hours === 0) return true;
    const t = new Date(ts).getTime();
    if (!isFinite(t)) return false;
    return t >= (Date.now() - hours * 60 * 60 * 1000);
  }

  // ----------------------------
  // APP STATE
  // ----------------------------
  const MAX_PROCESSED_UUIDS = 10000;

  let accessToken = null;
  let tokenExpiresAtMs = 0;

  let currentFetchTimestamp = 0;
  let sitesByUuid = new Map();

  let isFetching = false;
  let isPaused = false;
  let stopRequested = false;
  let fetchLoopId = 0;
  let waitingForFirstRender = false;
  let knownDemandSources = [];
  let publisherSearchTimer = null;
  let publisherSearchResults = [];
  let bootstrapPublisherId = "";

  const sitePollTimers = new Map();
  const activeSiteLoops = new Map();
  const siteProcessedUUIDs = new Map();
  const siteLastSeenTimestamps = new Map();
  let availableSites = [];

  const MAX_PARALLEL_SITES = 4;
  const ROW_ITEM_GAP = 24;
  const CREATIVE_ROW_ITEM_GAP = 72;
  const VISUAL_DEFAULTS = {
    minFontSize: 8,
    maxFontSize: 24,
    minVideoSize: 24,
    maxVideoSize: 68,
    tileWidthPx: 220,
    minTableWidth: 6,
    maxTableWidth: 120,
    minPrice: 0,
    maxPrice: 3,
    minPriceColor: "#ffffff",
    maxPriceColor: "#ffffff",
    minFontColor: "#333333",
    maxFontColor: "#ffffff"
  };

  // ----------------------------
  // UI BUTTON HIGHLIGHT HELPERS
  // ----------------------------
  function setBtnActive(btnId, isActive, cls = "is-active") {
    const el = document.getElementById(btnId);
    if (!el) return;
    el.classList.toggle(cls, !!isActive);
  }

  function syncButtonStates() {
    setBtnActive("fetchDataButton", isFetching && !stopRequested, "is-active");
    setBtnActive("pauseButton", isPaused, "is-active");
    setBtnActive("stopFetchButton", (stopRequested || !isFetching), "is-danger");

    const pauseBtn = document.getElementById("pauseButton");
    if (pauseBtn) {
      pauseBtn.disabled = !isFetching;
      pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    }

    const formWrapper = document.getElementById("formWrapper");
    const isConfigVisible = formWrapper && !formWrapper.classList.contains("hidden");
    setBtnActive("toggleFormButton", isConfigVisible, "is-active");
    syncDemandSourceControls();
  }

  function setStreamStatus(message, visible) {
    const statusEl = document.getElementById("streamStatus");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("visible", !!visible);
  }

  function getLoadingStatusMessage(siteUuids) {
    const names = (siteUuids || [])
      .map(siteUuid => sitesByUuid.get(siteUuid)?.name || siteUuid)
      .filter(Boolean);

    if (names.length === 0) return "Loading data...";
    if (names.length <= 3) return `Loading data from: ${names.join(", ")}`;
    return `Loading data from: ${names.slice(0, 3).join(", ")} + ${names.length - 3} more`;
  }

  function markFirstRenderComplete() {
    if (!waitingForFirstRender) return;
    waitingForFirstRender = false;
    setStreamStatus("", false);
  }

  function applyPauseState() {
    document.querySelectorAll(".inner-table-container").forEach(el => {
      el.style.animationPlayState = isPaused ? "paused" : "running";
    });

    for (const video of Array.from(document.querySelectorAll("video"))) {
      try {
        if (isPaused) {
          video.dataset.prePauseState = video.paused ? "paused" : "playing";
          video.dataset.pauseOverrideState = "";
          video.pause();
        } else {
          const targetState = video.dataset.pauseOverrideState || video.dataset.prePauseState || "playing";
          video.dataset.prePauseState = "";
          video.dataset.pauseOverrideState = "";

          if (video.dataset.previewOnly === "true" || targetState === "paused") {
            video.pause();
          } else {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
          }
        }
      } catch {}
    }
  }

  async function waitWhilePaused(loopId) {
    while (isPaused && isFetching && !stopRequested && loopId === fetchLoopId) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ----------------------------
  // TOKEN / AUTH + AUTO REFRESH
  // ----------------------------
  function getPublisherId() {
    return document.getElementById("publisherIdAuth").value.trim();
  }

  function getPublisherSearchInput() {
    return document.getElementById("publisherSearchInput")?.value.trim() || "";
  }

  function setPublisherId(value) {
    const field = document.getElementById("publisherIdAuth");
    if (field) field.value = `${value || ""}`.trim();
  }

  function setPublisherHelper(text) {
    const helper = document.getElementById("publisherHelper");
    if (helper) helper.textContent = text || "";
  }

  function formatPublisherOption(publisher) {
    const id = `${publisher?.id ?? ""}`.trim();
    const name = `${publisher?.name || ""}`.trim();
    return id && name ? `[${id}] ${name}` : "";
  }

  function renderPublisherSearchOptions(items = []) {
    const list = document.getElementById("publisherSearchList");
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
    await ensureValidToken();

    const contextPublisherId = getPublisherId() || bootstrapPublisherId;
    if (!contextPublisherId) {
      throw new Error("Missing publisher ID.");
    }

    const url =
      `https://api.getpublica.com/v1/settings/publishers_names` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(contextPublisherId)}` +
      `&query=${encodeURIComponent(query)}`;

    const response = await fetchWithAutoRefresh(() => fetch(url, { method: "GET" }));
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Publisher search failed: ${response.status} ${text}`);
    }

    const json = await response.json();
    return Array.isArray(json) ? json : [];
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
        const searchField = document.getElementById("publisherSearchInput");
        if (searchField) searchField.value = formatted;
        setPublisherId(matchedPublisher.id);
        setPublisherHelper(`Selected publisher: ${formatted}`);
        return;
      }
    } catch (error) {
      console.error("Failed to resolve publisher display", error);
    }

    const searchField = document.getElementById("publisherSearchInput");
    if (searchField) searchField.value = resolvedPublisherId;
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
      setPublisherHelper("Type to search publishers, then choose one to load sites.");
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
    if (!syncPublisherSelectionFromInput()) {
      return;
    }

    if (!getPublisherId() || !isTokenValid()) {
      syncButtonStates();
      return;
    }

    try {
      await loadSitesForCurrentContext();
      await refreshCreativeDemandSources();
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      syncButtonStates();
    }
  }

  function getBootstrapQueryValue(key) {
    try {
      return new URLSearchParams(window.location.search).get(key)?.trim() || "";
    } catch {
      return "";
    }
  }

  function isTokenValid() {
    return !!accessToken && Date.now() < (tokenExpiresAtMs - 10_000);
  }

  function handleAuthFailure(message) {
    console.warn(message || "Auth failure");
    accessToken = null;
    tokenExpiresAtMs = 0;
    syncButtonStates();

    // stop everything if running
    stopRequested = true;
    isFetching = false;
    fetchLoopId++;

    for (const t of sitePollTimers.values()) clearTimeout(t);
    sitePollTimers.clear();
    activeSiteLoops.clear();

    const stopBtn = document.getElementById("stopFetchButton");
    if (stopBtn) stopBtn.disabled = true;
  }

  async function ensureValidToken() {
    if (isTokenValid()) return accessToken;
    throw new Error("Missing or expired token. Reopen RTB Stream from Publica.");
  }

  async function fetchWithAutoRefresh(makeRequestFn) {
    const resp = await makeRequestFn();
    if (resp.status === 401) {
      handleAuthFailure("Token expired. Reopen RTB Stream from Publica.");
      throw new Error("Unauthorized. Reopen RTB Stream from Publica.");
    }
    return resp;
  }

  async function loadSitesForCurrentContext() {
    const publisherId = getPublisherId();

    if (!publisherId) { alert("Please enter Publisher ID."); throw new Error("Missing publisher_id"); }
    await loadSitesDropdown();
  }

  async function loadSitesDropdown() {
    const publisherId = getPublisherId();
    const siteSelect = document.getElementById("siteSelect");
    const siteFilterInput = document.getElementById("siteFilterInput");
    const selectAllBtn = document.getElementById("selectAllSitesBtn");
    const clearBtn = document.getElementById("clearSitesBtn");

    siteSelect.disabled = true;
    siteFilterInput.disabled = true;
    selectAllBtn.disabled = true;
    clearBtn.disabled = true;
    siteSelect.innerHTML = `<option value="">Loading sites...</option>`;

    // ✅ auto-refresh if needed
    await ensureValidToken();

    const makeUrl = () =>
      `https://api.getpublica.com/v2/settings/sites` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(publisherId)}` +
      `&preloads=SitesCronSummary` +
      `&order_by=past_week_revenue&order_direction=desc`;

    const resp = await fetchWithAutoRefresh(() => fetch(makeUrl(), { method: "GET" }));

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      siteSelect.innerHTML = `<option value="">Failed to load sites</option>`;
      throw new Error(`Sites fetch failed: ${resp.status} ${t}`);
    }

    const data = await resp.json();
    const sites = Array.isArray(data?.sites) ? data.sites : [];

    sitesByUuid.clear();
    availableSites = [];
    siteProcessedUUIDs.clear();
    siteLastSeenTimestamps.clear();
    renderDemandSourceOptions([]);
    siteSelect.innerHTML = "";

    if (sites.length === 0) {
      siteSelect.innerHTML = `<option value="">No sites found</option>`;
      siteSelect.disabled = true;
      siteFilterInput.value = "";
      siteFilterInput.disabled = true;
      selectAllBtn.disabled = true;
      clearBtn.disabled = true;
      return;
    }

    for (const s of sites) {
      if (!s?.UUID || !s?.Name) continue;
      sitesByUuid.set(s.UUID, { uuid: s.UUID, name: s.Name, id: s.ID });
      availableSites.push({ uuid: s.UUID, name: s.Name, id: s.ID });
    }

    siteFilterInput.value = "";
    renderSiteOptions();
  }

  async function loadDemandSourcesFromBidders() {
    const publisherId = getPublisherId();
    const siteUuids = getSelectedSiteUuids();

    if (!publisherId) {
      alert("Missing Publisher ID.");
      throw new Error("Missing publisher_id");
    }

    await ensureValidToken();

    const selectedSiteIds = new Set(
      siteUuids
        .map(siteUuid => sitesByUuid.get(siteUuid)?.id)
        .filter(siteId => Number.isFinite(siteId))
    );

    const makeUrl = () =>
      `https://api.getpublica.com/v2/settings/bidders` +
      `?access_token=${encodeURIComponent(accessToken)}` +
      `&publisher_id=${encodeURIComponent(publisherId)}` +
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

    const response = await fetchWithAutoRefresh(() => fetch(makeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }));
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Demand sources fetch failed: ${response.status} ${text}`);
    }

    const json = await response.json();
    const bidderInfos = Array.isArray(json?.HeaderBidderListInfo) ? json.HeaderBidderListInfo : [];

    const matchingDemandSources = bidderInfos
      .filter(info => {
        const siteIds = Array.isArray(info?.SiteIDS) ? info.SiteIDS : [];
        if (selectedSiteIds.size === 0) return true;
        return siteIds.some(siteId => selectedSiteIds.has(siteId));
      })
      .map(info => `${info?.Bidder || ""}`.trim())
      .filter(Boolean);

    return Array.from(new Set(matchingDemandSources)).sort((a, b) => a.localeCompare(b));
  }

  async function refreshCreativeDemandSources() {
    if (getSelectedStreamType() !== "creative") {
      renderDemandSourceOptions([]);
      return;
    }

    if (!getPublisherId() || !isTokenValid()) {
      renderDemandSourceOptions([]);
      return;
    }

    const demandSources = await loadDemandSourcesFromBidders();
    renderDemandSourceOptions(demandSources);
  }

  function renderSiteOptions() {
    const siteSelect = document.getElementById("siteSelect");
    const siteFilterInput = document.getElementById("siteFilterInput");
    const selectAllBtn = document.getElementById("selectAllSitesBtn");
    const clearBtn = document.getElementById("clearSitesBtn");
    const filterText = (siteFilterInput?.value || "").trim().toLowerCase();
    const selectedValues = new Set(Array.from(siteSelect.selectedOptions).map(o => o.value));

    const filteredSites = availableSites.filter(site => {
      if (!filterText) return true;
      return `${site.name} ${site.id || ""} ${site.uuid}`.toLowerCase().includes(filterText);
    });

    siteSelect.innerHTML = "";

    if (filteredSites.length === 0) {
      siteSelect.innerHTML = `<option value="">No matching sites</option>`;
      siteSelect.disabled = true;
      selectAllBtn.disabled = true;
      clearBtn.disabled = availableSites.length === 0;
      siteFilterInput.disabled = availableSites.length === 0;
      return;
    }

    filteredSites.forEach(site => {
      const opt = document.createElement("option");
      opt.value = site.uuid;
      opt.textContent = site.name;
      opt.selected = selectedValues.has(site.uuid);
      siteSelect.appendChild(opt);
    });

    siteSelect.disabled = false;
    siteFilterInput.disabled = false;
    selectAllBtn.disabled = false;
    clearBtn.disabled = false;
    syncDemandSourceControls();
  }

  // ----------------------------
  // BUTTON HANDLERS
  // ----------------------------
  document.getElementById("selectAllSitesBtn").addEventListener("click", () => {
    const siteSelect = document.getElementById("siteSelect");
    Array.from(siteSelect.options).forEach(o => { o.selected = true; });
    syncDemandSourceControls();
    refreshCreativeDemandSources().catch(error => console.error("Failed to refresh demand sources", error));
  });

  document.getElementById("clearSitesBtn").addEventListener("click", () => {
    const siteSelect = document.getElementById("siteSelect");
    Array.from(siteSelect.options).forEach(o => { o.selected = false; });
    syncDemandSourceControls();
    refreshCreativeDemandSources().catch(error => console.error("Failed to refresh demand sources", error));
  });

  document.getElementById("siteFilterInput").addEventListener("input", () => {
    renderSiteOptions();
  });

  document.getElementById("siteSelect").addEventListener("change", () => {
    syncDemandSourceControls();
    refreshCreativeDemandSources().catch(error => console.error("Failed to refresh demand sources", error));
  });

  document.getElementById("publisherSearchInput").addEventListener("input", () => {
    handlePublisherSearchInput().catch(error => {
      console.error("Failed to handle publisher search input", error);
    });
  });

  document.getElementById("publisherSearchInput").addEventListener("change", () => {
    handlePublisherSelectionChange().catch(error => {
      console.error("Failed to handle publisher selection", error);
      alert(String(error?.message || error));
    });
  });

  document.getElementById("stopFetchButton").addEventListener("click", () => {
    stopRequested = true;
    isFetching = false;
    isPaused = false;
    waitingForFirstRender = false;

    fetchLoopId++;

    for (const t of sitePollTimers.values()) clearTimeout(t);
    sitePollTimers.clear();

    activeSiteLoops.clear();

    for (const v of Array.from(activeVideos)) stopAndReleaseVideo(v);

    console.log("Stop requested: all site loops halted + timers cleared.");

    const stopBtn = document.getElementById("stopFetchButton");
    if (stopBtn) stopBtn.disabled = true;

    initializeColumns();
    setStreamStatus("", false);
    syncButtonStates();
  });

  document.getElementById("pauseButton").addEventListener("click", () => {
    if (!isFetching) return;
    isPaused = !isPaused;
    applyPauseState();
    syncButtonStates();
  });

  document.getElementById("toggleFormButton").addEventListener("click", () => {
    toggleForm();
  });

  // ----------------------------
  // UI INITIALIZATION
  // ----------------------------
  document.addEventListener("DOMContentLoaded", function() {
	  const dataItems = [
	    "ChannelName",
	    "DemandSource",
	    "BidderName",
	    "Category",
	    "AdDuration",
	    "Price",
	    "CpmPerSecond",
	    "Tier",
	    "isVault",
	    "Adomain",
	    "MediaFileURLs"
	  ];

    const defaultSelectedItems = ["MediaFileURLs"];
    const checkboxContainer = document.getElementById("dataItemsCheckboxes");

    checkboxContainer.innerHTML = "";
    dataItems.forEach(item => {
      const checkboxWrapper = document.createElement("div");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = item;
      checkbox.name = "dataItems";
      checkbox.value = item;
      if (defaultSelectedItems.includes(item)) checkbox.checked = true;

      const label = document.createElement("label");
      label.htmlFor = item;
      label.textContent = item;

      checkboxWrapper.appendChild(checkbox);
      checkboxWrapper.appendChild(label);
      checkboxContainer.appendChild(checkboxWrapper);
    });

    const streamTypeSelect = document.getElementById("streamType");
    if (streamTypeSelect) {
      streamTypeSelect.addEventListener("change", async () => {
        applyDefaultDataItemsForStreamType();
        try {
          await refreshCreativeDemandSources();
        } catch (error) {
          console.error("Failed to refresh demand sources", error);
        }
      });
    }
    applyDefaultDataItemsForStreamType();

    initializeColumns();
    renderDemandSourceOptions([]);
    syncButtonStates();

    bootstrapFromQueryParams();
  });

  async function bootstrapFromQueryParams() {
    const queryPublisherId = getBootstrapQueryValue("publisher_id");
    const queryAccessToken = getBootstrapQueryValue("access_token");
    bootstrapPublisherId = queryPublisherId || "";

    if (queryPublisherId) {
      const publisherIdField = document.getElementById("publisherIdAuth");
      if (publisherIdField && !publisherIdField.value.trim()) {
        publisherIdField.value = queryPublisherId;
      }
    }

    if (!queryAccessToken) return;
    accessToken = queryAccessToken;
    tokenExpiresAtMs = Date.now() + (12 * 60 * 60 * 1000);
    syncButtonStates();

    if (!getPublisherId()) return;

    await resolvePublisherDisplay(getPublisherId());

    try {
      await loadSitesForCurrentContext();
      await refreshCreativeDemandSources();
    } catch (e) {
      console.error("Extension bootstrap auth failed", e);
      alert(String(e?.message || e));
    } finally {
      syncButtonStates();
    }
  }

  // ----------------------------
  // CONFIG TOGGLE
  // ----------------------------
  function toggleForm() {
    const formWrapper = document.getElementById("formWrapper");
    const authWrapper = document.getElementById("authWrapper");
    const toggleButton = document.getElementById("toggleFormButton");

    const willHide = !formWrapper.classList.contains("hidden");

    formWrapper.classList.toggle("hidden");
    if (authWrapper) authWrapper.style.display = willHide ? "none" : "block";

    toggleButton.textContent = willHide ? "Show Config" : "Hide Config";
    syncButtonStates();
  }

  function getSelectedDataItems() {
    return Array.from(document.querySelectorAll('input[name="dataItems"]:checked'))
      .map(checkbox => checkbox.value);
  }

  function applyDefaultDataItemsForStreamType() {
    const defaultsByStreamType = {
      creative: ["BidderName", "AdDuration", "CpmPerSecond", "MediaFileURLs"],
      adPod: ["Adomain", "AdDuration", "Price", "CpmPerSecond", "Tier", "BidderName", "MediaFileURLs"]
    };
    const baseRowsByStreamType = {
      creative: 3,
      adPod: 2
    };

    const streamType = getSelectedStreamType();
    const selectedDefaults = defaultsByStreamType[streamType] || defaultsByStreamType.creative;
    const baseRowsInput = document.getElementById("numColumns");

    Array.from(document.querySelectorAll('input[name="dataItems"]')).forEach(checkbox => {
      checkbox.checked = selectedDefaults.includes(checkbox.value);
    });

    if (baseRowsInput) {
      baseRowsInput.value = baseRowsByStreamType[streamType] || baseRowsByStreamType.creative;
    }
    syncDemandSourceControls();
  }

  function initializeColumns() {
    const tablesWrapper = document.getElementById("tablesWrapper");
    tablesWrapper.innerHTML = "";

    const numColumns = parseInt(document.getElementById("numColumns").value, 10) || 3;

    for (let i = 1; i <= numColumns; i++) {
      const baseTable = document.createElement("div");
      baseTable.id = `baseTable${i}`;
      baseTable.classList.add("base-table");
      tablesWrapper.appendChild(baseTable);
    }
  }

  // ----------------------------
  // MULTI-SITE FETCH
  // ----------------------------
  function getSelectedSiteUuids() {
    const sel = document.getElementById("siteSelect");
    return Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);
  }

  async function runWithConcurrency(items, limit, workerFn, options = {}) {
    const requireActiveFetch = options.requireActiveFetch !== false;
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length && !stopRequested && (!requireActiveFetch || isFetching)) {
        const item = queue.shift();
        try { await workerFn(item); }
        catch (e) { console.error("Worker error:", e); }
      }
    });
    await Promise.all(workers);
  }

  async function fetchLiveLogsForSite(siteUuid, loopId) {
    if (stopRequested || !isFetching || loopId !== fetchLoopId) return;

    const publisherId = getPublisherId();
    const payload = { type: 3028, site_uuid: siteUuid };

    try {
      await ensureValidToken();

      const makeUrl = () =>
        `https://api.getpublica.com/v1/settings/live_logs` +
        `?access_token=${encodeURIComponent(accessToken)}` +
        `&publisher_id=${encodeURIComponent(publisherId)}`;

      const makeReq = () => fetch(makeUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const response = await fetchWithAutoRefresh(makeReq);

      if (!response.ok) {
        if (response.status === 401) {
          handleAuthFailure("Token expired. Reopen RTB Stream from Publica.");
          alert("Unauthorized. Reopen RTB Stream from Publica.");
          return;
        }
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      await processLiveLogs(data, loopId, siteUuid);

      if (!stopRequested && isFetching && loopId === fetchLoopId && activeSiteLoops.get(siteUuid) === loopId) {
        const jitter = 150 + Math.floor(Math.random() * 250);
        const tid = setTimeout(() => fetchLiveLogsForSite(siteUuid, loopId), jitter);
        sitePollTimers.set(siteUuid, tid);
      }
    } catch (err) {
      console.error(`Error fetching site ${siteUuid}:`, err);

      if (!stopRequested && isFetching && loopId === fetchLoopId && activeSiteLoops.get(siteUuid) === loopId) {
        const tid = setTimeout(() => fetchLiveLogsForSite(siteUuid, loopId), 500);
        sitePollTimers.set(siteUuid, tid);
      }
    }
  }

  document.getElementById("fetchDataButton").addEventListener("click", async () => {
    try {
      await ensureValidToken();
    } catch (e) {
      alert("Missing or expired token. Reopen RTB Stream from Publica.");
      syncButtonStates();
      return;
    }

    const publisherId = getPublisherId();
    const siteUuids = getSelectedSiteUuids();

    if (!publisherId) { alert("Missing Publisher ID."); syncButtonStates(); return; }
    if (siteUuids.length === 0) { alert("Please select one or more Sites."); syncButtonStates(); return; }

    stopRequested = false;
    isFetching = true;
    isPaused = false;

    for (const t of sitePollTimers.values()) clearTimeout(t);
    sitePollTimers.clear();

    const myLoopId = ++fetchLoopId;

    currentFetchTimestamp = Date.now();
    siteProcessedUUIDs.clear();
    siteLastSeenTimestamps.clear();
    waitingForFirstRender = true;
    initializeColumns();
    setStreamStatus(getLoadingStatusMessage(siteUuids), true);

    const stopBtn = document.getElementById("stopFetchButton");
    if (stopBtn) stopBtn.disabled = false;

    syncButtonStates();

    activeSiteLoops.clear();
    await runWithConcurrency(siteUuids, MAX_PARALLEL_SITES, async (siteUuid) => {
      if (stopRequested || !isFetching || myLoopId !== fetchLoopId) return;
      activeSiteLoops.set(siteUuid, myLoopId);
      await fetchLiveLogsForSite(siteUuid, myLoopId);
    });
  });

  let processingModeChanged = false;

  document.getElementById("circularMode").addEventListener("change", () => {
    const circularMode = document.getElementById("circularMode").checked;

    if (!circularMode) {
      siteProcessedUUIDs.clear();
      siteLastSeenTimestamps.clear();
      currentFetchTimestamp = Date.now();
      console.log("Circular Mode turned OFF. Reset processed UUIDs and timestamp.");
    } else {
      console.log("Circular Mode turned ON. All items will be processed.");
    }
    processingModeChanged = true;
  });

  async function processLiveLogs(dataArray, loopId, siteUuid) {
    const minDelay = 800;
    const maxDelay = 1300;
    const circularMode = document.getElementById("circularMode").checked;
    const streamType = getSelectedStreamType();

    processingModeChanged = false;

    let perSiteMap = siteProcessedUUIDs.get(siteUuid);
    if (!perSiteMap) {
      perSiteMap = new Map();
      siteProcessedUUIDs.set(siteUuid, perSiteMap);
    }

    const minTimestamp = circularMode
      ? Number.NEGATIVE_INFINITY
      : (siteLastSeenTimestamps.get(siteUuid) ?? currentFetchTimestamp);

    const itemsToProcess = (Array.isArray(dataArray) ? dataArray : [])
      .filter(item => isWithinLookback(item?.timestamp))
      .filter(item => {
        if (circularMode) return true;
        const endpointUUID = item?.endpointUUID;
        const itemTimestamp = new Date(item?.timestamp).getTime();
        if (!isFinite(itemTimestamp) || itemTimestamp < minTimestamp) return false;
        if (endpointUUID && perSiteMap.has(endpointUUID)) return false;
        return true;
      })
      .sort((a, b) => new Date(a?.timestamp).getTime() - new Date(b?.timestamp).getTime());

    mergeDemandSources(collectDemandSourcesFromLogs(itemsToProcess));

    const totalItems = itemsToProcess.length;
    let processedCount = 0;
    let latestSeenTimestamp = minTimestamp;

    for (const item of itemsToProcess) {
      if (stopRequested || !isFetching || loopId !== fetchLoopId) return;
      if (processingModeChanged) return;

      await waitWhilePaused(loopId);
      if (stopRequested || !isFetching || loopId !== fetchLoopId) return;
      if (processingModeChanged) return;

      const endpointUUID = item.endpointUUID;
      const itemTimestamp = new Date(item.timestamp).getTime();

      if (!circularMode) {
        if (!isFinite(itemTimestamp) || itemTimestamp < minTimestamp) continue;

        if (endpointUUID) {
          if (perSiteMap.size >= MAX_PROCESSED_UUIDS) {
            const oldestUUID = perSiteMap.keys().next().value;
            perSiteMap.delete(oldestUUID);
          }
          perSiteMap.set(endpointUUID, itemTimestamp);
        }
        latestSeenTimestamp = Math.max(latestSeenTimestamp, itemTimestamp + 1);
      }

      if (Array.isArray(item.EndpointResponseAds)) {
        await waitWhilePaused(loopId);
        if (stopRequested || !isFetching || loopId !== fetchLoopId) return;

        const delay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
        await new Promise(r => setTimeout(r, delay));
        await waitWhilePaused(loopId);
        if (stopRequested || !isFetching || loopId !== fetchLoopId) return;

        if (streamType === "adPod") {
          addPodTable(item, siteUuid);
        } else {
          for (const ad of item.EndpointResponseAds) {
            if (stopRequested || !isFetching || loopId !== fetchLoopId) return;
            await waitWhilePaused(loopId);
            if (stopRequested || !isFetching || loopId !== fetchLoopId) return;
            if (!adMatchesDemandSource(ad)) continue;
            addInnerTable(ad, siteUuid);
          }
        }
      }

      processedCount++;
      if (processedCount % 10 === 0) {
        const h = getLookbackHours();
        console.log(`[${siteUuid}] Processed ${processedCount}/${totalItems}` + (h === 0 ? " (ALL)" : ` (last ${h}h)`));
      }
    }

    if (!circularMode && isFinite(latestSeenTimestamp)) {
      siteLastSeenTimestamps.set(siteUuid, latestSeenTimestamp);
    }
  }

  // ----------------------------
  // RENDERING
  // ----------------------------
  function getSlotNumber(ad) {
    if (!ad || typeof ad !== "object") return null;

    const candidates = [
      ad.SlotNumber,
      ad["Slot Number"],
      ad["Slot number"],
      ad.slotNumber,
      ad.slot_number,
      ad.slot
    ];

    for (const candidate of candidates) {
      const n = Number(candidate);
      if (isFinite(n)) return n;
    }

    const slotKey = Object.keys(ad).find(key => /slot/i.test(key));
    if (slotKey) {
      const n = Number(ad[slotKey]);
      if (isFinite(n)) return n;
    }

    return null;
  }

  function finishVideoPlayback(videoElement) {
    try { videoElement.pause(); } catch {}
    activeVideos.delete(videoElement);
  }

  function createVideoElement(url, widthPx, options = {}) {
    if (!url) return null;
    const maxSeconds = getVideoPlaySeconds();
    const previewOnly = maxSeconds <= 1;
    if (!previewOnly && !canStartAnotherVideo()) return null;

    const videoLink = document.createElement("a");
    videoLink.href = url;
    videoLink.target = "_blank";
    videoLink.rel = "noopener noreferrer";
    videoLink.style.display = "inline-block";
    videoLink.style.lineHeight = "0";
    videoLink.style.cursor = "pointer";

    const videoElement = document.createElement("video");
    videoElement.preload = previewOnly ? "auto" : "metadata";
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.loop = false;
    videoElement.autoplay = !previewOnly;
    videoElement.style.width = `${widthPx}px`;
    videoElement.style.height = "auto";
    videoElement.style.borderRadius = "8px";
    videoElement.style.cursor = "pointer";
    videoElement.dataset.previewOnly = previewOnly ? "true" : "false";

    if (!previewOnly) {
      activeVideos.add(videoElement);
    }

    videoElement.src = url;
    if (isPaused || previewOnly) videoElement.autoplay = false;

    if (previewOnly) {
      let previewLocked = false;
      const lockPreviewFrame = () => {
        if (previewLocked) return;
        previewLocked = true;
        try {
          if (videoElement.readyState >= 2) {
            const targetTime = Number.isFinite(videoElement.duration) && videoElement.duration > 0.05 ? 0.01 : 0;
            videoElement.currentTime = targetTime;
          }
        } catch {}
        try { videoElement.pause(); } catch {}
      };

      videoElement.addEventListener("loadeddata", lockPreviewFrame);
      videoElement.addEventListener("seeked", () => {
        try { videoElement.pause(); } catch {}
      });
      videoElement.addEventListener("error", () => stopAndReleaseVideo(videoElement));
    } else {
      const onTimeUpdate = () => {
        if (videoElement.currentTime >= maxSeconds) {
          videoElement.removeEventListener("timeupdate", onTimeUpdate);
          finishVideoPlayback(videoElement);
        }
      };
      videoElement.addEventListener("timeupdate", onTimeUpdate);
      videoElement.addEventListener("error", () => stopAndReleaseVideo(videoElement));
      videoElement.addEventListener("ended", () => finishVideoPlayback(videoElement));
      videoElement.addEventListener("loadedmetadata", () => {
        if (isPaused) {
          try { videoElement.pause(); } catch {}
        }
      });
    }

    videoElement.addEventListener("mouseenter", () => temporarilyResumeVideoOnHover(videoElement));
    videoElement.addEventListener("mouseleave", () => rePauseVideoAfterHover(videoElement));

    videoLink.appendChild(videoElement);
    return videoLink;
  }

  function getRowGap(streamType) {
    return streamType === "creative" ? CREATIVE_ROW_ITEM_GAP : ROW_ITEM_GAP;
  }

  function getRowMetrics(baseTable, streamType) {
    const baseRect = baseTable.getBoundingClientRect();
    let rightmost = 0;
    const gap = getRowGap(streamType);

    Array.from(baseTable.children).forEach(child => {
      const rect = child.getBoundingClientRect();
      rightmost = Math.max(rightmost, rect.right - baseRect.left);
    });

    return {
      baseRect,
      rightmost,
      childCount: baseTable.children.length,
      startX: Math.max((baseRect.width || 0) + gap, rightmost + gap)
    };
  }

  function pickBaseRow(streamType) {
    const numColumns = parseInt(document.getElementById("numColumns").value, 10) || 3;
    let bestBaseTable = null;
    let bestMetrics = null;

    for (let i = 1; i <= numColumns; i++) {
      const baseTable = document.getElementById(`baseTable${i}`);
      if (!baseTable) continue;

      const metrics = getRowMetrics(baseTable, streamType);
      if (
        !bestBaseTable ||
        metrics.startX < bestMetrics.startX ||
        (metrics.startX === bestMetrics.startX && metrics.childCount < bestMetrics.childCount)
      ) {
        bestBaseTable = baseTable;
        bestMetrics = metrics;
      }
    }

    return { baseTable: bestBaseTable, metrics: bestMetrics };
  }

  function createFallingContainer(widthPx, siteUuid, ad) {
    const fallSpeed = parseFloat(document.getElementById("fallSpeed").value) || 6;
    const streamType = getSelectedStreamType();
    const gap = getRowGap(streamType);
    const { baseTable, metrics } = pickBaseRow(streamType);
    if (!baseTable || !metrics) return null;
    const { baseRect, startX } = metrics;

    const innerTableContainer = document.createElement("div");
    innerTableContainer.classList.add("inner-table-container", "falling");
    innerTableContainer.style.width = widthPx + "px";
    innerTableContainer.style.left = `${startX}px`;
    innerTableContainer.style.top = "50%";
    innerTableContainer.style.transform = "translateY(-50%)";

    const baseWidth = Math.max(baseRect.width || 0, window.innerWidth || 0, 1);
    const totalDistance = startX + widthPx + gap;
    const pixelsPerSecond = baseWidth / Math.max(fallSpeed, 0.1);
    innerTableContainer.style.setProperty("--slide-distance", `${totalDistance}px`);
    innerTableContainer.style.animationDuration = `${totalDistance / pixelsPerSecond}s`;

    baseTable.appendChild(innerTableContainer);
    setTimeout(() => innerTableContainer.classList.add("visible"), 1);
    if (isPaused) innerTableContainer.style.animationPlayState = "paused";

    innerTableContainer.addEventListener("animationend", () => {
      innerTableContainer.querySelectorAll("video").forEach(v => stopAndReleaseVideo(v));
      innerTableContainer.remove();
    });

    return innerTableContainer;
  }

  function updateBaseRowHeight(innerTableContainer) {
    const baseTable = innerTableContainer?.parentElement;
    if (!baseTable) return;

    requestAnimationFrame(() => {
      let tallest = 170;
      Array.from(baseTable.children).forEach(child => {
        const childHeight = Math.ceil(child.getBoundingClientRect().height) + 20;
        tallest = Math.max(tallest, childHeight);
      });
      baseTable.style.height = `${tallest}px`;
    });
  }

  function getFirstAdValue(ad, keys) {
    if (!ad) return undefined;
    for (const key of keys) {
      const value = ad[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  }

  function formatAdValue(ad, item, channelName) {
    if (item === "ChannelName") return channelName;
    if (item === "Adomain") return ad.Adomain || "N/A";
    if (item === "isVault") {
      const value = getFirstAdValue(ad, [
        "isVault",
        "IsVault",
        "is_vault",
        "vault",
        "Vault",
        "isBidSaver",
        "IsBidSaver",
        "is_bid_saver",
        "bidSaver",
        "BidSaver"
      ]);
      return value !== undefined ? value : "N/A";
    }
    return (ad[item] !== undefined && ad[item] !== null && ad[item] !== "") ? ad[item] : "N/A";
  }

  function createBidderLink(ad) {
    const bidderId = ad?.BidderID;
    const bidderName = ad?.BidderName;
    const publisherId = getPublisherId();

    if (!bidderId || !bidderName || !publisherId) return null;

    const link = document.createElement("a");
    link.href = `https://app.getpublica.com/#/app/pub/${encodeURIComponent(publisherId)}/bidder-settings/bidder/${encodeURIComponent(bidderId)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = bidderName;
    link.style.color = "inherit";
    link.style.textDecoration = "underline";
    link.style.cursor = "pointer";
    return link;
  }

  function createChannelLink(siteUuid, labelText) {
    const publisherId = getPublisherId();
    const site = sitesByUuid.get(siteUuid);
    const siteId = site?.id;
    const channelName = labelText || site?.name || "Unknown Channel";

    if (!publisherId || !siteId) return null;

    const link = document.createElement("a");
    link.href = `https://app.getpublica.com/#/app/pub/${encodeURIComponent(publisherId)}/channel/${encodeURIComponent(siteId)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = channelName;
    link.style.color = "inherit";
    link.style.textDecoration = "underline";
    link.style.cursor = "pointer";
    return link;
  }

  function createAdomainLink(ad) {
    const rawDomain = `${ad?.Adomain || ""}`.trim();
    if (!rawDomain || rawDomain === "N/A") return null;

    const href = /^https?:\/\//i.test(rawDomain) ? rawDomain : `https://${rawDomain}`;
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = rawDomain;
    link.style.color = "inherit";
    link.style.textDecoration = "underline";
    link.style.cursor = "pointer";
    return link;
  }

  function addInnerTable(ad, siteUuid) {
    const channelName = sitesByUuid.get(siteUuid)?.name || "Unknown Channel";
    const { minFontSize, maxFontSize, minVideoSize, maxVideoSize, minTableWidth, maxTableWidth, minPrice, maxPrice } = VISUAL_DEFAULTS;

    const price = parseFloat(ad.CpmPerSecond) || 0;
    const duration = parseFloat(ad.AdDuration) || 0;
    const tileWidthPx = getTileWidthPx();

    const fontSize = Math.min(
      Math.max(((price - minPrice) / (maxPrice - minPrice)) * (maxFontSize - minFontSize) + minFontSize, minFontSize),
      maxFontSize
    );

    const videoSize = Math.min(
      Math.max(((price - minPrice) / (maxPrice - minPrice)) * (maxVideoSize - minVideoSize) + minVideoSize, minVideoSize),
      maxVideoSize
    );

    const widthFromDuration = Math.min(Math.max(duration, minTableWidth), maxTableWidth);
    const videoWidthPx = Math.max(120, tileWidthPx - 16);
    const renderedVideoWidthPx = Math.max(videoWidthPx, videoSize * 10);
    const tableWidth = Math.max(tileWidthPx, widthFromDuration, renderedVideoWidthPx + 16);
    const bodyFontSize = getScaledFontPx(fontSize);

    const minPriceColor = hexToRgb(VISUAL_DEFAULTS.minPriceColor);
    const maxPriceColor = hexToRgb(VISUAL_DEFAULTS.maxPriceColor);
    const backgroundColor = interpolateColor(minPriceColor, maxPriceColor, (price - minPrice) / (maxPrice - minPrice));

    const minFontColor = hexToRgb(VISUAL_DEFAULTS.minFontColor);
    const maxFontColor = hexToRgb(VISUAL_DEFAULTS.maxFontColor);
    const fontColor = interpolateColor(minFontColor, maxFontColor, (price - minPrice) / (maxPrice - minPrice));

    const innerTableContainer = createFallingContainer(tableWidth, siteUuid, ad);
    if (!innerTableContainer) return;
    markFirstRenderComplete();

    const innerTable = document.createElement("table");
    innerTable.classList.add("inner-table");
    innerTable.style.borderRadius = "8px";
    innerTable.style.width = `${tableWidth}px`;

    const selectedDataItems = getSelectedDataItems();

    if (selectedDataItems.includes("MediaFileURLs") && Array.isArray(ad.MediaFileURLs) && ad.MediaFileURLs.length > 0) {
      const videoRow = document.createElement("tr");
      const videoCell = document.createElement("td");
      videoCell.colSpan = Math.max(1, selectedDataItems.length);
      const videoElement = createVideoElement(ad.MediaFileURLs[0], renderedVideoWidthPx);
      if (videoElement) videoCell.appendChild(videoElement);
      videoRow.appendChild(videoCell);
      innerTable.appendChild(videoRow);
    }

    const newRow = document.createElement("tr");

	selectedDataItems.forEach(item => {
	  if (item === "MediaFileURLs") return;

	  const cell = document.createElement("td");
	  cell.style.fontSize = `${bodyFontSize}px`;
	  cell.style.backgroundColor = backgroundColor;
	  cell.style.color = fontColor;

	  if (item === "BidderName") {
      const bidderLink = createBidderLink(ad);
      if (bidderLink) {
        cell.appendChild(bidderLink);
      } else {
        cell.textContent = formatAdValue(ad, item, channelName);
      }
    } else if (item === "Adomain") {
      const adomainLink = createAdomainLink(ad);
      if (adomainLink) {
        cell.appendChild(adomainLink);
      } else {
        cell.textContent = formatAdValue(ad, item, channelName);
      }
    } else if (item === "ChannelName") {
      const channelLink = createChannelLink(siteUuid, channelName);
      if (channelLink) {
        cell.appendChild(channelLink);
      } else {
        cell.textContent = formatAdValue(ad, item, channelName);
      }
    } else {
      cell.textContent = formatAdValue(ad, item, channelName);
    }

	  newRow.appendChild(cell);
	});

    innerTable.appendChild(newRow);

    innerTableContainer.appendChild(innerTable);
    updateBaseRowHeight(innerTableContainer);
  }

  function addPodTable(item, siteUuid) {
    const ads = (Array.isArray(item?.EndpointResponseAds) ? item.EndpointResponseAds : [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => {
        const slotA = getSlotNumber(a);
        const slotB = getSlotNumber(b);
        const safeA = isFinite(slotA) ? slotA : Number.MAX_SAFE_INTEGER;
        const safeB = isFinite(slotB) ? slotB : Number.MAX_SAFE_INTEGER;
        return safeA - safeB;
      });

    if (ads.length === 0) return;

    const firstAd = ads[0];
    const channelName = sitesByUuid.get(siteUuid)?.name || "Unknown Channel";
    const { minFontSize, maxFontSize, minVideoSize, maxVideoSize, minPrice, maxPrice } = VISUAL_DEFAULTS;
    const price = parseFloat(firstAd.CpmPerSecond) || 0;
    const tileWidthPx = getTileWidthPx();
    const ratio = maxPrice > minPrice ? Math.min(1, Math.max(0, (price - minPrice) / (maxPrice - minPrice))) : 0;
    const fontSize = Math.min(Math.max(ratio * (maxFontSize - minFontSize) + minFontSize, minFontSize), maxFontSize);
    const videoSize = Math.min(Math.max(ratio * (maxVideoSize - minVideoSize) + minVideoSize, minVideoSize), maxVideoSize);
    const minPriceColor = hexToRgb(VISUAL_DEFAULTS.minPriceColor);
    const maxPriceColor = hexToRgb(VISUAL_DEFAULTS.maxPriceColor);
    const backgroundColor = interpolateColor(minPriceColor, maxPriceColor, ratio);
    const minFontColor = hexToRgb(VISUAL_DEFAULTS.minFontColor);
    const maxFontColor = hexToRgb(VISUAL_DEFAULTS.maxFontColor);
    const fontColor = interpolateColor(minFontColor, maxFontColor, ratio);
    const slotVideoWidthPx = Math.max(120, tileWidthPx - 16);
    const titleFontSize = getScaledFontPx(fontSize);
    const metaFontSize = getScaledFontPx(Math.max(12, fontSize * 0.8));
    const rawSelectedDataItems = getSelectedDataItems();
    const showMediaFiles = rawSelectedDataItems.includes("MediaFileURLs");
    const selectedDataItems = rawSelectedDataItems.filter(itemName => itemName !== "MediaFileURLs");
    const slotWidthPx = Math.max(
      tileWidthPx,
      showMediaFiles ? Math.max(slotVideoWidthPx, videoSize * 6) + 16 : tileWidthPx
    );
    const podWidth = Math.max(360, ads.length * (slotWidthPx + 12) + 40);

    const innerTableContainer = createFallingContainer(podWidth, siteUuid, firstAd);
    if (!innerTableContainer) return;
    markFirstRenderComplete();
    innerTableContainer.classList.add("pod-table");

    const innerTable = document.createElement("table");
    innerTable.classList.add("inner-table");
    innerTable.style.borderRadius = "8px";
    innerTable.style.backgroundColor = backgroundColor;
    innerTable.style.color = fontColor;

    const headerRow = document.createElement("tr");
    const headerCell = document.createElement("td");
    headerCell.classList.add("pod-header");
    const channelLink = createChannelLink(siteUuid, channelName);
    if (channelLink) {
      headerCell.appendChild(channelLink);
    } else {
      headerCell.textContent = channelName;
    }
    headerRow.appendChild(headerCell);
    innerTable.appendChild(headerRow);

    const slotsRow = document.createElement("tr");
    const slotsCell = document.createElement("td");
    const slotsWrap = document.createElement("div");
    slotsWrap.classList.add("pod-slots");

    ads.forEach(ad => {
      const slotCard = document.createElement("div");
      slotCard.classList.add("pod-slot");
      slotCard.style.width = `${slotWidthPx}px`;
      slotCard.style.minWidth = `${slotWidthPx}px`;
      slotCard.style.maxWidth = `${slotWidthPx}px`;

      const slotNumber = getSlotNumber(ad);
      const slotTitle = document.createElement("div");
      slotTitle.classList.add("pod-slot-title");
      slotTitle.style.fontSize = `${titleFontSize}px`;
      slotTitle.textContent = `Slot ${isFinite(slotNumber) ? slotNumber : "?"}`;
      slotCard.appendChild(slotTitle);

      if (showMediaFiles && Array.isArray(ad.MediaFileURLs) && ad.MediaFileURLs.length > 0) {
        const videoElement = createVideoElement(ad.MediaFileURLs[0], Math.max(slotVideoWidthPx, videoSize * 6));
        if (videoElement) slotCard.appendChild(videoElement);
      }

      const meta = document.createElement("div");
      meta.classList.add("pod-slot-meta");
      meta.style.fontSize = `${metaFontSize}px`;
      meta.style.color = fontColor;

      if (selectedDataItems.length === 0) {
        const fallback = document.createElement("div");
        const adomainLink = createAdomainLink(ad);
        if (adomainLink) {
          fallback.appendChild(adomainLink);
        } else {
          fallback.textContent = formatAdValue(ad, "Adomain", channelName);
        }
        meta.appendChild(fallback);
      } else {
        selectedDataItems.forEach(itemName => {
          const line = document.createElement("div");
          if (itemName === "BidderName") {
            line.textContent = `${itemName}: `;
            const bidderLink = createBidderLink(ad);
            if (bidderLink) {
              line.appendChild(bidderLink);
            } else {
              line.textContent = `${itemName}: ${formatAdValue(ad, itemName, channelName)}`;
            }
          } else if (itemName === "Adomain") {
            line.textContent = `${itemName}: `;
            const adomainLink = createAdomainLink(ad);
            if (adomainLink) {
              line.appendChild(adomainLink);
            } else {
              line.textContent = `${itemName}: ${formatAdValue(ad, itemName, channelName)}`;
            }
          } else if (itemName === "ChannelName") {
            line.textContent = `${itemName}: `;
            const inlineChannelLink = createChannelLink(siteUuid, channelName);
            if (inlineChannelLink) {
              line.appendChild(inlineChannelLink);
            } else {
              line.textContent = `${itemName}: ${formatAdValue(ad, itemName, channelName)}`;
            }
          } else {
            line.textContent = `${itemName}: ${formatAdValue(ad, itemName, channelName)}`;
          }
          meta.appendChild(line);
        });
      }

      slotCard.appendChild(meta);
      slotsWrap.appendChild(slotCard);
    });

    slotsCell.appendChild(slotsWrap);
    slotsRow.appendChild(slotsCell);
    innerTable.appendChild(slotsRow);
    innerTableContainer.appendChild(innerTable);
    updateBaseRowHeight(innerTableContainer);
  }

  // ----------------------------
  // COLOR HELPERS
  // ----------------------------
  function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  }

  function interpolateColor(color1, color2, factor) {
    const safe = isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 0;
    const r = Math.round(color1.r + (color2.r - color1.r) * safe);
    const g = Math.round(color1.g + (color2.g - color1.g) * safe);
    const b = Math.round(color1.b + (color2.b - color1.b) * safe);
    return `rgb(${r}, ${g}, ${b})`;
  }
