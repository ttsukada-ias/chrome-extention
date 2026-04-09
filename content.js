(function injectBridgeScript() {
  if (document.getElementById("rtbstream-page-bridge")) return;

  const script = document.createElement("script");
  script.id = "rtbstream-page-bridge";
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.dataset.extensionId = chrome.runtime.id;
  script.async = false;
  (document.documentElement || document.head || document.body).appendChild(script);
})();

window.addEventListener("message", event => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== "rtbstream-page-bridge" || data.type !== "PUBLICA_AUTH_CONTEXT") {
    return;
  }

  chrome.runtime.sendMessage({
    type: "PUBLICA_AUTH_CONTEXT",
    payload: data.payload
  });
});
