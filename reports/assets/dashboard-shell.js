
document.addEventListener("DOMContentLoaded", () => {
  const countRows = (table) => Math.max(0, table.querySelectorAll("tr").length - 1);
  document.body.classList.add("wf-enhanced-shell");

  document.querySelectorAll(".wf-content").forEach((content) => {
    content.querySelectorAll(":scope > header").forEach((node) => node.remove());
    const wrap = content.querySelector(":scope > .wrap");
    if (wrap) {
      while (wrap.firstChild) content.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    }
  });

  document.querySelectorAll(".wf-content table").forEach((table) => {
    if (table.closest(".wf-table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "wf-table-wrap";
    const rows = countRows(table);
    if (rows > 25) wrap.classList.add("wf-long-table");
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    if (rows > 0) {
      const meta = document.createElement("div");
      meta.className = "wf-table-meta";
      meta.textContent = `${rows} 行数据，横向滚动查看更多字段`;
      wrap.parentNode.insertBefore(meta, wrap);
    }
    if (!table.classList.contains("pricing-table") && !table.classList.contains("task-tbl") && !table.classList.contains("exec-tbl")) {
      const columns = table.querySelector("tr")?.children.length || 0;
      table.style.minWidth = `${Math.max(980, columns * 130)}px`;
    }
  });

  document.querySelectorAll(".wf-content").forEach((content) => {
    const children = Array.from(content.children);
    let current = null;
    children.forEach((node) => {
      if (node.tagName === "H2") {
        current = document.createElement("section");
        current.className = "wf-panel";
        content.insertBefore(current, node);
        current.appendChild(node);
      } else if (current && node.parentNode === content) {
        current.appendChild(node);
      }
    });
    enhanceReportContent(content);
  });

  function enhanceReportContent(content) {
    const blocks = Array.from(content.children).filter((node) => {
      if (!node.matches) return false;
      if (node.matches(".sku-profile,.sku-profile-list,script,style")) return false;
      if (node.querySelector("#sku-profile-search")) return false;
      return node.matches(".wf-panel,.section");
    });

    let converted = 0;
    blocks.forEach((block) => {
      const heading = Array.from(block.children).find((child) => child.tagName === "H2");
      if (!heading) return;
      const details = document.createElement("details");
      details.className = `${block.className} wf-readable-section`;
      if (block.id) details.id = block.id;
      if (converted < 2) details.open = true;

      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.className = "wf-section-title";
      title.textContent = heading.textContent.trim() || "章节";
      const count = document.createElement("span");
      count.className = "wf-section-count";
      const rowCount = Array.from(block.querySelectorAll("table")).reduce((sum, table) => sum + countRows(table), 0);
      const cardCount = block.querySelectorAll(".card,.linkcard,.jumpcard").length;
      count.textContent = rowCount ? `${rowCount} 行` : cardCount ? `${cardCount} 项` : "说明";
      summary.append(title, count);

      const body = document.createElement("div");
      body.className = "wf-readable-body";
      Array.from(block.childNodes).forEach((child) => {
        if (child !== heading) body.appendChild(child);
      });
      details.append(summary, body);
      block.replaceWith(details);
      converted += 1;
    });

    installReaderTools(content);
  }

  function installReaderTools(content) {
    if (content.querySelector("#sku-profile-search")) return;
    const targets = () => Array.from(content.querySelectorAll(".wf-readable-section,.sku-profile,.card,.linkcard,.jumpcard"));
    const hasUsefulTargets = targets().length > 3 || content.querySelectorAll("table tr").length > 30;
    if (!hasUsefulTargets || content.querySelector(".wf-reader-tools")) return;

    const tools = document.createElement("div");
    tools.className = "wf-reader-tools";
    tools.innerHTML = `
      <input class="wf-page-filter" type="search" placeholder="搜索当前页：SKU、问题、动作、指标">
      <button type="button" class="wf-expand-all">展开</button>
      <button type="button" class="wf-collapse-all">收起</button>
      <span class="wf-filter-count"></span>
    `;
    content.insertBefore(tools, content.firstElementChild);

    const input = tools.querySelector(".wf-page-filter");
    const count = tools.querySelector(".wf-filter-count");
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let visible = 0;
      const items = targets();
      items.forEach((item) => {
        const match = !q || item.textContent.toLowerCase().includes(q);
        item.style.display = match ? "" : "none";
        if (match) visible += 1;
      });
      content.querySelectorAll("tbody tr").forEach((row) => {
        const match = !q || row.textContent.toLowerCase().includes(q);
        row.style.display = match ? "" : "none";
      });
      count.textContent = q ? `匹配 ${visible} 项` : `${items.length} 项`;
    };
    input.addEventListener("input", apply);
    tools.querySelector(".wf-expand-all").addEventListener("click", () => {
      content.querySelectorAll("details.wf-readable-section,details.sku-profile").forEach((d) => {
        if (d.style.display !== "none") d.open = true;
      });
    });
    tools.querySelector(".wf-collapse-all").addEventListener("click", () => {
      content.querySelectorAll("details.wf-readable-section,details.sku-profile").forEach((d) => d.open = false);
    });
    apply();
  }
});
