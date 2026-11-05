(function setupPublicaBridge() {
  const LOCAL_STORAGE_TOKEN_KEY_RE = /^pbapp\..+\.token$/i;
  let lastPayloadKey = "";

  function currentPublisherId() {
    const hashMatch = window.location.hash.match(/\/app\/pub\/([^/]+)/i);
    if (hashMatch && hashMatch[1]) return decodeURIComponent(hashMatch[1]);

    const pathMatch = window.location.pathname.match(/\/app\/pub\/([^/]+)/i);
    if (pathMatch && pathMatch[1]) return decodeURIComponent(pathMatch[1]);

    return "";
  }

  function emitAuthContext(accessToken) {
    const payload = {
      accessToken: String(accessToken || "").trim(),
      publisherId: currentPublisherId()
    };

    if (!payload.accessToken) return;

    const dedupeKey = `${payload.accessToken}::${payload.publisherId}`;
    if (lastPayloadKey === dedupeKey) return;
    lastPayloadKey = dedupeKey;

    window.postMessage(
      {
        source: "rtbstream-page-bridge",
        type: "PUBLICA_AUTH_CONTEXT",
        payload
      },
      window.location.origin
    );
  }

  function readLocalStorageToken() {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key || !LOCAL_STORAGE_TOKEN_KEY_RE.test(key)) continue;

        const raw = window.localStorage.getItem(key);
        if (!raw) continue;

        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.access_token) emitAuthContext(parsed.access_token);
        } catch {
          // A stale or malformed entry must not prevent reading other tokens.
        }
      }
    } catch {}
  }

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    const result = originalSetItem.apply(this, arguments);
    try {
      if (this === window.localStorage && LOCAL_STORAGE_TOKEN_KEY_RE.test(key)) {
        readLocalStorageToken();
      }
    } catch {}
    return result;
  };

  window.addEventListener("storage", event => {
    if (event.storageArea === window.localStorage && LOCAL_STORAGE_TOKEN_KEY_RE.test(event.key || "")) {
      readLocalStorageToken();
    }
  });

  window.addEventListener("hashchange", readLocalStorageToken);
  window.addEventListener("popstate", readLocalStorageToken);
  ["pushState", "replaceState"].forEach(method => {
    const original = window.history[method];
    window.history[method] = function patchedHistory() {
      const result = original.apply(this, arguments);
      readLocalStorageToken();
      return result;
    };
  });

  readLocalStorageToken();
})();
