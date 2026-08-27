const urlInput    = document.getElementById("urlInput");
const urlOutput   = document.getElementById("urlOutput");
const parseOutput = document.getElementById("parseOutput");
const urlParts    = document.getElementById("urlParts");
const paramsTable = document.getElementById("paramsTable");
const paramsBody  = document.getElementById("paramsBody");
const outputLabel = document.getElementById("outputLabel");
const parseButton = document.getElementById("parseButton");
const encodeButton = document.getElementById("encodeButton");
const decodeButton = document.getElementById("decodeButton");
const copyButton  = document.getElementById("copyButton");
const clearButton = document.getElementById("clearButton");
const status      = document.getElementById("status");

let lastCopyText = "";

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.classList.toggle("error", isError);
}

function showTextOutput(text, label, statusMsg) {
  parseOutput.classList.remove("visible");
  urlOutput.style.display = "";
  urlOutput.value = text;
  outputLabel.textContent = label;
  lastCopyText = text;
  copyButton.disabled = !text;
  setStatus(statusMsg);
}

function showParseOutput(parsed, paramCount) {
  urlOutput.style.display = "none";
  parseOutput.classList.add("visible");
  outputLabel.textContent = "Parsed URL";

  // URL parts
  const parts = [];
  if (parsed.protocol) parts.push({ label: "Protocol", value: parsed.protocol.replace(":", "") });
  if (parsed.hostname) parts.push({ label: "Host", value: parsed.hostname + (parsed.port ? ":" + parsed.port : "") });
  if (parsed.pathname && parsed.pathname !== "/") parts.push({ label: "Path", value: parsed.pathname });
  if (parsed.hash) parts.push({ label: "Fragment", value: parsed.hash.slice(1) });

  urlParts.innerHTML = parts.map(p =>
    `<div class="url-part-row">
      <span class="url-part-label">${esc(p.label)}</span>
      <span class="url-part-value">${esc(p.value)}</span>
    </div>`
  ).join("");

  // Params table
  const params = [...parsed.searchParams.entries()];
  if (params.length === 0) {
    paramsTable.style.display = "none";
  } else {
    paramsTable.style.display = "";
    paramsBody.innerHTML = params.map(([k, v]) =>
      `<tr>
        <td class="param-key">${esc(k)}</td>
        <td class="param-eq">=</td>
        <td class="param-val">${esc(decodeURIComponent(v.replace(/\+/g, " ")))}</td>
      </tr>`
    ).join("");
  }

  // Build copy text
  const lines = [];
  parts.forEach(p => lines.push(`${p.label}: ${p.value}`));
  if (params.length) {
    lines.push("");
    lines.push("Query Parameters:");
    params.forEach(([k, v]) => lines.push(`  ${k} = ${decodeURIComponent(v.replace(/\+/g, " "))}`));
  }
  lastCopyText = lines.join("\n");
  copyButton.disabled = false;
  setStatus(`Parsed — ${params.length} query parameter${params.length !== 1 ? "s" : ""}.`);
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getInput(action) {
  const v = urlInput.value.trim();
  if (!v) { setStatus(`Enter text to ${action}.`, true); return null; }
  return v;
}

function doParse() {
  const value = getInput("parse");
  if (!value) return;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    try { parsed = new URL("https://" + value); } catch {
      setStatus("Could not parse — enter a valid URL.", true);
      return;
    }
  }
  showParseOutput(parsed);
}

function doEncode() {
  const value = getInput("encode");
  if (!value) return;
  try {
    showTextOutput(encodeURIComponent(value), "Encoded", "Encoded URL-safe string.");
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

function doDecode() {
  const value = getInput("decode");
  if (!value) return;
  try {
    showTextOutput(decodeURIComponent(value.replace(/\+/g, " ")), "Decoded", "Decoded URL-encoded string.");
  } catch {
    setStatus("Unable to decode — check for malformed percent-encoding.", true);
  }
}

async function doCopy() {
  if (!lastCopyText) return;
  try {
    await navigator.clipboard.writeText(lastCopyText);
    setStatus("Copied to clipboard.");
  } catch {
    setStatus("Could not copy to clipboard.", true);
  }
}

function doClear() {
  urlInput.value = "";
  urlOutput.value = "";
  urlOutput.style.display = "none";
  parseOutput.classList.remove("visible");
  outputLabel.textContent = "Output";
  lastCopyText = "";
  copyButton.disabled = true;
  setStatus("");
}

parseButton.addEventListener("click", doParse);
encodeButton.addEventListener("click", doEncode);
decodeButton.addEventListener("click", doDecode);
copyButton.addEventListener("click", doCopy);
clearButton.addEventListener("click", doClear);
