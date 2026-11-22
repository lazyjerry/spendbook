// jerry-ui.js — Jerry 風格元件庫的共用互動（固定檔，整檔複製到專案，不在專案內修改）
// 版本：2.1.0　索引：templates/index.md
// 全部是漸進增強：沒有 JS 時頁面仍可閱讀與操作。
(() => {
  // D1 對話框：<head> 已用內嵌腳本加上 has-dialog；這裡補一次，避免漏貼。
  const hasDialog = typeof HTMLDialogElement === "function";
  if (hasDialog) document.documentElement.classList.add("has-dialog");

  // 開啟鈕是指向對話框 id 的連結（href="#id"）：不支援 <dialog> 時對話框排在頁內，點了直接跳過去。
  if (hasDialog) {
    document.querySelectorAll("[data-dialog-open]").forEach((opener) => {
      const id = (opener.getAttribute("href") || "").slice(1) || opener.dataset.dialogOpen;
      const dialog = document.getElementById(id);
      if (!dialog) return;
      opener.addEventListener("click", (event) => {
        event.preventDefault();
        dialog.showModal();
        dialog.scrollTop = 0;
      });
    });
    document.querySelectorAll("dialog.sheet").forEach((dialog) => {
      dialog.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
      // 點遮罩關閉。
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  // A4 分頁切換：[data-tabs] 內的 .chip[data-tab] 對應 [data-tab-panel]。
  // data-tabs="hover" 時滑鼠移入也切換；觸控只認點按，避免點一下先跳一次。
  document.querySelectorAll("[data-tabs]").forEach((box) => {
    const tabs = box.querySelectorAll("[data-tab]");
    const panels = box.querySelectorAll("[data-tab-panel]");
    const show = (id) => {
      tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.tab === id)));
      panels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== id; });
    };
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => show(tab.dataset.tab));
      if (box.dataset.tabs === "hover") {
        tab.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") show(tab.dataset.tab);
        });
      }
    });
  });

  // F12 數字增減器：button[data-step] 依 input 的 step／min／max 增減，並觸發 input 事件讓工具邏輯接手。
  document.querySelectorAll(".stepper").forEach((stepper) => {
    const input = stepper.querySelector("input");
    if (!input) return;
    const sync = () => {
      const value = Number(input.value);
      stepper.querySelectorAll("[data-step]").forEach((button) => {
        const dir = Number(button.dataset.step);
        button.disabled = (dir < 0 && input.min !== "" && value <= Number(input.min)) || (dir > 0 && input.max !== "" && value >= Number(input.max));
      });
    };
    stepper.querySelectorAll("[data-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const step = Number(input.step) || 1;
        let next = Number(input.value || 0) + Number(button.dataset.step) * step;
        if (input.min !== "") next = Math.max(next, Number(input.min));
        if (input.max !== "") next = Math.min(next, Number(input.max));
        input.value = String(next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        sync();
      });
    });
    input.addEventListener("input", sync);
    sync();
  });

  // F5 滑桿：拖動時同步 label 內的 <output>。
  document.querySelectorAll(".range input[type=range]").forEach((input) => {
    const output = input.closest(".range").querySelector("output");
    if (output) input.addEventListener("input", () => { output.value = input.value; });
  });

  // F6 結果區標題列：button[data-copy="結果區 id"] 複製結果文字，按鈕短暫顯示結果後還原。
  document.querySelectorAll("[data-copy]").forEach((button) => {
    const label = button.textContent;
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.copy);
      const text = target ? target.textContent.trim() : "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "已複製";
      } catch {
        button.textContent = "無法複製";
      }
      setTimeout(() => { button.textContent = label; }, 1500);
    });
  });

  // F6 結果區與 F10 狀態訊息：統一狀態 class，錯誤不靜默。state：""｜"success"｜"warn"｜"error"。
  window.JerryUI = {
    setResult(output, text, state = "") {
      output.classList.remove("is-success", "is-warn", "is-error");
      if (state) output.classList.add(`is-${state}`);
      output.textContent = text;
    },
    // F7 量表：percent 為 0–100，寫入 --value。
    setMeter(meter, percent) {
      const value = Math.max(0, Math.min(100, Number(percent) || 0));
      meter.querySelector("span").style.setProperty("--value", `${value}%`);
      meter.setAttribute("aria-label", meter.getAttribute("aria-label")?.replace(/\d+%/, `${value}%`) || `${value}%`);
    },
    // state：""｜"ok"｜"error"。
    setStatus(element, text, state = "") {
      element.classList.remove("is-ok", "is-error");
      if (state) element.classList.add(`is-${state}`);
      element.textContent = text;
    },
  };
})();
