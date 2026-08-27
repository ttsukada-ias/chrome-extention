(function () {
  function clear(container) {
    container.textContent = "";
  }

  // --- JSON tree ---

  function valueType(value) {
    if (value === null)             return "null";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number")  return "number";
    if (typeof value === "string")  return "string";
    if (Array.isArray(value))       return "array";
    return "object";
  }

  function renderJsonValue(key, value, isRoot) {
    const type = valueType(value);
    const isComplex = type === "object" || type === "array";

    if (!isComplex) {
      const row = document.createElement("div");
      row.className = "tree-row tree-leaf";

      const keyEl = document.createElement("span");
      keyEl.className = "tree-key";
      keyEl.textContent = key;

      const colon = document.createElement("span");
      colon.className = "tree-colon";
      colon.textContent = " : ";

      const valEl = document.createElement("span");
      valEl.className = `tree-value tree-val-${type}`;
      valEl.textContent = JSON.stringify(value);

      row.append(keyEl, colon, valEl);
      return row;
    }

    const node = document.createElement("div");
    node.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row tree-parent-row";
    row.style.cursor = "pointer";

    const toggleEl = document.createElement("span");
    toggleEl.className = "tree-toggle-icon";
    toggleEl.textContent = "-";

    const keyEl = document.createElement("span");
    keyEl.className = "tree-key";
    keyEl.textContent = isRoot ? "JSON" : key;

    const children = document.createElement("div");
    children.className = "tree-children";

    const entries = type === "array"
      ? value.map((item, i) => [String(i), item])
      : Object.entries(value);

    entries.forEach(([k, v]) => children.appendChild(renderJsonValue(k, v, false)));

    row.append(toggleEl, keyEl);
    node.append(row, children);

    row.addEventListener("click", () => {
      const collapsed = node.classList.toggle("collapsed");
      toggleEl.textContent = collapsed ? "+" : "-";
    });

    return node;
  }

  function renderJsonTree(container, value) {
    clear(container);
    container.appendChild(renderJsonValue("JSON", value, true));
  }

  // --- XML tree ---

  function textNodes(element) {
    return Array.from(element.childNodes || [])
      .filter(n => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE)
      .map(n => String(n.nodeValue || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function renderXmlElement(element) {
    const children = document.createElement("div");
    children.className = "tree-children";

    Array.from(element.attributes || []).forEach(attr => {
      const row = document.createElement("div");
      row.className = "tree-row tree-leaf";

      const keyEl = document.createElement("span");
      keyEl.className = "tree-key tree-attribute";
      keyEl.textContent = `@${attr.name}`;

      const colon = document.createElement("span");
      colon.className = "tree-colon";
      colon.textContent = " : ";

      const valEl = document.createElement("span");
      valEl.className = "tree-value tree-val-string";
      valEl.textContent = JSON.stringify(attr.value);

      row.append(keyEl, colon, valEl);
      children.appendChild(row);
    });

    textNodes(element).forEach(text => {
      const row = document.createElement("div");
      row.className = "tree-row tree-leaf";

      const keyEl = document.createElement("span");
      keyEl.className = "tree-key";
      keyEl.textContent = "#text";

      const colon = document.createElement("span");
      colon.className = "tree-colon";
      colon.textContent = " : ";

      const valEl = document.createElement("span");
      valEl.className = "tree-value tree-val-string";
      valEl.textContent = JSON.stringify(text);

      row.append(keyEl, colon, valEl);
      children.appendChild(row);
    });

    Array.from(element.children || []).forEach(child => {
      children.appendChild(renderXmlElement(child));
    });

    const node = document.createElement("div");
    node.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row tree-parent-row";
    row.style.cursor = "pointer";

    const toggleEl = document.createElement("span");
    toggleEl.className = "tree-toggle-icon";
    toggleEl.textContent = "-";

    const keyEl = document.createElement("span");
    keyEl.className = "tree-key";
    keyEl.textContent = element.nodeName;

    row.append(toggleEl, keyEl);
    node.append(row, children);

    row.addEventListener("click", () => {
      const collapsed = node.classList.toggle("collapsed");
      toggleEl.textContent = collapsed ? "+" : "-";
    });

    return node;
  }

  function renderXmlTree(container, element) {
    clear(container);
    container.appendChild(renderXmlElement(element));
  }

  function renderPlainText(container, text) {
    clear(container);
    const pre = document.createElement("pre");
    pre.className = "plain-output";
    pre.textContent = text;
    container.appendChild(pre);
  }

  window.StructuredOutput = {
    renderJsonTree,
    renderXmlTree,
    renderPlainText
  };
})();
