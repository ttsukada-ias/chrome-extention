function getQueryValue(key) {
  try {
    return new URLSearchParams(window.location.search).get(key)?.trim() || "";
  } catch {
    return "";
  }
}

function formatXml(xml) {
  const normalized = String(xml || "").replace(/>\s+</g, "><").trim();
  if (!normalized) return "";

  const tokens = normalized.replace(/(>)(<)(\/*)/g, "$1\n$2$3").split("\n");
  let indent = 0;
  const lines = [];

  tokens.forEach(token => {
    const trimmed = token.trim();
    if (!trimmed) return;

    if (/^<\//.test(trimmed)) {
      indent = Math.max(indent - 1, 0);
    }

    lines.push(`${"  ".repeat(indent)}${trimmed}`);

    if (
      /^<[^!?/][^>]*[^/]?>$/.test(trimmed) &&
      !/\/>$/.test(trimmed) &&
      !/<\/[^>]+>$/.test(trimmed) &&
      !/<!\[CDATA\[.*\]\]>$/.test(trimmed)
    ) {
      indent += 1;
    }
  });

  return lines.join("\n");
}

function formatJson(jsonText) {
  try {
    return JSON.stringify(JSON.parse(jsonText), null, 2);
  } catch {
    return `${jsonText || ""}`;
  }
}

let currentOutput = "";
let currentStructuredKind = "";
let currentStructuredData = null;
let currentView = "plain";

function parseJsonValue(jsonText) {
  return JSON.parse(jsonText);
}

function parseXmlRoot(xmlText) {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(xmlText, "application/xml");
  const parserError = documentNode.querySelector("parsererror");

  if (parserError) {
    return null;
  }

  return documentNode.documentElement;
}

function renderCurrentOutput() {
  const content = document.getElementById("content");
  if (!currentOutput) {
    content.textContent = "";
    return;
  }

  if (currentView === "structured" && currentStructuredData) {
    if (currentStructuredKind === "json") {
      StructuredOutput.renderJsonTree(content, currentStructuredData);
      return;
    }

    if (currentStructuredKind === "xml") {
      StructuredOutput.renderXmlTree(content, currentStructuredData);
      return;
    }
  }

  StructuredOutput.renderPlainText(content, currentOutput);
}

function setView(view) {
  currentView = view;
  document.getElementById("structuredViewButton").classList.toggle("active", view === "structured");
  document.getElementById("plainViewButton").classList.toggle("active", view === "plain");
  renderCurrentOutput();
}

async function copyCurrentOutput() {
  if (!currentOutput) return;

  try {
    await navigator.clipboard.writeText(currentOutput);
  } catch (error) {
    const copyTarget = document.createElement("textarea");
    copyTarget.value = currentOutput;
    copyTarget.style.position = "fixed";
    copyTarget.style.left = "-9999px";
    document.body.appendChild(copyTarget);
    copyTarget.focus();
    copyTarget.select();
    document.execCommand("copy");
    copyTarget.remove();
  }
}

function normalizeRequestUrlText(value) {
  return `${value || ""}`
    .trim()
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/gi, "&");
}

function canBeautifyUrl(value) {
  const text = normalizeRequestUrlText(value);
  return text.includes("?") && text.slice(text.indexOf("?") + 1).includes("&");
}

function beautifyUrl(value) {
  const text = normalizeRequestUrlText(value);
  const queryIndex = text.indexOf("?");

  if (queryIndex < 0) {
    return text;
  }

  const prefix = text.slice(0, queryIndex + 1);
  const query = text.slice(queryIndex + 1);

  if (!query) {
    return prefix;
  }

  const params = query.split("&");
  return [
    prefix,
    ...params.map((param, index) => index < params.length - 1 ? `${param}&` : param)
  ].join("\n");
}

function render() {
  const key = getQueryValue("key");
  const fallbackTitle = getQueryValue("title") || "Log Viewer";
  const storageKey = key ? `log-viewer:${key}` : "";
  const raw = storageKey ? localStorage.getItem(storageKey) : "";
  const beautifyButton = document.getElementById("beautifyButton");
  const copyButton = document.getElementById("copyButton");
  const viewToggle = document.getElementById("viewToggle");
  const content = document.getElementById("content");

  if (!raw) {
    document.getElementById("title").textContent = fallbackTitle;
    document.getElementById("meta").textContent = "This entry is no longer available. Re-open it from Live Logs.";
    content.textContent = "";
    beautifyButton.hidden = true;
    viewToggle.hidden = true;
    copyButton.disabled = true;
    return;
  }

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    entry = { title: fallbackTitle, kind: "text", value: raw };
  }

  const value = `${entry?.value || ""}`;
  const kind = entry?.kind === "xml"
    ? "XML"
    : entry?.kind === "json"
      ? "JSON"
      : "Text";

  document.title = entry?.title || fallbackTitle;
  document.getElementById("title").textContent = entry?.title || fallbackTitle;
  document.getElementById("meta").textContent = `${kind} entry`;
  let renderedValue = value;
  currentStructuredKind = "";
  currentStructuredData = null;

  if (entry?.kind === "xml") {
    renderedValue = formatXml(value);
    currentStructuredData = parseXmlRoot(value);
    currentStructuredKind = currentStructuredData ? "xml" : "";
  } else if (entry?.kind === "json") {
    try {
      currentStructuredData = parseJsonValue(value);
      currentStructuredKind = "json";
      renderedValue = JSON.stringify(currentStructuredData, null, 2);
    } catch {
      renderedValue = formatJson(value);
    }
  }

  currentOutput = renderedValue;
  currentView = "plain";
  document.getElementById("structuredViewButton").classList.remove("active");
  document.getElementById("plainViewButton").classList.add("active");
  viewToggle.hidden = !currentStructuredData;
  copyButton.disabled = !currentOutput;
  renderCurrentOutput();

  if (entry?.kind === "text" && canBeautifyUrl(value)) {
    let isBeautified = false;
    beautifyButton.hidden = false;
    beautifyButton.textContent = "Beautify";
    beautifyButton.addEventListener("click", () => {
      isBeautified = !isBeautified;
      currentOutput = isBeautified ? beautifyUrl(value) : renderedValue;
      renderCurrentOutput();
      beautifyButton.textContent = isBeautified ? "Original" : "Beautify";
    });
  } else {
    beautifyButton.hidden = true;
  }

  document.getElementById("structuredViewButton").addEventListener("click", () => setView("structured"));
  document.getElementById("plainViewButton").addEventListener("click", () => setView("plain"));
  copyButton.addEventListener("click", () => {
    copyCurrentOutput().catch(error => console.error("Failed to copy log entry", error));
  });

  if (storageKey) {
    localStorage.removeItem(storageKey);
  }
}

render();
