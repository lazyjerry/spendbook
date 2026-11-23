// 類別輸入的建議清單（見 docs/afk-skill/adr/014）：取代原生 <datalist>。
// 聚焦或打字時在輸入框下方列出建議的類別（排除已加的），打了清單沒有的字時第一項是「新增「…」」；
// ↑↓ 移動、Enter 選定、Esc 關閉，點項目也行。樣式是 app.css 的 .app-combo-*。

let seq = 0;

const norm = (s) => s.normalize("NFKC").toLowerCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// input：類別輸入框；options()：回傳建議的類別（字串陣列，依常用排序）；
// taken()：回傳已加的類別；clean(s)：整理輸入；onPick(text)：選了某項（建議的類別或新增的字）
export function tagSuggest(input, { options, taken, clean, onPick }) {
  const id = `tag-suggest-${++seq}`;
  const group = input.closest(".input-group") || input;
  const wrap = document.createElement("div");
  wrap.className = "app-combo";
  group.before(wrap);
  wrap.append(group);
  wrap.insertAdjacentHTML("beforeend", `<div class="app-combo-pop" hidden><ul class="app-combo-list" id="${id}-list" role="listbox"></ul></div>`);
  const pop = wrap.querySelector(".app-combo-pop");
  const list = wrap.querySelector(".app-combo-list");

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  let items = []; // { text, isNew }
  let active = -1;

  const isOpen = () => !pop.hidden;

  function setActive(i) {
    const els = list.children;
    if (els[active]) els[active].classList.remove("is-active");
    active = Math.max(-1, Math.min(i, items.length - 1));
    const el = els[active];
    if (el) {
      el.classList.add("is-active");
      el.scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", el.id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function close() {
    pop.hidden = true;
    wrap.classList.remove("is-open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function render() {
    const typed = clean(input.value);
    const q = norm(typed);
    const used = new Set(taken());
    const matches = options().filter((t) => !used.has(t) && (!q || norm(t).includes(q)));
    const exact = matches.find((t) => norm(t) === q);
    items = matches.map((text) => ({ text, isNew: false }));
    if (typed && !exact && !used.has(typed)) items.unshift({ text: typed, isNew: true });
    list.innerHTML = items
      .map((it, i) => {
        const label = it.isNew ? `新增「${esc(it.text)}」` : `#${esc(it.text)}`;
        return `<li class="app-combo-option" id="${id}-opt-${i}" role="option" aria-selected="false" data-i="${i}">${label}</li>`;
      })
      .join("");
    if (!items.length) return close();
    pop.hidden = false;
    wrap.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
    active = -1;
    // 有打字時預設選第一項（新增，或唯一相符的建議），Enter 直接加入；沒打字時不預選，Enter 不做事
    setActive(typed ? (exact ? items.findIndex((it) => it.text === exact) : 0) : -1);
  }

  function pick(i) {
    const it = items[i];
    if (!it) return;
    onPick(it.text);
    if (document.activeElement === input) render();
    else close();
  }

  input.addEventListener("focus", render);
  input.addEventListener("input", render);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // 注音、倉頡選字中的 Enter／方向鍵留給輸入法
    if (e.key === "ArrowDown") {
      if (!isOpen()) render();
      else setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      if (isOpen()) setActive(active - 1);
    } else if (e.key === "Enter") {
      if (!isOpen() || active < 0) return; // 交給外面（原本的 Enter 加入）
      pick(active);
    } else if (e.key === "Escape") {
      if (!isOpen()) return;
      close();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });

  // 用 pointerdown 擋掉預設：點清單時輸入框不失焦，選完可以繼續打
  list.addEventListener("pointerdown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = e.target.closest(".app-combo-option");
    if (li) pick(Number(li.dataset.i));
  });
  list.addEventListener("pointermove", (e) => {
    const li = e.target.closest(".app-combo-option");
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i));
  });

  return { refresh: () => (document.activeElement === input ? render() : close()) };
}
