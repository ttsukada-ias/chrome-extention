/**
 * Google Apps Script: parse (any) JSON and expand into tabular columns.
 *
 * What it does:
 * - Reads JSON text from a single cell (default A1) or the active cell.
 * - Flattens nested objects into "path" columns (dot notation).
 * - Expands arrays into multiple rows (so arrays of objects become row sets).
 *   Example: platform[].broadcast[].program[].content[] -> one row per content item,
 *   while keeping the parent fields repeated on each row.
 *
 * How to use:
 * 1) Extensions → Apps Script → paste this code → Save
 * 2) Reload the spreadsheet
 * 3) Menu: JSON Tools → Parse JSON (expand arrays) → choose input cell → output sheet
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('JSON Tools')
    .addItem('Enable Auto Sidebar', 'jsonTools_enableAutoSidebar')
    .addItem('Parse JSON…', 'jsonTools_showInputSidebar')
    .addToUi();
  // Try to open automatically (may require installable trigger authorization)
  try {
    jsonTools_showInputSidebar();
  } catch (e) {
    // Ignore; user can enable auto sidebar via menu to create installable trigger.
  }
}

function jsonTools_enableAutoSidebar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === 'jsonTools_showInputSidebarOnOpen');
  if (!exists) {
    ScriptApp.newTrigger('jsonTools_showInputSidebarOnOpen')
      .forSpreadsheet(ss)
      .onOpen()
      .create();
  }
  SpreadsheetApp.getUi().alert('Auto sidebar enabled. Reload the spreadsheet.');
}

function jsonTools_showInputSidebarOnOpen() {
  jsonTools_showInputSidebar();
}
function jsonTools_showInputSidebar() {
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family: Arial, sans-serif; padding: 12px;">' +
      '<div style="font-weight: 600; margin-bottom: 8px;">Paste JSON</div>' +
      '<textarea id="json" style="width:100%; height:240px; font-family: monospace;"></textarea>' +
      '<div style="margin-top: 10px;">' +
        '<label style="font-size: 12px;">' +
          '<input type="checkbox" id="log" checked /> Enable debug log' +
        '</label>' +
      '</div>' +
      '<div style="margin-top: 10px;">' +
        '<button id="run">Parse to output sheet</button>' +
        '<span id="status" style="margin-left: 10px;"></span>' +
      '</div>' +
      '<script>' +
        'const btn = document.getElementById("run");' +
        'const status = document.getElementById("status");' +
        'btn.onclick = () => {' +
          'const text = document.getElementById("json").value || "";' +
          'const log = document.getElementById("log").checked;' +
          'status.textContent = "Running...";' +
          'google.script.run.withSuccessHandler(() => {' +
            'status.textContent = "Done";' +
          '}).withFailureHandler(err => {' +
            'status.textContent = err && err.message ? err.message : String(err);' +
          '}).jsonTools_parseJsonToSheetFromText(text, log);' +
        '};' +
      '</script>' +
    '</div>'
  ).setTitle('JSON Tools');

  SpreadsheetApp.getUi().showSidebar(html);
}
function pasteJsonViaInputBox() {
  const ui = SpreadsheetApp.getUi();

  const res = ui.prompt(
    'Paste JSON',
    'Paste the raw JSON here (you can paste multiple lines).',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const text = res.getResponseText().trim();
  if (!text) {
    ui.alert('No input provided.');
    return;
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    ui.alert('Invalid JSON:\n' + e.message);
    return;
  }

  // ✅ Do whatever your script previously did with JSON from A1
  // Example: store it in Script Properties (no cell limits)
  PropertiesService.getScriptProperties().setProperty('RAW_JSON', text);

  ui.alert('JSON saved. Now run your processing function.');
}
function jsonTools_parseJsonToSheetFromInput() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    const jsonResp = ui.prompt(
      'Paste JSON',
      'Paste the raw JSON here (you can paste multiple lines).',
      ui.ButtonSet.OK_CANCEL
    );
    if (jsonResp.getSelectedButton() !== ui.Button.OK) return;

    const jsonText = jsonResp.getResponseText().trim();
    if (!jsonText) {
      ui.alert('No input provided.');
      return;
    }

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      // Try a light auto-fix for common copy/paste issues (smart quotes, trailing commas)
      let fixed = jsonTools_tryFixJson(jsonText);
      // If there is extra text before/after JSON, try extracting the first JSON block
      fixed = jsonTools_extractFirstJsonBlock(fixed);
      try {
        data = JSON.parse(fixed);
        ui.alert('Your JSON had minor formatting issues. It was auto-fixed before parsing.');
      } catch (e2) {
        ui.alert('Invalid JSON:\n' + e.message);
        return;
      }
    }

    const rows = jsonTools_flattenToRows(data);

    if (!rows.length) {
      rows.push({ value: jsonTools_formatValue(data) });
    }

    const headerSet = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
    const headers = Array.from(headerSet).sort();

    const values = [
      headers,
      ...rows.map(r => headers.map(h => (h in r ? r[h] : '')))
    ];

    const outName = 'output';
    let outSheet = ss.getSheetByName(outName);
    if (!outSheet) outSheet = ss.insertSheet(outName);
    outSheet.clearContents();

    outSheet.getRange(1, 1, values.length, headers.length).setValues(values);
    outSheet.setFrozenRows(1);
    outSheet.autoResizeColumns(1, headers.length);
  } catch (err) {
    // Show actual error so we can diagnose limits (too many columns, etc.)
    const msg = err && err.message ? err.message : String(err);
    ui.alert('Error:\n' + msg);
    throw err;
  }
}
function jsonTools_parseJsonToSheetFromText(text, logEnabled) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = msg => jsonTools_log(msg, logEnabled !== false);
  log('start');

  const jsonText = String(text || '').trim();
  log('input length: ' + jsonText.length);
  if (!jsonText) throw new Error('No input provided.');

  let data;
  try {
    data = JSON.parse(jsonText);
    log('parsed: direct JSON.parse');
  } catch (e) {
    log('parse failed: ' + e.message);
    let fixed = jsonTools_tryFixJson(jsonText);
    log('after tryFixJson length: ' + fixed.length);
    fixed = jsonTools_extractFirstJsonBlock(fixed);
    log('after extractFirstJsonBlock length: ' + fixed.length);
    data = JSON.parse(fixed);
    log('parsed: after auto-fix');
  }

  const rows = jsonTools_flattenToRows(data);
  log('rows: ' + rows.length);
  if (!rows.length) rows.push({ value: jsonTools_formatValue(data) });

  const headerSet = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
  const headers = Array.from(headerSet).sort();
  log('headers: ' + headers.length);

  const values = [
    headers,
    ...rows.map(r => headers.map(h => (h in r ? r[h] : '')))
  ];
  log('values size: ' + values.length + 'x' + headers.length);

  const outName = 'output';
  let outSheet = ss.getSheetByName(outName);
  if (!outSheet) outSheet = ss.insertSheet(outName);
  outSheet.clearContents();

  outSheet.getRange(1, 1, values.length, headers.length).setValues(values);
  outSheet.setFrozenRows(1);
  outSheet.autoResizeColumns(1, headers.length);
  log('done');
}

function jsonTools_log(message, enabled) {
  if (enabled === false) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('_json_tools_log');
  if (!sheet) {
    sheet = ss.insertSheet('_json_tools_log');
    sheet.getRange(1, 1, 1, 3).setValues([['timestamp', 'message', 'user']]);
  }
  const row = [new Date(), String(message), Session.getActiveUser().getEmail()];
  sheet.appendRow(row);
}

/**
 * Best-effort fixer for common copy/paste JSON issues.
 * NOTE: This is intentionally conservative to avoid breaking valid JSON.
 */
