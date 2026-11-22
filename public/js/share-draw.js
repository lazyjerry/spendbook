// 分享圖：用 canvas 畫出一段期間的紀錄，上方帶 App 標誌。兩種樣式——時間軸（一天一個節點）與列表（一筆一列）。
// 先在暫存 canvas 上排一次版量出高度，再開正式尺寸的 canvas 畫一次。寬度固定 1080px。
import { APP_NAME, dateLabel, formatMoney, groupByDay, hm, totalsText } from "./common.js";

const W = 1080;
const OUTER = 44; // 紙色邊
const PAD = 56; // 卡片內距
const X0 = OUTER + PAD;
const X1 = W - OUTER - PAD;
const SHADOW = 12;
export const MAX_ROWS = 60; // 超過的筆數不畫，圖尾註明

// 對應 public/jerry-ui.css 的 token
const C = { paper: "#f5f3ed", card: "#fffefa", ink: "#171e34", ink2: "#555a6d", track: "#dfddd7", coral: "#ed735f", coralInk: "#b6402c", white: "#ffffff", onInk2: "#bbc1d1" };

let logoPromise = null;
function loadLogo() {
  logoPromise ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("App 標誌載入失敗，請重新整理再試"));
    img.src = "/icons/icon-512.png";
  });
  return logoPromise;
}

function fonts() {
  const sans = getComputedStyle(document.body).fontFamily || "sans-serif";
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  return { sans: (weight, px) => `${weight} ${px}px ${sans}`, mono: (weight, px) => `${weight} ${px}px ${mono}, ${sans}` };
}

// 依寬度斷行（逐字，中文不需要斷詞）；超過 maxLines 的部分以「…」收尾
function wrap(ctx, text, maxWidth, maxLines) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of Array.from(para)) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch.trim() ? ch : "";
      } else {
        line += ch;
      }
    }
    if (line.trim()) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + "…";
  return kept;
}

function text(ctx, str, x, y, { font, color = C.ink, align = "left" }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(str, x, y);
}

// 畫標題與（選用）描述；回傳畫完後的 y。amount 靠右，標題寬度讓出金額的位置
function drawEntry(ctx, f, r, x, y, opts) {
  const amount = opts.showAmount ? formatMoney(r.amountMinor, r.currency) : "";
  ctx.font = f.mono(800, 32);
  const amountW = amount ? ctx.measureText(amount).width + 24 : 0;
  ctx.font = f.sans(800, 32);
  const lines = wrap(ctx, r.title, X1 - x - amountW, 2);
  if (amount) text(ctx, amount, X1, y, { font: f.mono(800, 32), color: C.coralInk, align: "right" });
  for (const line of lines) {
    text(ctx, line, x, y, { font: f.sans(800, 32) });
    y += 44;
  }
  if (opts.showDesc && r.description) {
    ctx.font = f.sans(500, 26);
    for (const line of wrap(ctx, r.description, X1 - x, 2)) {
      text(ctx, line, x, y + 2, { font: f.sans(500, 26), color: C.ink2 });
      y += 38;
    }
    y += 4;
  }
  return y;
}

function drawTimeline(ctx, f, records, y, opts) {
  const lineX = X0 + 14;
  const textX = X0 + 52;
  const nodes = []; // 日期節點的 y
  const dots = []; // 每筆紀錄的小圓點 y
  for (const g of groupByDay(records)) {
    nodes.push(y + 22);
    text(ctx, dateLabel(g.date), textX, y + 2, { font: f.sans(900, 34) });
    if (opts.showAmount) text(ctx, `${g.items.length} 筆 · ${totalsText(g.items)}`, X1, y + 10, { font: f.sans(700, 24), color: C.ink2, align: "right" });
    y += 64;
    for (const r of g.items) {
      dots.push(y + 18);
      text(ctx, hm(new Date(r.occurredAt)), textX, y + 4, { font: f.mono(700, 24), color: C.ink2 });
      y = drawEntry(ctx, f, r, textX + 96, y, opts) + 18;
    }
    y += 14;
  }
  // 軸線從第一個節點連到最後一筆，再蓋上節點與圓點（都在文字左側，不會壓到字）
  if (nodes.length) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(lineX - 2, nodes[0], 4, dots[dots.length - 1] - nodes[0]);
  }
  for (const ny of nodes) {
    ctx.beginPath();
    ctx.arc(lineX, ny, 14, 0, Math.PI * 2);
    ctx.fillStyle = C.coral;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
  }
  for (const dy of dots) {
    ctx.beginPath();
    ctx.arc(lineX, dy, 7, 0, Math.PI * 2);
    ctx.fillStyle = C.ink;
    ctx.fill();
  }
  return y;
}

