function buildToolUrl(page) {
  return chrome.runtime.getURL(page);
}

async function openTool(page) {
  await chrome.tabs.create({ url: buildToolUrl(page), active: true });
  window.close();
}

function init() {
  document.getElementById("openJsonToCsv").addEventListener("click", () => openTool("json-to-csv.html"));
  document.getElementById("openJsonBeautilier").addEventListener("click", () => openTool("json-beautilier.html"));
  document.getElementById("openXmlBeautifier").addEventListener("click", () => openTool("xml-beautifier.html"));
  document.getElementById("openXmlToJson").addEventListener("click", () => openTool("xml-to-json.html"));
  document.getElementById("openUrlEncodeDecode").addEventListener("click", () => openTool("url-encode-decode.html"));
}

init();