function jsonTools_tryFixJson(text) {
  let t = String(text || '');

  // Remove UTF-8 BOM if present
  t = t.replace(/^\uFEFF/, '');

  // Replace smart quotes with normal quotes
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Remove trailing commas before } or ]
  t = t.replace(/,\s*([}\]])/g, '$1');

  return t;
}

/**
 * Extract the first valid JSON block from a string.
 * This helps when input includes extra text before/after the JSON.
 */
function jsonTools_extractFirstJsonBlock(text) {
  const s = String(text || '');
  const start = s.search(/[\{\[]/);
  if (start < 0) return s;

  const openChar = s[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return s;
}
function jsonTools_parseJsonToSheet() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getActiveSheet();
  const activeCellA1 = activeSheet.getActiveCell().getA1Notation();

  const inputA1 = ui.prompt(
    'JSON input cell',
    `Enter the cell that contains JSON text (e.g. A1).\nCurrent active cell: ${activeCellA1}`,
    ui.ButtonSet.OK_CANCEL
  );
  if (inputA1.getSelectedButton() !== ui.Button.OK) return;

  const outNameResp = ui.prompt(
    'Output sheet name',
    'Enter output sheet name (will be created if missing):',
    ui.ButtonSet.OK_CANCEL
  );
  if (outNameResp.getSelectedButton() !== ui.Button.OK) return;

  const inputRange = activeSheet.getRange(inputA1.getResponseText().trim());
  const jsonText = String(inputRange.getDisplayValue() || '').trim();
  if (!jsonText) throw new Error('Input cell is empty.');

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Invalid JSON. Please check the input cell content.\n' + e.message);
  }

  const rows = jsonTools_flattenToRows(data);

  // If JSON is a primitive, we still output one row
  if (!rows.length) {
    rows.push({ value: jsonTools_formatValue(data) });
  }

  // Build header set (union of keys)
  const headerSet = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
  const headers = Array.from(headerSet).sort();

  const values = [
    headers,
    ...rows.map(r => headers.map(h => (h in r ? r[h] : '')))
  ];

  const outName = outNameResp.getResponseText().trim() || 'JSON Output';
  let outSheet = ss.getSheetByName(outName);
  if (!outSheet) outSheet = ss.insertSheet(outName);
  outSheet.clearContents();

  outSheet.getRange(1, 1, values.length, headers.length).setValues(values);
  outSheet.setFrozenRows(1);
  outSheet.autoResizeColumns(1, headers.length);
}

/**
 * Core: flatten JSON into rows, expanding arrays into multiple rows.
 * Returns: Array<Object> where each object is a row with "path" keys -> values.
 */
function jsonTools_flattenToRows(root) {
  // Start with one empty row and expand
  return jsonTools_expandNode(root, '', [{}]);
}

/**
 * Expand a node into a list of rows.
 * - prefix: current path
 * - rowsIn: array of partial rows
 */
function jsonTools_expandNode(node, prefix, rowsIn) {
  // null / primitive
  if (node === null || typeof node !== 'object') {
    const key = prefix || 'value';
    return rowsIn.map(r => {
      const out = Object.assign({}, r);
      out[key] = jsonTools_formatValue(node);
      return out;
    });
  }

  // Array
  if (Array.isArray(node)) {
    if (node.length === 0) {
      // Keep a column indicating empty array (optional)
      const key = prefix || 'value';
      return rowsIn.map(r => {
        const out = Object.assign({}, r);
        out[key] = ''; // empty
        return out;
      });
    }

    // If array of primitives, keep as a single cell (joined) to avoid exploding rows too much.
    const allPrimitive = node.every(v => v === null || typeof v !== 'object');
    if (allPrimitive) {
      const key = prefix || 'value';
      const joined = node.map(jsonTools_formatValue).join(', ');
      return rowsIn.map(r => {
        const out = Object.assign({}, r);
        out[key] = joined;
        return out;
      });
    }

    // Array of objects (or mixed): expand each element as separate rows
    // Use the same prefix for all items to avoid exploding column count
    let outRows = [];
    node.forEach(item => {
      const expanded = jsonTools_expandNode(item, prefix, rowsIn);
      outRows = outRows.concat(expanded);
    });

    return outRows;
  }

  // Object: expand each key into the same row set
  let rows = rowsIn;
  Object.keys(node).forEach(k => {
    const childPrefix = prefix ? `${prefix}.${k}` : k;
    rows = jsonTools_expandNode(node[k], childPrefix, rows);
  });
  return rows;
}

/**
 * Format values for sheet output
 */
function jsonTools_formatValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  // objects/arrays -> JSON string
  return JSON.stringify(v);
}

