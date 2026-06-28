const input = document.getElementById("urlInput");
const output = document.getElementById("urlOutput");
const encodeButton = document.getElementById("encodeButton");
const decodeButton = document.getElementById("decodeButton");
const parseButton = document.getElementById("parseButton");
const copyButton = document.getElementById("copyButton");
const status = document.getElementById("status");
let isParsedView = false;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function getInputValue(action) {
  const value = String(input.value || "");
  if (!value) {
    throw new Error(`Enter text to ${action}.`);
  }
  return value;
}

function setOutput(value, message) {
  output.value = value;
  copyButton.disabled = !value;
  setStatus(message);
}

function updateParseButtonLabel() {
  parseButton.textContent = isParsedView ? "Unparse" : "URL Parse";
}

function encodeUrlText() {
  try {
    const value = getInputValue("encode");
    setOutput(encodeURIComponent(value), "Encoded URL-safe string.");
  } catch (error) {
    output.value = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function decodeUrlText() {
  try {
    const value = getInputValue("decode");
    setOutput(decodeURIComponent(value.replace(/\+/g, " ")), "Decoded URL-encoded string.");
  } catch (error) {
    output.value = "";
    copyButton.disabled = true;
    setStatus("Unable to decode input. Check for malformed percent-encoding.", true);
  }
}

function parseUrlText() {
  try {
    const value = getInputValue("parse").trim();
    const queryStart = value.indexOf("?");

    if (queryStart === -1) {
      setOutput(value, "No query string found. Returned the original URL.");
      return;
    }

    const base = value.slice(0, queryStart);
    const query = value.slice(queryStart + 1);
    const parts = query.split("&");
    const lines = [`${base}?`];

    parts.forEach((part, index) => {
      if (index < parts.length - 1) {
        lines.push(`${part}&`);
      } else {
        lines.push(part);
      }
    });

    isParsedView = true;
    updateParseButtonLabel();
    setOutput(lines.join("\n"), "Parsed URL into query lines.");
  } catch (error) {
    output.value = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function unparseUrlText() {
  try {
    const value = getInputValue("unparse");
    const lines = value
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error("Enter parsed URL lines to unparse.");
    }

    const rebuilt = lines.join("");
    isParsedView = false;
    updateParseButtonLabel();
    setOutput(rebuilt, "Unparsed URL back into a single line.");
  } catch (error) {
    output.value = "";
    copyButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function handleParseToggle() {
  if (isParsedView) {
    unparseUrlText();
    return;
  }
  parseUrlText();
}

async function copyOutput() {
  if (!output.value) return;

  try {
    await navigator.clipboard.writeText(output.value);
    setStatus("Output copied to clipboard.");
  } catch (error) {
    output.focus();
    output.select();
    document.execCommand("copy");
    setStatus("Output copied to clipboard.");
  }
}

encodeButton.addEventListener("click", encodeUrlText);
decodeButton.addEventListener("click", decodeUrlText);
parseButton.addEventListener("click", handleParseToggle);
copyButton.addEventListener("click", copyOutput);
updateParseButtonLabel();