function drawList(ctx, f, records, y, opts) {
  const textX = X0 + 196;
  records.forEach((r, i) => {
    if (i) {
      ctx.fillStyle = C.track;
      ctx.fillRect(X0, y, X1 - X0, 2);
      y += 20;
    }
    const at = new Date(r.occurredAt);
    text(ctx, `${at.getMonth() + 1}/${at.getDate()}`, X0, y + 2, { font: f.mono(800, 28) });
    text(ctx, hm(at), X0 + 100, y + 6, { font: f.mono(600, 24), color: C.ink2 });
    y = drawEntry(ctx, f, r, textX, y, opts) + 16;
  });
  return y;
}

// 把整張圖畫到 ctx 上，回傳內容底端的 y
function paint(ctx, logo, data, opts) {
  const f = fonts();
  let y = OUTER + PAD;
  // 頁首：標誌、App 名稱、期間
  const L = 104;
  ctx.drawImage(logo, X0, y, L, L);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.ink;
  ctx.strokeRect(X0, y, L, L);
  text(ctx, APP_NAME, X0 + L + 28, y + 2, { font: f.sans(900, 52) });
  text(ctx, [data.rangeText, opts.nickname].filter(Boolean).join(" · "), X0 + L + 28, y + 66, { font: f.sans(700, 28), color: C.ink2 });
  y += L + 32;
  ctx.fillStyle = C.ink;
  ctx.fillRect(X0, y, X1 - X0, 4);
  y += 36;

  // 合計
  if (opts.showTotal) {
    const sums = opts.showAmount ? data.totals : [];
    const h = sums.length ? 84 + sums.length * 58 + 10 : 92;
    ctx.fillStyle = C.ink;
    ctx.fillRect(X0, y, X1 - X0, h);
    text(ctx, `共 ${data.count} 筆`, X0 + 28, y + 26, { font: f.sans(800, sums.length ? 26 : 34), color: sums.length ? C.onInk2 : C.white });
    let ty = y + 70;
    for (const s of sums) {
      text(ctx, s, X0 + 28, ty, { font: f.mono(800, 44), color: C.white });
      ty += 58;
    }
    y += h + 40;
  }

  y = opts.style === "list" ? drawList(ctx, f, data.records, y, opts) : drawTimeline(ctx, f, data.records, y, opts);
  if (data.omitted) {
    text(ctx, `另有 ${data.omitted} 筆未列出`, X0, y + 6, { font: f.sans(700, 26), color: C.ink2 });
    y += 52;
  }

  // 頁尾：小標誌與 App 名稱
  y += 12;
  ctx.fillStyle = C.ink;
  ctx.fillRect(X0, y, X1 - X0, 4);
  y += 28;
  ctx.drawImage(logo, X0, y, 44, 44);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.ink;
  ctx.strokeRect(X0, y, 44, 44);
  text(ctx, APP_NAME, X0 + 60, y + 8, { font: f.sans(800, 26) });
  text(ctx, data.madeText, X1, y + 12, { font: f.mono(600, 22), color: C.ink2, align: "right" });
  return y + 44 + PAD;
}

// records：由舊到新。回傳畫好的 canvas。
// data：{ rangeText, count, totals: ["NT$ 1,200", …], madeText }；opts：{ style: "timeline"|"list", showTotal, showDesc, showAmount, nickname }
export async function drawShareImage(records, data, opts) {
  const logo = await loadLogo();
  if (document.fonts?.ready) await document.fonts.ready;
  const shown = records.slice(0, MAX_ROWS);
  const full = { ...data, records: shown, omitted: records.length - shown.length };

  const probe = document.createElement("canvas");
  probe.width = W;
  probe.height = 8;
  const bottom = paint(probe.getContext("2d"), logo, full, opts);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.ceil(bottom + OUTER + SHADOW);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cardW = W - OUTER * 2 - SHADOW;
  const cardH = bottom - OUTER;
  ctx.fillStyle = C.ink; // 硬陰影
  ctx.fillRect(OUTER + SHADOW, OUTER + SHADOW, cardW, cardH);
  ctx.fillStyle = C.card;
  ctx.fillRect(OUTER, OUTER, cardW, cardH);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.ink;
  ctx.strokeRect(OUTER, OUTER, cardW, cardH);
  paint(ctx, logo, full, opts);
  return canvas;
}

// 文字樣式：純文字，貼到任何聊天軟體都能讀
export function shareText(records, data, opts) {
  const lines = [`${APP_NAME}｜${data.rangeText}${opts.nickname ? `（${opts.nickname}）` : ""}`];
  if (opts.showTotal) lines.push(opts.showAmount && data.totals.length ? `共 ${data.count} 筆，合計 ${data.totals.join("、")}` : `共 ${data.count} 筆`);
  for (const g of groupByDay(records)) {
    lines.push("", dateLabel(g.date));
    for (const r of g.items) {
      lines.push(`・${hm(new Date(r.occurredAt))} ${r.title}${opts.showAmount ? `　${formatMoney(r.amountMinor, r.currency)}` : ""}`);
      if (opts.showDesc && r.description) lines.push(...r.description.split("\n").map((l) => `　${l}`));
    }
  }
  return lines.join("\n");
}
