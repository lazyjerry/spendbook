// 照片壓縮：在瀏覽器裡縮到指定長邊並重新編碼成 JPEG，原檔不離開裝置。
// 重新編碼會一併移除 EXIF（含拍攝位置）。iOS Safari 的 canvas 不一定能輸出 WebP，所以固定 JPEG。

async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // 退回 <img> 解碼
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    throw new Error(`無法讀取「${file.name || "照片"}」，請改用 JPEG 或 PNG（HEIC 請先在相簿轉成 JPEG）`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadImage(file, maxEdge = 2048) {
  const { source, width, height, close } = await decode(file);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  close();
  return canvas;
}

export async function compressImage(file, { maxEdge = 1600, quality = 80 } = {}) {
  if (file.type && !file.type.startsWith("image/")) throw new Error(`「${file.name}」不是圖片檔`);
  const { source, width, height, close } = await decode(file);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // 透明 PNG 轉 JPEG 時底色用白色
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality / 100));
  if (!blob) throw new Error("這個瀏覽器無法壓縮照片，請換用新版 Chrome 或 Safari");
  return { blob, width: canvas.width, height: canvas.height };
}
