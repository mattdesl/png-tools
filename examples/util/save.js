let link;

export function downloadBuffer(buf, opts = {}) {
  const { filename = "download" } = opts;
  const blob = new Blob([buf], opts);
  return downloadBlob(blob, { filename });
}

export function downloadBlob(blob, opts = {}) {
  return new Promise((resolve) => {
    const filename = opts.filename || getTimestamp();
    if (!link) {
      link = document.createElement("a");
      link.style.visibility = "hidden";
      link.target = "_blank";
    }
    link.download = filename;
    link.href = window.URL.createObjectURL(blob);
    document.body.appendChild(link);
    link.onclick = () => {
      link.onclick = () => {};
      setTimeout(() => {
        window.URL.revokeObjectURL(blob);
        if (link.parentElement) link.parentElement.removeChild(link);
        link.removeAttribute("href");
        resolve({ filename });
      });
    };
    link.click();
  });
}

export function getTimestamp() {
  const today = new Date();
  const yyyy = today.getFullYear();
  let [mm, dd, hh, min, sec] = [
    today.getMonth() + 1, // Months start at 0!
    today.getDate(),
    today.getHours(),
    today.getMinutes(),
    today.getSeconds(),
  ].map((c) => String(c).padStart(2, "0"));
  return `${yyyy}.${mm}.${dd}-${hh}.${min}.${sec}`;
}

export async function canvasToBuffer(canvas, opts = {}) {
  let blob;
  if (typeof canvas.convertToBlob === "function") {
    // for off screen canvas, e.g. worker threads
    blob = await canvas.convertToBlob(opts);
  } else {
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, opts.type, opts.quality)
    );
  }
  const arrayBuf = await blob.arrayBuffer();
  const buf = new Uint8Array(arrayBuf);
  return buf;
}
