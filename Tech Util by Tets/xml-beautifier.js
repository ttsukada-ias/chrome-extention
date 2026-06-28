const input = document.getElementById("xmlInput");
const output = document.getElementById("xmlOutput");
const beautifyButton = document.getElementById("beautifyButton");
const unbeautifyButton = document.getElementById("unbeautifyButton");
const structuredViewButton = document.getElementById("structuredViewButton");
const plainViewButton = document.getElementById("plainViewButton");
const copyButton = document.getElementById("copyButton");
const status = document.getElementById("status");
let currentOutput = "";
let currentRoot = null;
let currentView = "plain";

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function parseXmlInput() {
  const xml = String(input.value || "").trim();
  if (!xml) {
    throw new Error("Paste XML before formatting.");
  }
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(xml, "application/xml");
  const parserError = documentNode.querySelector("parsererror");

  if (parserError) {
    throw new Error(parserError.textContent.trim() || "Invalid XML.");
  }

  return { xml, root: documentNode.documentElement };
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
    StructuredOutput.renderXmlTree(output, currentRoot);
  }
}

function beautifyXml(xml) {
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

function unbeautifyXml(xml) {
  return String(xml || "").replace(/>\s+</g, "><").trim();
}

function runBeautify() {
  try {
    const { xml, root } = parseXmlInput();
    const beautified = beautifyXml(xml);

    currentOutput = beautified;
    currentRoot = root;
    renderCurrentOutput();
    copyButton.disabled = !beautified;
    setStatus("XML beautified.");
  } catch (error) {
    currentOutput = "";
    currentRoot = null;
    output.textContent = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function runUnbeautify() {
  try {
    const { xml, root } = parseXmlInput();
    const compact = unbeautifyXml(xml);

    currentOutput = compact;
    currentRoot = root;
    renderCurrentOutput();
    copyButton.disabled = !compact;
    setStatus("XML unbeautified.");
  } catch (error) {
    currentOutput = "";
    currentRoot = null;
    output.textContent = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

async function copyXmlOutput() {
  if (!currentOutput) return;

  try {
    await navigator.clipboard.writeText(currentOutput);
    setStatus("XML copied to clipboard.");
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
    setStatus("XML copied to clipboard.");
  }
}

beautifyButton.addEventListener("click", runBeautify);
unbeautifyButton.addEventListener("click", runUnbeautify);
structuredViewButton.addEventListener("click", () => setView("structured"));
plainViewButton.addEventListener("click", () => setView("plain"));
copyButton.addEventListener("click", copyXmlOutput);
