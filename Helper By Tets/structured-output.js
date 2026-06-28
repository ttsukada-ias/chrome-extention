(function () {
  function clear(container) {
    container.textContent = "";
  }

  function createToggle() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-toggle";
    button.textContent = "-";
    button.setAttribute("aria-label", "Collapse");
    return button;
  }

  function createLeafSpacer() {
    const spacer = document.createElement("span");
    spacer.className = "tree-spacer";
    return spacer;
  }

  function createNode(label, summary, children) {
    const node = document.createElement("div");
    node.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";

    const toggle = createToggle();
    const labelEl = document.createElement("span");
    labelEl.className = "tree-label";
    labelEl.textContent = label;

    const summaryEl = document.createElement("span");
    summaryEl.className = "tree-summary";
    summaryEl.textContent = summary;

    row.append(toggle, labelEl, summaryEl);
    node.append(row, children);

    toggle.addEventListener("click", () => {
      const collapsed = node.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "+" : "-";
      toggle.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
    });

    return node;
  }

  function createJsonLeaf(label, value) {
    const row = document.createElement("div");
    row.className = "tree-row tree-leaf";

    const labelEl = document.createElement("span");
    labelEl.className = "tree-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    valueEl.className = "tree-value";
    valueEl.textContent = JSON.stringify(value);

    row.append(createLeafSpacer(), labelEl, valueEl);
    return row;
  }

  function renderJsonValue(label, value) {
    if (value === null || typeof value !== "object") {
      return createJsonLeaf(label, value);
    }

    const children = document.createElement("div");
    children.className = "tree-children";
    const isArray = Array.isArray(value);
    const entries = isArray
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);

    entries.forEach(([key, child]) => {
      children.appendChild(renderJsonValue(isArray ? `[${key}]` : key, child));
    });

    const summary = isArray
      ? `Array(${value.length})`
      : `Object(${Object.keys(value).length})`;
    return createNode(label, summary, children);
  }

  function renderJsonTree(container, value) {
    clear(container);
    const root = renderJsonValue("root", value);
    container.appendChild(root);
  }

  function textNodes(element) {
    return Array.from(element.childNodes || [])
      .filter(node => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE)
      .map(node => String(node.nodeValue || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function renderXmlElement(element) {
    const children = document.createElement("div");
    children.className = "tree-children";

    Array.from(element.attributes || []).forEach(attribute => {
      const row = document.createElement("div");
      row.className = "tree-row tree-leaf";

      const label = document.createElement("span");
      label.className = "tree-label tree-attribute";
      label.textContent = `@${attribute.name}`;

      const value = document.createElement("span");
      value.className = "tree-value";
      value.textContent = JSON.stringify(attribute.value);

      row.append(createLeafSpacer(), label, value);
      children.appendChild(row);
    });

    textNodes(element).forEach(text => {
      const row = document.createElement("div");
      row.className = "tree-row tree-leaf";

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = "#text";

      const value = document.createElement("span");
      value.className = "tree-value";
      value.textContent = JSON.stringify(text);

      row.append(createLeafSpacer(), label, value);
      children.appendChild(row);
    });

    Array.from(element.children || []).forEach(child => {
      children.appendChild(renderXmlElement(child));
    });

    const childCount = (element.children || []).length;
    const attributeCount = (element.attributes || []).length;
    const parts = [];
    if (attributeCount) parts.push(`${attributeCount} attr${attributeCount === 1 ? "" : "s"}`);
    if (childCount) parts.push(`${childCount} child${childCount === 1 ? "" : "ren"}`);
    const summary = parts.length ? parts.join(", ") : "leaf";

    return createNode(element.nodeName, summary, children);
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
