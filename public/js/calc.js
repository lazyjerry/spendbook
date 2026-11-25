// 金額計算機（編輯頁）：浮在金額欄下方。「=」只在計算機裡算出結果，按「送出」才把結果填回金額欄並收合；
// 計算機失去焦點（點到外面、Tab 離開、Esc）就收合，不動金額欄。
// 只做四則運算（先乘除後加減），結果依幣別小數位數四捨五入。

const OPS = { "+": "+", "-": "−", "*": "×", "/": "÷" };
const MAX_INPUT = 40; // 算式最多幾個字元
const MAX_VALUE = 999_999_999_999; // 與 src/db.js 的金額上限同級：12 位整數

const isOp = (c) => c in OPS;
const show = (expr) => expr.replace(/[+\-*/]/g, (c) => OPS[c]);
const tidy = (v) => Number(v.toPrecision(12)); // 去掉 0.1 + 0.2 這類浮點尾數

// "12+3*4" → 24；算式不完整（結尾是運算子）時忽略結尾；除以 0 丟錯
function evaluate(expr) {
  const tokens = expr.match(/\d+\.?\d*|\.\d+|[+\-*/]/g) || [];
  if (tokens.length && isOp(tokens[tokens.length - 1])) tokens.pop();
  if (!tokens.length) return null;
  const terms = [Number(tokens[0])];
  const signs = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number(tokens[i + 1]);
    if (op === "*") terms.push(terms.pop() * n);
    else if (op === "/") {
      if (n === 0) throw new Error("不能除以 0");
      terms.push(terms.pop() / n);
    } else {
      signs.push(op);
      terms.push(n);
    }
  }
  let v = terms[0];
  signs.forEach((op, i) => (v = op === "+" ? v + terms[i + 1] : v - terms[i + 1]));
  return tidy(v);
}

// 目前正在輸入的那個數字（最後一個運算子之後）
const lastNumber = (expr) => expr.split(/[+\-*/]/).pop();

export function attachCalculator({ input, toggle, panel, decimals, onSubmit }) {
  const exprEl = panel.querySelector("[data-calc-expr]");
  const valueEl = panel.querySelector("[data-calc-value]");
  let expr = "";
  let fresh = false; // 畫面上是結果（剛按 = 或剛帶入金額）：接著按數字就重新開始，按運算子就接著算

  function render(note = "") {
    let text = note;
    let error = Boolean(note);
    if (!note) {
      try {
        const v = evaluate(expr);
        text = v === null ? "0" : v.toLocaleString("zh-TW", { maximumFractionDigits: 10 });
      } catch (err) {
        text = err.message;
        error = true;
      }
    }
    exprEl.textContent = show(expr) || " ";
    valueEl.textContent = text;
    valueEl.classList.toggle("app-is-error", error);
  }

  function press(key) {
    if (key === "submit") return submit();
    if (key === "C") {
      expr = "";
      fresh = false;
    } else if (key === "back") {
      expr = fresh ? "" : expr.slice(0, -1);
      fresh = false;
    } else if (key === "=") {
      try {
        const v = evaluate(expr);
        if (v === null) return render();
        exprEl.textContent = `${show(expr)} =`;
        expr = String(v);
        fresh = true;
        valueEl.textContent = v.toLocaleString("zh-TW", { maximumFractionDigits: 10 });
        valueEl.classList.remove("app-is-error");
      } catch (err) {
        render(err.message);
      }
      return;
    } else if (isOp(key)) {
      if (!expr) expr = "0";
      if (isOp(expr.slice(-1))) expr = expr.slice(0, -1);
      if (expr.endsWith(".")) expr = expr.slice(0, -1);
      expr += key;
      fresh = false;
    } else if (expr.length < MAX_INPUT) {
      // 數字或小數點
      if (fresh) expr = "";
      fresh = false;
      const cur = lastNumber(expr);
      if (key === ".") {
        if (cur.includes(".")) return;
        expr += cur ? "." : "0.";
      } else if (cur === "0") expr = expr.slice(0, -1) + key; // 不留開頭的 0
      else expr += key;
    }
    render();
  }

  function submit() {
    let v;
    try {
      v = evaluate(expr);
    } catch (err) {
      return render(err.message);
    }
    if (v === null) return render("請先輸入金額或算式");
    if (v < 0) return render("金額不能是負數");
    const d = decimals();
    const minor = Math.round(tidy(v * 10 ** d));
    if (minor / 10 ** d > MAX_VALUE) return render("金額太大");
    onSubmit(minor);
    close();
    input.focus();
  }

  function open() {
    const start = input.value.trim().replace(/,/g, "");
    expr = /^\d+(\.\d+)?$/.test(start) ? start.replace(/^0+(?=\d)/, "") : "";
    fresh = Boolean(expr);
    render();
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    panel.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  const inside = (el) => el && (panel.contains(el) || toggle.contains(el));

  // 按鍵與開關鈕不搶焦點：焦點留在計算機面板上，鍵盤輸入一直有效（Safari 點按鈕本來就不給焦點）
  for (const el of [toggle, panel]) el.addEventListener("mousedown", (e) => e.target.closest("button") && e.preventDefault());
  toggle.addEventListener("click", () => (panel.hidden ? open() : close()));
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-key]");
    if (btn) press(btn.dataset.key);
  });
  panel.addEventListener("keydown", (e) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    let key = null;
    if (/^[0-9.]$/.test(e.key) || isOp(e.key)) key = e.key;
    else if (e.key === "x" || e.key === "X") key = "*";
    else if (e.key === "Backspace") key = "back";
    else if (e.key === "Delete") key = "C";
    else if (e.key === "=" || (e.key === "Enter" && !e.target.closest("button"))) key = "=";
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
      toggle.focus();
      return;
    }
    if (!key) return;
    e.preventDefault();
    press(key);
  });
  // 失去焦點就收合：焦點移到面板與開關鈕以外（Tab 離開、點到別的欄位或空白處）
  for (const el of [toggle, panel]) {
    el.addEventListener("focusout", (e) => {
      if (!inside(e.relatedTarget)) setTimeout(() => !inside(document.activeElement) && close(), 0);
    });
  }
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !inside(e.target)) close();
  });

  return { close };
}
