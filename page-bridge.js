(function setupPublicaBridge() {
  const API_ORIGIN = "https://api.getpublica.com";
  const seenPayloads = new Set();

  function currentPublisherId() {
    const hashMatch = window.location.hash.match(/\/app\/pub\/([^/]+)/i);
    if (hashMatch && hashMatch[1]) return decodeURIComponent(hashMatch[1]);

    const pathMatch = window.location.pathname.match(/\/app\/pub\/([^/]+)/i);
    if (pathMatch && pathMatch[1]) return decodeURIComponent(pathMatch[1]);

    return "";
  }

  function normalizeToken(rawValue) {
    return String(rawValue || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
  }

  function emitAuthContext(partialPayload = {}) {
    const payload = {
      accessToken: normalizeToken(partialPayload.accessToken),
      publisherId: String(partialPayload.publisherId || currentPublisherId()).trim()
    };

    if (!payload.accessToken) return;

    const dedupeKey = `${payload.accessToken}::${payload.publisherId}`;
    if (seenPayloads.has(dedupeKey)) return;

    seenPayloads.add(dedupeKey);
    if (seenPayloads.size > 100) {
      seenPayloads.clear();
      seenPayloads.add(dedupeKey);
    }

    window.postMessage(
      {
        source: "rtbstream-page-bridge",
        type: "PUBLICA_AUTH_CONTEXT",
        payload
      },
      window.location.origin
    );
  }

  function inspectUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== API_ORIGIN) return;

      emitAuthContext({
        accessToken: url.searchParams.get("access_token"),
        publisherId: url.searchParams.get("publisher_id") || currentPublisherId()
      });
    } catch {}
  }

  function inspectHeaders(headers) {
    if (!headers) return;

    if (headers instanceof Headers) {
      emitAuthContext({ accessToken: headers.get("authorization") });
      return;
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        if (String(key).toLowerCase() === "authorization") {
          emitAuthContext({ accessToken: value });
        }
      }
      return;
    }

    if (typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() === "authorization") {
          emitAuthContext({ accessToken: value });
        }
      }
    }
  }

  function inspectBody(body) {
    if (!body || typeof body !== "string") return;

    try {
      const params = new URLSearchParams(body);
      emitAuthContext({
        accessToken: params.get("access_token"),
        publisherId: params.get("publisher_id")
      });
    } catch {}
  }

  function inspectJsonResponse(url, json) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      if (parsedUrl.origin !== API_ORIGIN || !json || typeof json !== "object") return;

      emitAuthContext({
        accessToken: json.access_token,
        publisherId: json.publisher_id || currentPublisherId()
      });
    } catch {}
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);

    inspectUrl(url);
    inspectHeaders(init?.headers || request?.headers);

    if (init?.body && typeof init.body === "string") inspectBody(init.body);

    const response = await originalFetch.apply(this, arguments);

    try {
      const parsedUrl = new URL(url, window.location.href);
      if (parsedUrl.origin === API_ORIGIN) {
        const clone = response.clone();
        const contentType = clone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          clone.json().then(json => inspectJsonResponse(url, json)).catch(() => {});
        }
      }
    } catch {}

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__rtbstreamUrl = url;
    this.__rtbstreamHeaders = {};
    inspectUrl(url);
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    this.__rtbstreamHeaders = this.__rtbstreamHeaders || {};
    this.__rtbstreamHeaders[name] = value;
    inspectHeaders([[name, value]]);
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    inspectUrl(this.__rtbstreamUrl);
    inspectHeaders(this.__rtbstreamHeaders);
    if (typeof body === "string") inspectBody(body);

    this.addEventListener("load", function onLoad() {
      const contentType = this.getResponseHeader("content-type") || "";
      if (!contentType.includes("application/json")) return;

      try {
        inspectJsonResponse(this.responseURL || this.__rtbstreamUrl, JSON.parse(this.responseText));
      } catch {}
    });

    return originalSend.apply(this, arguments);
  };

  emitAuthContext({ publisherId: currentPublisherId() });
})();
