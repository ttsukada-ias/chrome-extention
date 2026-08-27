const inputA = document.getElementById("jsonInputA");
const inputB = document.getElementById("jsonInputB");
const compareButton = document.getElementById("compareButton");
const clearButton = document.getElementById("clearButton");
const copyAButton = document.getElementById("copyAButton");
const copyBButton = document.getElementById("copyBButton");
const diffTable = document.getElementById("diffTable");
const status = document.getElementById("status");

let currentTextA = "";
let currentTextB = "";

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function tryFixJson(text) {
  let value = String(text || "");
  value = value.replace(/^﻿/, "");
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

function parseJsonInput(text, label) {
  const jsonText = String(text || "").trim();
  if (!jsonText) {
    throw new Error(`Paste JSON ${label} before comparing.`);
  }

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const fixed = extractFirstJsonBlock(tryFixJson(jsonText));
    return JSON.parse(fixed);
  }
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    Object.keys(value).sort().forEach(key => {
      sorted[key] = sortKeysDeep(value[key]);
    });
    return sorted;
  }
  return value;
}

// Line-level LCS diff. Returns an ordered list of {type: "equal"|"remove"|"add", a, b}.
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", a: a[i] });
      i++;
    } else {
      ops.push({ type: "add", b: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "remove", a: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", b: b[j] });
    j++;
  }

  return ops;
}

function renderDiff(linesA, linesB) {
  diffTable.innerHTML = "";
  const ops = diffLines(linesA, linesB);
  const fragment = document.createDocumentFragment();

  ops.forEach(op => {
    const row = document.createElement("div");
    row.className = "diff-row";

    const left = document.createElement("div");
    left.className = "diff-cell diff-cell-left";

    const right = document.createElement("div");
    right.className = "diff-cell diff-cell-right";

    if (op.type === "equal") {
      left.textContent = op.a;
      right.textContent = op.b;
    } else if (op.type === "remove") {
      left.textContent = op.a;
      left.classList.add("removed");
      right.classList.add("empty");
    } else {
      right.textContent = op.b;
      right.classList.add("added");
      left.classList.add("empty");
    }

    row.append(left, right);
    fragment.appendChild(row);
  });

  diffTable.appendChild(fragment);
}

function compareJson() {
  try {
    const dataA = parseJsonInput(inputA.value, "A");
    const dataB = parseJsonInput(inputB.value, "B");

    const textA = JSON.stringify(sortKeysDeep(dataA), null, 2);
    const textB = JSON.stringify(sortKeysDeep(dataB), null, 2);

    currentTextA = textA;
    currentTextB = textB;

    renderDiff(textA.split("\n"), textB.split("\n"));
    copyAButton.disabled = false;
    copyBButton.disabled = false;

    setStatus(textA === textB
      ? "No differences. Both JSON payloads match once keys are sorted alphabetically."
      : "Differences highlighted below.");
  } catch (error) {
    diffTable.innerHTML = "";
    currentTextA = "";
    currentTextB = "";
    copyAButton.disabled = true;
    copyBButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error), true);
  }
}

function clearAll() {
  inputA.value = "";
  inputB.value = "";
  diffTable.innerHTML = "";
  currentTextA = "";
  currentTextB = "";
  copyAButton.disabled = true;
  copyBButton.disabled = true;
  setStatus("");
}

async function copyText(text) {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied to clipboard.");
  } catch (error) {
    const copyTarget = document.createElement("textarea");
    copyTarget.value = text;
    copyTarget.style.position = "fixed";
    copyTarget.style.left = "-9999px";
    document.body.appendChild(copyTarget);
    copyTarget.focus();
    copyTarget.select();
    document.execCommand("copy");
    copyTarget.remove();
    setStatus("Copied to clipboard.");
  }
}

compareButton.addEventListener("click", compareJson);
clearButton.addEventListener("click", clearAll);
copyAButton.addEventListener("click", () => copyText(currentTextA));
copyBButton.addEventListener("click", () => copyText(currentTextB));
