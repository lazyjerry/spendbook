// 照片 popup：點縮圖在頁內的對話框（D1 .sheet 結構）看大圖，不另開圖片網址。
// 一筆有多張時可用按鈕或左右鍵切換。對話框第一次用到才建立，各頁共用一個。

let dialog = null;
let list = [];
let index = 0;

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "sheet app-viewer";
  dialog.setAttribute("aria-labelledby", "viewer-title");
  dialog.innerHTML = `<div class="sheet-body" tabindex="-1">
  <div class="sheet-head">
    <div><h2 id="viewer-title">照片</h2></div>
    <button class="sheet-x" type="button" data-viewer-close aria-label="關閉">×</button>
  </div>
  <img class="app-viewer-img" alt="">
  <p class="sheet-foot app-viewer-nav"><button class="btn is-sm secondary" type="button" data-step="-1">← 上一張</button><button class="btn is-sm secondary" type="button" data-step="1">下一張 →</button></p>
</div>`;
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-viewer-close]")) dialog.close();
    const step = e.target.closest("[data-step]");
    if (step) show(index + Number(step.dataset.step));
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(index - 1);
    else if (e.key === "ArrowRight") show(index + 1);
  });
  // 關掉後拿掉圖片，下次開啟不會先閃出上一張
  dialog.addEventListener("close", () => dialog.querySelector("img").removeAttribute("src"));
  document.body.append(dialog);
}

function show(i) {
  if (!list.length) return;
  index = (i + list.length) % list.length;
  const many = list.length > 1;
  dialog.querySelector("img").src = list[index];
  dialog.querySelector("img").alt = many ? `第 ${index + 1} 張照片` : "照片";
  dialog.querySelector("#viewer-title").textContent = many ? `照片 ${index + 1}／${list.length}` : "照片";
  dialog.querySelector(".app-viewer-nav").hidden = !many;
}

// srcs：圖片網址陣列；start：先顯示第幾張（0 起算）
export function openPhotos(srcs, start = 0) {
  if (!srcs.length) return;
  if (!dialog) build();
  list = srcs;
  show(start);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", ""); // 不支援 <dialog> 的瀏覽器：直接顯示
  dialog.querySelector(".sheet-body").focus();
}
