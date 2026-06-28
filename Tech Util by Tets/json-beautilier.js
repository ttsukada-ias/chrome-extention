const input = document.getElementById("jsonInput");
const output = document.getElementById("jsonOutput");
const beautifyButton = document.getElementById("beautifyButton");
const unbeautifyButton = document.getElementById("unbeautifyButton");
const structuredViewButton = document.getElementById("structuredViewButton");
const plainViewButton = document.getElementById("plainViewButton");
const copyButton = document.getElementById("copyButton");
const status = document.getElementById("status");
let currentOutput = "";
let currentData = null;
let currentView = "plain";

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
    throw new Error("Paste JSON before beautifying.");
  }

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const fixed = extractFirstJsonBlock(tryFixJson(jsonText));
    return JSON.parse(fixed);
  }
}

function setView(view) {
  currentView = view;
  structuredViewButton.classList.toggle("active", view === "structured");
  plainViewButton.classList.toggle("active", view === "plain");
  renderCurrentOutput();
}

function renderCurrentOutput() {
  if (!currentOutput) {
    output.textContent = "";
    return;
  }

  if (currentView === "plain") {
    StructuredOutput.renderPlainText(output, currentOutput);
  } else {
    StructuredOutput.renderJsonTree(output, currentData);
  }
}

function beautifyJson() {
  try {
    const data = parseJsonInput(input.value);
    const beautified = JSON.stringify(data, null, 2);

    currentOutput = beautified;
    currentData = data;
    renderCurrentOutput();
    copyButton.disabled = !beautified;
    setStatus("JSON beautified.");
  } catch (error) {
    currentOutput = "";
    currentData = null;
    output.textContent = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function unbeautifyJson() {
  try {
    const data = parseJsonInput(input.value);
    const compact = JSON.stringify(data);

    currentOutput = compact;
    currentData = data;
    renderCurrentOutput();
    copyButton.disabled = !compact;
    setStatus("JSON unbeautified.");
  } catch (error) {
    currentOutput = "";
    currentData = null;
    output.textContent = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

async function copyBeautifiedJson() {
  if (!currentOutput) return;

  try {
    await navigator.clipboard.writeText(currentOutput);
    setStatus("JSON copied to clipboard.");
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
    setStatus("JSON copied to clipboard.");
  }
}

beautifyButton.addEventListener("click", beautifyJson);
unbeautifyButton.addEventListener("click", unbeautifyJson);
structuredViewButton.addEventListener("click", () => setView("structured"));
plainViewButton.addEventListener("click", () => setView("plain"));
copyButton.addEventListener("click", copyBeautifiedJson);
