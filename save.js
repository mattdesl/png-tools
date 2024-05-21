let link;

// export async function createPNGExporter(opts = {}) {
//   const { id, filename } = opts;
//   let fileWriter, fileHandle;
//   if (isFileSystemAPISupported()) {
//     fileHandle = await window.showSaveFilePicker({
//       startIn: "downloads",
//       suggestedName: filename,
//       excludeAcceptAllOption: true,
//       id,
//       types: [
//         {
//           description: "PNG Image",
//           accept: {
//             "image/png": [".png"],
//           },
//         },
//       ],
//       ...opts.filePicker,
//     });

//     fileWriter = await fileHandle.createWritable();
//   }

//   return {
//     get fileHandle() {
//       return fileHandle;
//     },
//     get fileWriter() {
//       return fileWriter;
//     },
//     async write(buf) {
//       if (fileWriter) {
//         fileWriter.write(buf);
//         fileWriter.close();
//       } else {
//         const blob = new Blob([buf], { type: "image/png" });
//         return downloadPNG(blob, { filename });
//       }
//     },
//   };
// }

export function downloadBuffer(buf, opts = {}) {
  const { filename = "download" } = opts;
  const blob = new Blob([buf], opts);
  return downloadBlob(blob, { filename });
}

export function flattenBuffers(chunks) {
  let totalSize = 0;
  for (let chunk of chunks) {
    totalSize += chunk.length;
  }

  const result = new Uint8Array(totalSize);
  for (let i = 0, pos = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

export function downloadBlob(blob, opts = {}) {
  return new Promise((resolve) => {
    const filename = opts.filename || "download";
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

// export function isFileSystemAPISupported() {
//   return typeof window.showSaveFilePicker === "function";
// }

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
