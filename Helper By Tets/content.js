(function injectBridgeScript() {
  if (document.getElementById("rtbstream-page-bridge")) return;

  let bridgeUrl = "";
  let extensionId = "";
  try {
    bridgeUrl = chrome.runtime.getURL("page-bridge.js");
    extensionId = chrome.runtime.id;
  } catch (error) {
    return;
  }

  const script = document.createElement("script");
  script.id = "rtbstream-page-bridge";
  script.src = bridgeUrl;
  script.dataset.extensionId = extensionId;
  script.async = false;
  (document.documentElement || document.head || document.body).appendChild(script);
})();

window.addEventListener("message", event => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== "rtbstream-page-bridge" || data.type !== "PUBLICA_AUTH_CONTEXT") {
    return;
  }

  try {
    chrome.runtime.sendMessage({
      type: "PUBLICA_AUTH_CONTEXT",
      payload: data.payload
    }, () => {
      // Reading lastError prevents Chrome from logging callback errors when
      // a tab still has a stale content script from a previous extension load.
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Extension reloads invalidate old content-script contexts in open tabs.
  }
});
