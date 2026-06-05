
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".wf-content table").forEach((table) => {
    if (table.closest(".wf-table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "wf-table-wrap";
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
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
  });
});
