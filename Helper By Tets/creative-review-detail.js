function $(id) {
  return document.getElementById(id);
}

const PREVIEW_SECONDS = 3;
let accessToken = "";
let publisherId = "";
let creativeUrl = "";
let detailRows = [];
let reviewStatusScope = "0";

function getQueryValue(key) {
  try {
    return new URLSearchParams(window.location.search).get(key)?.trim() || "";
  } catch {
    return "";
  }
}

function setStatus(text, isWarn = false) {
  const el = $("detailStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("warn", !!isWarn);
}

function setSummary(text) {
  const el = $("detailSummary");
  if (el) el.textContent = text;
}

function formatReviewStatus(value) {
  const numeric = Number(value);
  if (numeric === 1) return "Reviewed";
  if (numeric === 2) return "Blocked";
  if (numeric === 3) return "Allowed";
  return "Unreviewed";
}

function getReviewStatusScope() {
  return ["0", "1", "2", "3"].includes(reviewStatusScope) ? reviewStatusScope : "0";
}

function getUniformReviewStatus(rows) {
  const unique = [...new Set(rows.map(row => Number(row?.ReviewStatus ?? 0)))];
  if (unique.length === 1) {
    return unique[0];
  }
  return null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${text}`);
  }
  return response.json();
}

function isRetryableCreativeUpdateError(error) {
  const text = `${error?.message || error || ""}`;
  return text.includes("DELTA_CONCURRENT_DELETE_READ")
    || text.includes("ConcurrentDeleteReadException")
    || text.includes("please try the operation again");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postCreativeUpdateWithRetry(url, payload, attempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableCreativeUpdateError(error) || attempt === attempts - 1) {
        throw error;
      }
      await delay(500 * (attempt + 1));
    }
  }

  throw lastError || new Error("Creative update failed.");
}

function stopAndReleaseVideo(video) {
  if (!video) return;
  try { video.pause(); } catch {}
  try {
    video.removeAttribute("src");
    video.load();
  } catch {}
}

function createVideoPreviewElement(url) {
  if (!url) return "";

  return `
    <div class="preview-tile">
      <a class="preview-link" href="${url}" target="_blank" rel="noreferrer">
        <video class="preview-video" preload="metadata" muted playsinline src="${url}"></video>
      </a>
    </div>
  `;
}

function wirePreviewVideos() {
  document.querySelectorAll(".preview-video").forEach(video => {
    let previewComplete = false;
    let hoverResumeActive = false;

    const pauseVideo = () => {
      try { video.pause(); } catch {}
    };

    const onTimeUpdate = () => {
      if (!previewComplete && !hoverResumeActive && video.currentTime >= PREVIEW_SECONDS) {
        previewComplete = true;
        pauseVideo();
      }
    };

    video.autoplay = true;
    video.loop = false;
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", () => {
      previewComplete = true;
    });
    video.addEventListener("mouseenter", () => {
      hoverResumeActive = true;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    });
    video.addEventListener("mouseleave", () => {
      hoverResumeActive = false;
      pauseVideo();
    });
  });
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRows(rows) {
  const body = $("detailBody");
  if (!body) return;

  body.querySelectorAll("video").forEach(video => stopAndReleaseVideo(video));

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No creative detail rows were returned for this creative URL.</td></tr>';
    return;
  }

  body.innerHTML = rows.map(row => {
    const originalUrl = `${row?.OriginalCreativeURL || ""}`.trim();

    return `
      <tr>
        <td class="preview-cell">${createVideoPreviewElement(originalUrl)}</td>
        <td>${escapeHtml(row?.BidderID ?? "")}</td>
        <td>${escapeHtml(row?.BidderName ?? "")}</td>
        <td>${escapeHtml(row?.TotalCount ?? "")}</td>
        <td>${escapeHtml(row?.Impressions ?? "")}</td>
        <td>${escapeHtml(row?.BidErrorBlockedResponses ?? "")}</td>
      </tr>
    `;
  }).join("");

  wirePreviewVideos();
}

function updateBulkPanel(rows) {
  const firstRow = rows[0] || {};
  const uniformStatus = getUniformReviewStatus(rows);

  $("bulkReviewStatus").value = uniformStatus === null ? "Mixed" : formatReviewStatus(uniformStatus);
  $("bulkCreativeUrl").value = `${creativeUrl || firstRow?.CreativeURL || firstRow?.OriginalCreativeURL || ""}`.trim();
  $("bulkAdomain").value = `${firstRow?.AdomainOverride || firstRow?.Adomain || ""}`.trim();
  $("bulkIabCategory").value = `${firstRow?.IABCategoryOverride || firstRow?.IABCategory || ""}`.trim();

  $("bulkUnreviewedButton").disabled = uniformStatus === 0;
  $("bulkReviewedButton").disabled = uniformStatus === 1;
  $("bulkBlockButton").disabled = uniformStatus === 2;
  $("bulkAllowButton").disabled = uniformStatus === 3;
}

function buildDetailFetchPayload() {
  return {
    order_by: "",
    order: "desc",
    page: 0,
    active_column_keys: ["ReviewAd", "Adomain", "IABCategory", "Impressions", "BidErrorsBrandSafety", "BidderID"],
    creative_url_filter: creativeUrl,
    brand_safety_rule_ids: "",
    user_filter: "",
    adomain_filter: "",
    bidder_filter: "",
    site_filter: "",
    demand_source_filter: "",
    bidder_group_filter: "",
    bidder_tier_filter: "",
    category_filter: ""
  };
}

function getUpdatePayload(row, nextStatus = null) {
  const editedAdomain = `${$("bulkAdomain")?.value || ""}`.trim();
  const editedCategory = `${$("bulkIabCategory")?.value || ""}`.trim();

  return {
    OriginalCreativeURL: `${row?.OriginalCreativeURL || ""}`.trim(),
    CreativeURL: `${row?.CreativeURL || row?.OriginalCreativeURL || ""}`.trim(),
    Adomain: editedAdomain || `${row?.Adomain || ""}`.trim(),
    IABCategory: editedCategory || `${row?.IABCategory || ""}`.trim(),
    ReviewStatus: nextStatus === null ? Number(row?.ReviewStatus ?? 0) : nextStatus,
    Notes: `${row?.Notes || ""}`,
    AdomainOverride: editedAdomain || `${row?.AdomainOverride || row?.Adomain || ""}`.trim(),
    AdomainEnrichedBy: `${row?.AdomainEnrichedBy || ""}`,
    IABCategoryOverride: editedCategory || `${row?.IABCategoryOverride || row?.IABCategory || ""}`.trim(),
    IABCategoryEnrichedBy: `${row?.CategoryEnrichedBy || row?.IABCategoryEnrichedBy || ""}`,
    BrandSafetyRuleIDs: Array.isArray(row?.BrandSafetyRuleIDs) ? row.BrandSafetyRuleIDs : []
  };
}

async function refreshDetailRows() {
  const url =
    `https://api.getpublica.com/v1/settings/publishers/${encodeURIComponent(publisherId)}/creative_validation/${encodeURIComponent(getReviewStatusScope())}` +
    `?access_token=${encodeURIComponent(accessToken)}`;

  const payload = buildDetailFetchPayload();

  const json = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  detailRows = Array.isArray(json) ? json : [];
  renderRows(detailRows);
  updateBulkPanel(detailRows);
  setStatus(`Loaded ${detailRows.length} creative detail row${detailRows.length === 1 ? "" : "s"}.`);
}

async function applyBulkUpdate(nextStatus = null) {
  if (!detailRows.length) {
    setStatus("No detail rows available to update.", true);
    return;
  }

  const url =
    `https://api.getpublica.com/v1/settings/publishers/${encodeURIComponent(publisherId)}/update_creative_validation` +
    `?access_token=${encodeURIComponent(accessToken)}`;

  setStatus(nextStatus === null ? "Updating creative fields..." : "Updating creative review status...");

  try {
    await Promise.all(
      detailRows.map(row =>
        postCreativeUpdateWithRetry(url, getUpdatePayload(row, nextStatus))
      )
    );

    if (nextStatus !== null) {
      reviewStatusScope = String(nextStatus);
      setSummary(`Creative URL filter: ${creativeUrl} | Status: ${formatReviewStatus(getReviewStatusScope())}`);
    }

    await refreshDetailRows();
  } catch (error) {
    console.error("Failed to update creative detail", error);
    setStatus(String(error?.message || error), true);
  }
}

function wireBulkActions() {
  $("bulkUnreviewedButton")?.addEventListener("click", () => applyBulkUpdate(0));
  $("bulkReviewedButton")?.addEventListener("click", () => applyBulkUpdate(1));
  $("bulkBlockButton")?.addEventListener("click", () => applyBulkUpdate(2));
  $("bulkAllowButton")?.addEventListener("click", () => applyBulkUpdate(3));
  $("bulkUpdateButton")?.addEventListener("click", () => applyBulkUpdate(null));
}

async function init() {
  accessToken = getQueryValue("access_token");
  publisherId = getQueryValue("publisher_id");
  creativeUrl = getQueryValue("creative_url");
  reviewStatusScope = getQueryValue("status_scope") || "0";

  if (!accessToken || !publisherId || !creativeUrl) {
    setStatus("Missing creative detail parameters.", true);
    setSummary("This detail page needs access token, publisher, and creative URL.");
    return;
  }

  setStatus("Loading creative detail...");
  setSummary(`Creative URL filter: ${creativeUrl} | Status: ${formatReviewStatus(getReviewStatusScope())}`);
  wireBulkActions();

  try {
    await refreshDetailRows();
  } catch (error) {
    console.error("Failed to load creative detail", error);
    setStatus(String(error?.message || error), true);
    renderRows([]);
  }
}

init().catch(error => {
  console.error("Failed to initialize creative detail page", error);
  setStatus(String(error?.message || error), true);
});