/**
 * OPTIONAL (if you want fewer columns):
 * If your JSON has big arrays and you want columns WITHOUT indexes like "platform.id"
 * and you want 1 row per "leaf item" (e.g., per content item), use this version instead:
 *
 * Replace jsonTools_expandNode() array branch with:
 *  - for arrays of objects: expand each item with SAME prefix (no [idx])
 * This will overwrite if multiple items share same prefix at the same row level,
 * but because we are expanding rows, it’s usually what you want.
 */
// function jsonTools_expandNode(node, prefix, rowsIn) {
//   if (node === null || typeof node !== 'object') {
//     const key = prefix || 'value';
//     return rowsIn.map(r => ({ ...r, [key]: jsonTools_formatValue(node) }));
//   }
//   if (Array.isArray(node)) {
//     if (node.length === 0) return rowsIn.map(r => ({ ...r, [prefix || 'value']: '' }));
//     const allPrimitive = node.every(v => v === null || typeof v !== 'object');
//     if (allPrimitive) {
//       const key = prefix || 'value';
//       return rowsIn.map(r => ({ ...r, [key]: node.map(jsonTools_formatValue).join(', ') }));
//     }
//     let outRows = [];
//     node.forEach(item => {
//       outRows = outRows.concat(jsonTools_expandNode(item, prefix, rowsIn)); // no index in prefix
//     });
//     return outRows;
//   }
//   let rows = rowsIn;
//   Object.keys(node).forEach(k => {
//     const childPrefix = prefix ? `${prefix}.${k}` : k;
//     rows = jsonTools_expandNode(node[k], childPrefix, rows);
//   });
//   return rows;
// }
