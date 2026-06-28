const input = document.getElementById("xmlInput");
const output = document.getElementById("jsonOutput");
const convertButton = document.getElementById("convertButton");
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

function parseXmlInput(text) {
  const xml = String(text || "").trim();
  if (!xml) {
    throw new Error("Paste XML before converting.");
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(xml, "application/xml");
  const parserError = documentNode.querySelector("parsererror");

  if (parserError) {
    throw new Error(parserError.textContent.trim() || "Invalid XML.");
  }

  return documentNode.documentElement;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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

function addGroupedValue(target, key, value) {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    if (!Array.isArray(target[key])) {
      target[key] = [target[key]];
    }
    target[key].push(value);
  } else {
    target[key] = value;
  }
}

function xmlElementToJson(element) {
  const result = {};

  if (element.attributes?.length) {
    result["@attributes"] = {};
    Array.from(element.attributes).forEach(attribute => {
      result["@attributes"][attribute.name] = attribute.value;
    });
  }

  const childElements = Array.from(element.children || []);
  const textNodes = Array.from(element.childNodes || [])
    .filter(node => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE)
    .map(node => normalizeText(node.nodeValue))
    .filter(Boolean);

  childElements.forEach(child => {
    addGroupedValue(result, child.nodeName, xmlElementToJson(child));
  });

  const text = textNodes.join(" ");
  if (text) {
    if (Object.keys(result).length) {
      result["#text"] = text;
    } else {
      return text;
    }
  }

  return result;
}

function convertXmlToJson() {
  try {
    const root = parseXmlInput(input.value);
    const json = {
      [root.nodeName]: xmlElementToJson(root)
    };
    const formatted = JSON.stringify(json, null, 2);

    currentOutput = formatted;
    currentData = json;
    renderCurrentOutput();
    copyButton.disabled = !formatted;
    setStatus("XML converted to JSON.");
  } catch (error) {
    currentOutput = "";
    currentData = null;
    output.textContent = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

async function copyJsonOutput() {
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

convertButton.addEventListener("click", convertXmlToJson);
structuredViewButton.addEventListener("click", () => setView("structured"));
plainViewButton.addEventListener("click", () => setView("plain"));
copyButton.addEventListener("click", copyJsonOutput);
