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

  function setDemandSourceStatus(message) {
    const statusEl = document.getElementById("demandSourceStatus");
    if (statusEl) statusEl.textContent = message || "";
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
    const populateBtn = document.getElementById("populateDemandSourcesButton");
    const demandSourceSelect = document.getElementById("demandSourceSelect");
    const demandSourceLabel = document.querySelector('label[for="demandSourceSelect"]');
    const demandSourceStatus = document.getElementById("demandSourceStatus");
    const fieldHelp = demandSourceSelect?.parentElement?.querySelector(".field-help");
    const hasSites = getSelectedSiteUuids().length > 0;
    const canPopulate = isTokenValid() && hasSites;
    const hasOptions = knownDemandSources.length > 0;
    const visible = streamType === "creative";

    if (populateBtn) {
      populateBtn.disabled = !canPopulate;
      populateBtn.style.display = visible ? "" : "none";
    }

    if (demandSourceSelect) {
      demandSourceSelect.disabled = !visible || !hasOptions;
    }

    if (demandSourceLabel) demandSourceLabel.style.display = visible ? "" : "none";
    if (demandSourceSelect) demandSourceSelect.style.display = visible ? "" : "none";
    if (demandSourceStatus) demandSourceStatus.style.display = visible ? "" : "none";
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
  let refreshToken = null;      // ✅ NEW: store refresh token
  let tokenExpiresAtMs = 0;

  // ✅ NEW: avoid multiple refresh calls in parallel
  let refreshInFlight = null;

  let currentFetchTimestamp = 0;
  let sitesByUuid = new Map();

  let isFetching = false;
  let isPaused = false;
  let stopRequested = false;
  let fetchLoopId = 0;
  let waitingForFirstRender = false;
  let knownDemandSources = [];

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
    setBtnActive("authButton", isTokenValid(), "is-active");
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

  function getBootstrapQueryValue(key) {
    try {
      return new URLSearchParams(window.location.search).get(key)?.trim() || "";
    } catch {
      return "";
    }
  }

  function getManualAccessToken() {
    return document.getElementById("authAccessToken")?.value.trim() || "";
  }

  function setTokenStatus(text) {
    document.getElementById("tokenStatus").textContent = text;
  }

  // treat token as valid if it won't expire in the next 10s
  function isTokenValid() {
    return !!accessToken && Date.now() < (tokenExpiresAtMs - 10_000);
  }

  function hasRefreshToken() {
    return !!refreshToken;
  }

  function handleAuthFailure(message) {
    console.warn(message || "Auth failure");
    accessToken = null;
    refreshToken = null;
    tokenExpiresAtMs = 0;

    setTokenStatus("Token: (not authenticated)");
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

  async function refreshAccessToken() {
    if (!hasRefreshToken()) {
      throw new Error("No refresh token available. Please authenticate again.");
    }

    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const tokenUrl = "https://api.getpublica.com/v1/oauth/tokens";
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        reseller_id: "-1"
      });

      setTokenStatus("Token: refreshing...");
      syncButtonStates();

      const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`Refresh failed: ${resp.status} ${t}`);
      }

      const json = await resp.json();

      if (!json.access_token) throw new Error("Refresh response missing access_token");

      accessToken = json.access_token;
      // refresh token may rotate — if returned, replace it
      if (json.refresh_token) refreshToken = json.refresh_token;

      tokenExpiresAtMs = Date.now() + (Number(json.expires_in || 3600) * 1000);

      setTokenStatus(`Token: OK (refreshed, expires ${new Date(tokenExpiresAtMs).toLocaleString()})`);
      syncButtonStates();

      return accessToken;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  // Ensures we have a usable token; refreshes if needed/near expiry
  async function ensureValidToken() {
    if (isTokenValid()) return accessToken;

    if (hasRefreshToken()) {
      return await refreshAccessToken();
    }

    throw new Error("Token expired and no refresh token. Please authenticate again.");
  }

  // A small helper that retries once on 401 by refreshing the token
  async function fetchWithAutoRefresh(makeRequestFn) {
    // makeRequestFn should create and execute fetch using the CURRENT accessToken
    let resp = await makeRequestFn();
    if (resp.status !== 401) return resp;

    // try refresh + retry once
    try {
      await refreshAccessToken();
    } catch (e) {
      throw e;
    }

    resp = await makeRequestFn();
    return resp;
  }

  async function authenticateAndLoadSites() {
    const publisherId = getPublisherId();
    const username = document.getElementById("authUsername").value.trim();
    const password = document.getElementById("authPassword").value;
    const manualAccessToken = getManualAccessToken();

    if (!publisherId) { alert("Please enter Publisher ID."); throw new Error("Missing publisher_id"); }

    if (manualAccessToken) {
      accessToken = manualAccessToken;
      refreshToken = null;
      tokenExpiresAtMs = Date.now() + (12 * 60 * 60 * 1000);
      setTokenStatus("Token: OK (manual access token)");
      syncButtonStates();
      await loadSitesDropdown();
      return;
    }

    if (!username || !password) { alert("Please enter username and password, or paste an access token."); throw new Error("Missing credentials"); }

    const tokenUrl = "https://api.getpublica.com/v1/oauth/tokens";
    const tokenBody = new URLSearchParams({
      grant_type: "password",
      username,
      password,
      reseller_id: "-1"
    });

    setTokenStatus("Token: authenticating...");
    syncButtonStates();

    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    });

    if (!tokenResp.ok) {
      const t = await tokenResp.text().catch(() => "");
      setTokenStatus(`Token: failed (${tokenResp.status})`);
      accessToken = null;
      refreshToken = null;
      tokenExpiresAtMs = 0;
      syncButtonStates();
      throw new Error(`Auth failed: ${tokenResp.status} ${t}`);
    }

    const tokenJson = await tokenResp.json();
    if (!tokenJson.access_token) {
      setTokenStatus("Token: invalid response");
      accessToken = null;
      refreshToken = null;
      tokenExpiresAtMs = 0;
      syncButtonStates();
      throw new Error("No access_token in response");
    }

    accessToken = tokenJson.access_token;
    refreshToken = tokenJson.refresh_token || refreshToken || null; // ✅ capture refresh token
    tokenExpiresAtMs = Date.now() + (Number(tokenJson.expires_in || 3600) * 1000);

    setTokenStatus(`Token: OK (expires ${new Date(tokenExpiresAtMs).toLocaleString()})`);
    syncButtonStates();

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
    setDemandSourceStatus("Select site(s), then populate the list.");
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
  document.getElementById("authButton").addEventListener("click", async () => {
    try {
      await authenticateAndLoadSites();
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      syncButtonStates();
    }
  });

  document.getElementById("selectAllSitesBtn").addEventListener("click", () => {
    const siteSelect = document.getElementById("siteSelect");
    Array.from(siteSelect.options).forEach(o => { o.selected = true; });
    syncDemandSourceControls();
  });

  document.getElementById("clearSitesBtn").addEventListener("click", () => {
    const siteSelect = document.getElementById("siteSelect");
    Array.from(siteSelect.options).forEach(o => { o.selected = false; });
    syncDemandSourceControls();
  });

  document.getElementById("siteFilterInput").addEventListener("input", () => {
    renderSiteOptions();
  });

  document.getElementById("siteSelect").addEventListener("change", () => {
    syncDemandSourceControls();
  });

  document.getElementById("populateDemandSourcesButton").addEventListener("click", async () => {
    try {
      await ensureValidToken();
    } catch (e) {
      alert("Please Authenticate first (token missing/expired and cannot refresh).");
      syncButtonStates();
      return;
    }

    const publisherId = getPublisherId();
    const siteUuids = getSelectedSiteUuids();

    if (!publisherId) { alert("Missing Publisher ID."); syncButtonStates(); return; }
    if (siteUuids.length === 0) { alert("Please select one or more Sites."); syncButtonStates(); return; }

    setDemandSourceStatus("Loading demand sources...");

    const discoveredDemandSources = new Set();

    try {
      await runWithConcurrency(siteUuids, MAX_PARALLEL_SITES, async (siteUuid) => {
        const payload = { type: 3028, site_uuid: siteUuid };
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
            handleAuthFailure("401 even after refresh. Please authenticate again.");
            throw new Error("Unauthorized even after refresh. Please Authenticate again.");
          }
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        collectDemandSourcesFromLogs(data).forEach(source => discoveredDemandSources.add(source));
      }, { requireActiveFetch: false });

      renderDemandSourceOptions(Array.from(discoveredDemandSources));
      setDemandSourceStatus(
        discoveredDemandSources.size > 0
          ? `Loaded ${discoveredDemandSources.size} demand source${discoveredDemandSources.size === 1 ? "" : "s"}.`
          : "No demand sources found in the selected sites' live logs."
      );
    } catch (e) {
      console.error(e);
      setDemandSourceStatus("Failed to load demand sources.");
      alert(String(e?.message || e));
    } finally {
      syncButtonStates();
    }
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
      streamTypeSelect.addEventListener("change", applyDefaultDataItemsForStreamType);
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

    if (queryPublisherId) {
      const publisherField = document.getElementById("publisherIdAuth");
      if (publisherField && !publisherField.value.trim()) {
        publisherField.value = queryPublisherId;
      }
    }

    if (!queryAccessToken) return;

    const accessTokenField = document.getElementById("authAccessToken");
    if (accessTokenField && !accessTokenField.value.trim()) {
      accessTokenField.value = queryAccessToken;
    }

    setTokenStatus("Token: loading from extension...");
    syncButtonStates();

    if (!getPublisherId()) {
      setTokenStatus("Token: loaded from extension (enter Publisher ID to load sites)");
      return;
    }

    try {
      await authenticateAndLoadSites();
    } catch (e) {
      console.error("Extension bootstrap auth failed", e);
      setTokenStatus("Token: extension bootstrap failed");
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
      // ✅ auto-refresh if needed (proactive)
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
        // if still 401 after retry, force re-auth
        if (response.status === 401) {
          handleAuthFailure("401 even after refresh. Please authenticate again.");
          alert("Unauthorized even after refresh. Please Authenticate again.");
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

      // if refresh failed due to invalid refresh token, force re-auth
      if (String(err?.message || err).toLowerCase().includes("refresh failed") ||
          String(err?.message || err).toLowerCase().includes("no refresh token")) {
        handleAuthFailure("Refresh token invalid/missing. Please authenticate again.");
      }

      if (!stopRequested && isFetching && loopId === fetchLoopId && activeSiteLoops.get(siteUuid) === loopId) {
        const tid = setTimeout(() => fetchLiveLogsForSite(siteUuid, loopId), 500);
        sitePollTimers.set(siteUuid, tid);
      }
    }
  }

  document.getElementById("fetchDataButton").addEventListener("click", async () => {
    try {
      // ✅ auto-refresh (and only fallback to alert if refresh token missing)
      await ensureValidToken();
    } catch (e) {
      alert("Please Authenticate first (token missing/expired and cannot refresh).");
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

  function formatAdValue(ad, item, channelName) {
    if (item === "ChannelName") return channelName;
    if (item === "Adomain") return ad.Adomain || "N/A";
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
