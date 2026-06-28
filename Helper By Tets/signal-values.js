function getQueryValue(key) {
  try {
    return new URLSearchParams(window.location.search).get(key)?.trim() || "";
  } catch {
    return "";
  }
}

function renderEmpty(message) {
  const content = document.getElementById("content");
  content.innerHTML = "";

  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = message;
  content.appendChild(empty);
}

function render() {
  const key = getQueryValue("key");
  const fallbackTitle = getQueryValue("title") || "Signal Values";
  const storageKey = key ? `signal-values:${key}` : "";
  const raw = storageKey ? localStorage.getItem(storageKey) : "";

  if (!raw) {
    document.title = fallbackTitle;
    document.getElementById("title").textContent = fallbackTitle;
    document.getElementById("meta").textContent = "This signal detail is no longer available. Re-open it from Live Logs.";
    renderEmpty("No signal value data is available.");
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  const title = payload?.title || fallbackTitle;
  const values = Array.isArray(payload?.values) ? payload.values : [];
  const recordsWithValue = payload?.recordsWithValue || 0;
  const populationPct = payload?.populationPct || "0.00%";

  document.title = title;
  document.getElementById("title").textContent = title;
  document.getElementById("meta").textContent =
    `${recordsWithValue} records with value · ${populationPct} of loaded population`;

  const content = document.getElementById("content");
  content.innerHTML = "";

  if (values.length === 0) {
    renderEmpty("No concrete values were found for this signal path.");
    localStorage.removeItem(storageKey);
    return;
  }

  const table = document.createElement("div");
  table.className = "table";

  const header = document.createElement("div");
  header.className = "table-header";

  const valueHead = document.createElement("div");
  valueHead.className = "table-head";
  valueHead.textContent = "Value";
  header.appendChild(valueHead);

  const countHead = document.createElement("div");
  countHead.className = "table-head";
  countHead.textContent = "Count";
  header.appendChild(countHead);

  table.appendChild(header);

  values.forEach(item => {
    const row = document.createElement("div");
    row.className = "table-row";

    const valueCell = document.createElement("div");
    valueCell.className = "table-cell";
    valueCell.textContent = `${item?.value || ""}`;
    row.appendChild(valueCell);

    const countCell = document.createElement("div");
    countCell.className = "table-cell";
    countCell.textContent = `${item?.count || 0}`;
    row.appendChild(countCell);

    table.appendChild(row);
  });

  content.appendChild(table);
  localStorage.removeItem(storageKey);
}

render();
