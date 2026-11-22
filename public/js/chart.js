// 長條圖（SVG，不依賴外部套件）：單一數列、單一顏色，y 軸從 0 開始。
// items：[{ label, value, title }]；label 是 x 軸文字，title 是滑鼠停留與報讀用的完整說明。
// 顏色與字型走 app.css 的 .app-chart 規則（Jerry UI 的 token），不在這裡寫死。
const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text = "") {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

// 取「好讀」的刻度上限與間距：1、2、5 的十的次方倍
function niceScale(max, ticks = 4) {
  if (max <= 0) return { top: 1, step: 1 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}

export function barChart(container, items, { formatValue = String, formatTick = String, ariaLabel = "長條圖", height = 240 } = {}) {
  container.replaceChildren();
  if (!items.length || items.every((i) => !i.value)) {
    const p = document.createElement("p");
    p.className = "app-chart-empty";
    p.textContent = "這段範圍沒有資料";
    container.append(p);
    return;
  }
  const width = Math.max(320, Math.round(container.clientWidth || 640));
  const m = { top: 24, right: 8, bottom: 30, left: 52 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const max = Math.max(...items.map((i) => i.value));
  const { top, step } = niceScale(max);
  const y = (v) => m.top + plotH - (v / top) * plotH;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height, role: "img", "aria-label": ariaLabel });
  // 格線與 y 軸刻度
  for (let v = 0; v <= top + step / 2; v += step) {
    svg.append(el("line", { class: v === 0 ? "app-chart-axis" : "app-chart-grid", x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }));
    svg.append(el("text", { class: "app-chart-tick", x: m.left - 8, y: y(v), "text-anchor": "end", "dominant-baseline": "middle" }, formatTick(v)));
  }
  // 長條：寬度留 2px 以上的間隔；x 軸文字太擠就隔幾個標一次
  const slot = plotW / items.length;
  const barW = Math.max(1, Math.min(48, slot - Math.max(2, slot * 0.25)));
  const every = Math.ceil(items.length / Math.max(1, Math.floor(plotW / 44)));
  const maxIndex = items.findIndex((i) => i.value === max);
  items.forEach((item, i) => {
    const cx = m.left + slot * i + slot / 2;
    const g = el("g", { class: "app-chart-bar" });
    g.append(el("title", {}, item.title || `${item.label}：${formatValue(item.value)}`));
    // 透明的整欄感應區，讓矮的長條也容易指到
    g.append(el("rect", { class: "app-chart-hit", x: cx - slot / 2, y: m.top, width: slot, height: plotH }));
    if (item.value > 0) {
      const h = Math.max(2, m.top + plotH - y(item.value));
      g.append(el("rect", { class: "app-chart-fill", x: cx - barW / 2, y: m.top + plotH - h, width: barW, height: h }));
    }
    svg.append(g);
    if (i % every === 0) svg.append(el("text", { class: "app-chart-tick", x: cx, y: height - 10, "text-anchor": "middle" }, item.label));
    // 只在最高的那一條直接標數值，其餘靠刻度與數字表
    if (i === maxIndex) {
      const anchor = cx < m.left + 60 ? "start" : cx > width - m.right - 60 ? "end" : "middle";
      svg.append(el("text", { class: "app-chart-value", x: cx, y: y(item.value) - 8, "text-anchor": anchor }, formatValue(item.value)));
    }
  });
  container.append(svg);
}
