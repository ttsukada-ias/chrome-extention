let currentCsv = "";
let currentRowCount = 0;

const input = document.getElementById("jsonInput");
const convertButton = document.getElementById("convertButton");
const exportButton = document.getElementById("exportButton");
const preview = document.getElementById("preview");
const status = document.getElementById("status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function tryFixJson(text) {
  let value = String(text || "");
  value = value.replace(/^\uFEFF/, "");
  value = value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  value = value.replace(/,\s*([}\]])/g, "$1");
  return value;
}

function extractFirstJsonBlock(text) {
  const source = String(text || "");
  const start = source.search(/[\{\[]/);
  if (start < 0) return source;

  const openChar = source[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) depth++;
    if (char === closeChar) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return source;
}

function parseJsonInput(text) {
  const jsonText = String(text || "").trim();
  if (!jsonText) {
    throw new Error("Paste JSON before converting.");
  }

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const fixed = extractFirstJsonBlock(tryFixJson(jsonText));
    return JSON.parse(fixed);
  }
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function flattenToRows(root) {
  return expandNode(root, "", [{}]);
}

function expandNode(node, prefix, rowsIn) {
  if (node === null || typeof node !== "object") {
    const key = prefix || "value";
    return rowsIn.map(row => Object.assign({}, row, { [key]: formatValue(node) }));
  }

  if (Array.isArray(node)) {
    if (node.length === 0) {
      const key = prefix || "value";
      return rowsIn.map(row => Object.assign({}, row, { [key]: "" }));
    }

    const allPrimitive = node.every(value => value === null || typeof value !== "object");
    if (allPrimitive) {
      const key = prefix || "value";
      const joined = node.map(formatValue).join(", ");
      return rowsIn.map(row => Object.assign({}, row, { [key]: joined }));
    }

    return node.flatMap(item => expandNode(item, prefix, rowsIn));
  }

  return Object.keys(node).reduce((rows, key) => {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    return expandNode(node[key], childPrefix, rows);
  }, rowsIn);
}

function getTableData(data) {
  const rows = flattenToRows(data);
  if (!rows.length) rows.push({ value: formatValue(data) });

  const headerSet = new Set();
  rows.forEach(row => Object.keys(row).forEach(key => headerSet.add(key)));
  const headers = Array.from(headerSet).sort();
  const values = rows.map(row => headers.map(header => (header in row ? row[header] : "")));

  return { headers, values };
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers, values) {
  return [headers, ...values]
    .map(row => row.map(escapeCsvValue).join(","))
    .join("\r\n");
}

function renderPreview(headers, values) {
  preview.textContent = "";

  if (!headers.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No columns were found.";
    preview.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headers.forEach(header => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  values.slice(0, 100).forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  preview.appendChild(table);
}

function convertJsonToCsv() {
  try {
    const data = parseJsonInput(input.value);
    const { headers, values } = getTableData(data);

    currentCsv = toCsv(headers, values);
    currentRowCount = values.length;
    exportButton.disabled = !currentCsv;
    renderPreview(headers, values);

    const previewNote = values.length > 100 ? " Preview shows the first 100 rows." : "";
    setStatus(`Converted ${values.length} row${values.length === 1 ? "" : "s"} with ${headers.length} column${headers.length === 1 ? "" : "s"}.${previewNote}`);
  } catch (error) {
    currentCsv = "";
    currentRowCount = 0;
    exportButton.disabled = true;
    preview.innerHTML = '<div class="empty">Converted rows will appear here.</div>';
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function exportCsv() {
  if (!currentCsv) return;

  const blob = new Blob([currentCsv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  link.href = url;
  link.download = `json-to-csv-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setStatus(`Exported ${currentRowCount} row${currentRowCount === 1 ? "" : "s"} as CSV.`);
}

convertButton.addEventListener("click", convertJsonToCsv);
exportButton.addEventListener("click", exportCsv);
