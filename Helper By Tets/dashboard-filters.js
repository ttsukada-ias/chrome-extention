// Publica live queries use pre-aggregated dimensions, not arbitrary reporting filters.
window.DashboardFilters = (() => {
  const periods = [[15, "15 MIN"], [30, "30 MIN"], [60, "1 HR"], [240, "4 HRS"],
    [4, "4 HRS BY HR"], [12, "12 HRS BY HR"], [24, "24 HRS BY HR"], [168, "WEEK BY HR"]];
  const definitions = [
    ["bidders", "Bidders", "demand"], ["bidderGroups", "Bidder Groups", "demand"],
    ["channels", "Channels", "supply"], ["channelGroups", "Channel Groups", "supply"],
    ["routes", "Routes", "supply"], ["destinations", "Destinations", "supply"],
    ["devices", "Device Types", "device"], ["deals", "Outbound Deals", "deal"]
  ];
  const deviceOptions = [["DEVICETYPE_UNKNOWN", "Unknown Device Type"], ["PERSONAL_COMPUTER", "Desktop"],
    ["CONNECTED_TV", "Connected TV"], ["HIGHEND_PHONE", "Mobile"], ["TABLET", "Tablet"],
    ["CONNECTED_DEVICE", "Connected Device"], ["SET_TOP_BOX", "Set-Top Box"]];
  const state = new Map(definitions.map(([key]) => [key, { selected: new Set(), options: null, error: "", loading: false }]));
  let publisher = "", token = "", period = "60", revision = 0, routesPromise = null;
  let onChange = () => {}, hasDemandSources = () => false;
  const $ = id => document.getElementById(id);
  const ids = value => [...new Set((Array.isArray(value) ? value : String(value || "").split(",")).map(value => String(value).trim()).filter(id => /^[1-9]\d*$/.test(id)))];
  const option = (row, members) => ({ id: String(row.ID ?? row.id), label: String(row.Name ?? row.label ?? row.ID ?? row.id), members });
  const selected = key => state.get(key).selected;
  const anySupply = () => definitions.some(([key, , category]) => category === "supply" && selected(key).size);
  function clear(keys) { keys.forEach(key => selected(key).clear()); }

  function changed(key) {
    const category = definitions.find(([id]) => id === key)?.[2];
    let clearSources = false;
    if (selected(key)?.size) {
      if (category === "demand") { clear([key === "bidders" ? "bidderGroups" : "bidders", "devices", "deals"]); clearSources = true; }
      if (category === "supply") {
        clear(definitions.filter(([id, , group]) => group === "supply" && id !== key).map(([id]) => id));
        clear(["deals"]);
        if (hasDemandSources()) clear(["devices"]);
      }
      if (category === "device") { clear(["bidders", "bidderGroups", "deals"]); clearSources = anySupply(); }
      if (category === "deal") { clear(definitions.filter(([id]) => id !== "deals").map(([id]) => id)); clearSources = true; }
    }
    render(); onChange({ clearSources });
  }

  async function request(path, params = {}) {
    const url = new URL(`https://api.getpublica.com${path}`);
    url.search = new URLSearchParams({ access_token: token, publisher_id: publisher, ...params }).toString();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) throw new Error(`Unable to load options (HTTP ${response.status}).`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  async function getRoutes() {
    if (!routesPromise) {
      routesPromise = request(`/v1/settings/publishers/${encodeURIComponent(publisher)}/routes`).then(json => {
        if (!Array.isArray(json)) throw new Error("Invalid routes response.");
        return json;
      }).catch(error => { routesPromise = null; throw error; });
    }
    return routesPromise;
  }

  async function queryOptions(key) {
    if (key === "devices") return deviceOptions.map(([id, label]) => ({ id, label }));
    if (key === "bidders") return state.get(key).options || [];
    if (key === "bidderGroups") {
      const json = await request("/v1/settings/bidder_groups");
      if (!Array.isArray(json?.BidderGroups)) throw new Error("Invalid bidder groups response.");
      return json.BidderGroups.map(row => option(row, ids(row.BidderIDs)));
    }
    if (key === "channelGroups") {
      const rows = [];
      for (let page = 0; ; page++) {
        const json = await request("/v1/settings/channel_groups", { page: String(page), page_size: "1000", order_by: "name", order_direction: "asc" });
        if (!Array.isArray(json?.ChannelGroups)) throw new Error("Invalid channel groups response.");
        rows.push(...json.ChannelGroups);
        const total = Number(json.TotalCount);
        if (!json.ChannelGroups.length || (total > 0 ? rows.length >= total : json.ChannelGroups.length < 1000)) break;
      }
      return rows.map(row => option(row, ids(row.ChannelIDs || row.SitesInfo?.map(site => site.ID))));
    }
    if (key === "channels" || key === "deals") {
      const json = await request(`/v1/settings/ui_options/${key === "channels" ? "small_sites" : "deals"}`);
      if (!Array.isArray(json)) throw new Error("Invalid filter options response.");
      return json.map(row => option(row));
    }
    const routes = await getRoutes();
    if (key === "routes") return routes.map(row => option(row, ids((row.Destinations || []).map(d => d.SiteID))))
      .filter(row => row.members.length);
    return routes.flatMap(route => (route.Destinations || []).filter(d => ids(d.SiteID).length).map(row => option(row, ids(row.SiteID))));
  }

  async function loadOptions(key) {
    const entry = state.get(key);
    if (entry.options !== null || entry.loading) return;
    const version = revision;
    entry.loading = true; entry.error = ""; renderOptions(key);
    try {
      const options = await queryOptions(key);
      if (version !== revision) return;
      entry.options = [...new Map(options.filter(o => o.id && o.id !== "undefined").map(o => [o.id, o])).values()]
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (error) {
      if (version !== revision) return;
      entry.error = error.name === "AbortError" ? "Loading timed out. Try again." : error.message;
    } finally {
      if (version === revision) { entry.loading = false; renderOptions(key); }
    }
  }

  function renderOptions(key) {
    const entry = state.get(key), list = $(`filter-${key}-options`);
    if (!list) return;
    list.replaceChildren();
    if (entry.loading || entry.error || entry.options === null) {
      const text = document.createElement("p"); text.className = "hint";
      text.textContent = entry.loading ? "Loading options…" : entry.error || "Open this filter to load options.";
      list.appendChild(text);
      if (entry.error) {
        const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry";
        retry.addEventListener("click", () => loadOptions(key)); list.appendChild(retry);
      }
      return;
    }
    const query = $(`filter-${key}-search`).value.trim().toLowerCase();
    const options = entry.options.filter(o => `${o.label} ${o.id}`.toLowerCase().includes(query));
    if (!options.length) { const text = document.createElement("p"); text.className = "hint"; text.textContent = "No matching options."; list.appendChild(text); }
    if (options.length > 200) {
      const hint = document.createElement("p"); hint.className = "hint";
      hint.textContent = `Showing the first 200 of ${options.length} matches. Search by name or ID to find more.`;
      list.appendChild(hint);
    }
    options.slice(0, 200).forEach(o => {
      const label = document.createElement("label"), checkbox = document.createElement("input");
      checkbox.type = "checkbox"; checkbox.value = o.id; checkbox.checked = entry.selected.has(o.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) entry.selected.add(o.id); else entry.selected.delete(o.id);
        changed(key);
        [...list.querySelectorAll("input")].find(input => input.value === o.id)?.focus();
      });
      label.append(checkbox, document.createTextNode(`${o.label} [${o.id}]`)); list.appendChild(label);
    });
  }

  function render() {
    definitions.forEach(([key]) => {
      const summary = $(`filter-${key}-summary`);
      if (summary) summary.textContent = selected(key).size ? `${selected(key).size} selected` : "All";
      renderOptions(key);
    });
    document.querySelectorAll("[data-period]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.period === period)));
  }

  function initialize(config) {
    token = config.accessToken; onChange = config.onChange; hasDemandSources = config.hasDemandSources;
    const timezones = new Set(["UTC", "America/New_York", "Australia/Brisbane", ...Intl.supportedValuesOf("timeZone")]);
    [...timezones].sort().forEach(zone => {
      const option = document.createElement("option"); option.value = zone; $("timezoneOptions").appendChild(option);
    });
    const periodBar = $("periodOptions");
    periods.forEach(([value, label]) => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.period = String(value); button.textContent = label;
      button.addEventListener("click", () => { if (period !== String(value)) { period = String(value); render(); onChange({}); } });
      periodBar.appendChild(button);
    });
    const container = $("extraFilters");
    definitions.forEach(([key, title]) => {
      const details = document.createElement("details"); details.className = "multiselect"; details.id = `filter-${key}`;
      const summary = document.createElement("summary"), count = document.createElement("span"); count.id = `filter-${key}-summary`;
      summary.append(document.createTextNode(`${title} `), count); details.appendChild(summary);
      const panel = document.createElement("div"); panel.className = "dropdown-panel";
      const label = document.createElement("label"); label.htmlFor = `filter-${key}-search`; label.textContent = `Search ${title.toLowerCase()}`;
      const input = document.createElement("input"); input.type = "search"; input.id = label.htmlFor; input.autocomplete = "off";
      input.addEventListener("input", () => renderOptions(key));
      const actions = document.createElement("div"); actions.className = "selection-actions";
      const clearButton = document.createElement("button"); clearButton.type = "button"; clearButton.textContent = "Clear";
      clearButton.addEventListener("click", () => { selected(key).clear(); changed(key); }); actions.appendChild(clearButton);
      const list = document.createElement("div"); list.className = "checkbox-options"; list.id = `filter-${key}-options`;
      panel.append(label, input, actions, list); details.appendChild(panel); container.appendChild(details);
      details.addEventListener("toggle", () => {
        if (details.open) {
          panel.style.right = details.getBoundingClientRect().left + 340 > window.innerWidth ? "0" : "auto";
          loadOptions(key);
        }
      });
    });
    $("clearDashboardFilters").addEventListener("click", () => { clear(definitions.map(([key]) => key)); render(); onChange({ clearSources: true }); });
    render();
  }

  function setAccount(value) {
    if (publisher === value) return;
    publisher = value; revision++; routesPromise = null;
    state.forEach((entry, key) => { entry.selected.clear(); entry.options = key === "devices" ? deviceOptions.map(([id, label]) => ({ id, label })) : null; entry.loading = false; entry.error = ""; });
    render();
  }

  function setBidders(rows, account) {
    if (account !== publisher) return;
    state.get("bidders").options = rows.filter(row => Number.isFinite(Number(row.ID))).map(row => option(row)).sort((a, b) => a.label.localeCompare(b.label));
    renderOptions("bidders");
  }

  function demandSourcesSelected() {
    clear(["bidders", "bidderGroups", "deals"]);
    if (anySupply()) clear(["devices"]);
    render();
  }

  function memberIDs(key, chosen = [...selected(key)]) {
    const entry = state.get(key);
    return [...new Set(chosen.flatMap(id => entry.options?.find(o => o.id === id)?.members || []))];
  }

  function payload(source, chosen = {}) {
    const pick = key => chosen[key] ?? [...selected(key)];
    const bidderIDs = pick("bidders").length ? pick("bidders") : memberIDs("bidderGroups", pick("bidderGroups"));
    const siteIDs = pick("channels").length ? pick("channels") : ["channelGroups", "routes", "destinations"].flatMap(key => memberIDs(key, pick(key)));
    const devices = pick("devices"), deals = pick("deals");
    if (pick("bidderGroups").length && !bidderIDs.length) throw new Error("Selected bidder groups have no bidders. Clear the filter or choose another group.");
    if (["channelGroups", "routes", "destinations"].some(key => pick(key).length) && !siteIDs.length) throw new Error("Selected supply filters have no channels. Clear the filter or choose another option.");
    if (siteIDs.length * Math.max(1, bidderIDs.length) > 5000) throw new Error("Select fewer channels or bidders: live queries support at most 5,000 combinations.");
    const body = { live_density_range: period };
    if (source) body.biddercodes = `'${source.replace(/'/g, "''")}'`;
    if (bidderIDs.length) body.bidder_ids = bidderIDs.join(",");
    if (siteIDs.length) body.site_ids = [...new Set(siteIDs)].join(",");
    if (devices.length) body.devicetypes = devices.map(device => `'${device}'`).join(",");
    if (deals.length) body.deal_ids = deals.join(",");
    body.live_items_key = deals.length ? "publica_deal_id" : siteIDs.length ?
      bidderIDs.length ? "site_bidder" : source ? "site_biddername" : devices.length ? "site_device_type" : "site" :
      bidderIDs.length ? "bidder" : source ? devices.length ? "biddername_device_type" : "biddername" : devices.length ? "device_type" : "publisher_id";
    return body;
  }

  function series(demandSources) {
    const axes = [];
    if (demandSources.length) axes.push(demandSources.map(id => ({ key: "demandSource", id, label: id })));
    definitions.forEach(([key, title]) => {
      const entry = state.get(key);
      if (!entry.selected.size) return;
      axes.push([...entry.selected].sort().map(id => {
        const label = entry.options?.find(option => option.id === id)?.label || title;
        return { key, id, label: `${label} [${id}]` };
      }));
    });
    if (!axes.length) return [{ id: "", label: "All demand sources", demandSource: "", chosen: {} }];
    const combinations = axes.reduce((rows, axis) => rows.flatMap(row => axis.map(item => [...row, item])), [[]]);
    return combinations.map(items => ({
      id: items.length === 1 && items[0].key === "demandSource" ? items[0].id : JSON.stringify(items.map(item => [item.key, item.id])),
      label: items.map(item => item.label).join(" · "),
      demandSource: items.find(item => item.key === "demandSource")?.id || "",
      chosen: Object.fromEntries(items.filter(item => item.key !== "demandSource").map(item => [item.key, [item.id]]))
    }));
  }

  return { initialize, setAccount, setBidders, demandSourcesSelected, payload, series,
    snapshot: () => [period, ...definitions.map(([key]) => [key, [...selected(key)].sort()])],
    hasFilters: () => definitions.some(([key]) => selected(key).size) };
})();
