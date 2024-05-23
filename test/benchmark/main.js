import getDimensions from "canvas-dimensions";
import * as pako from "pako";
import * as FastPNG from "fast-png";

import {
  encode,
  ColorType,
  FilterMethod,
  ChunkType,
  encodeChunks,
  decodeChunks,
  withoutChunks,
} from "../../src/png-io.js";
import {
  colorTypeToChannels,
  encode_pHYs_PPI,
  flattenBuffers,
} from "../../src/util.js";
import { canvasToBuffer, downloadBlob } from "../../examples/util/save.js";
import prettyBytes from "pretty-bytes";

const params = {
  dimensions: "A0",
  pixelsPerInch: 150,
  units: "cm",
  depth: 16,
  colorType: ColorType.RGBA,
  filter: FilterMethod.Paeth,
};

const { canvasWidth: width, canvasHeight: height } = getDimensions({
  ...params,
});

const colorTypeToString = (n) => {
  const entries = Object.entries(ColorType);
  return entries.find((e) => e[1] === n)[0];
};

const { depth, colorType, pixelsPerInch, filter } = params;
const channels = colorTypeToChannels(colorType);

const status = document.querySelector(".status");
const cancel = document.querySelector(".cancel");
const download = document.querySelector(".download");
const img = document.querySelector(".image");
let curBlob;

download.onclick = (ev) => {
  ev.preventDefault();
  if (curBlob) downloadBlob(curBlob, { filename: "download.png" });
};

// let canvas = document.createElement("canvas");
// const container = document.querySelector(".canvas-container");
// container.appendChild(canvas);
const updateStatus = (n) => {
  let str;
  if (n === "worker") str = "Use a WebWorker to encode off the main thread.";
  else if (n === "file")
    str =
      "Use WebWorker + File System API to stream encode directly into a file on disk (Chrome only).";
  else if (n === "canvas") {
    str =
      "Use Canvas2D toBlob() to encode a PNG, which only supports 8 bits per pixel.";
  } else if (n === "cpu") {
    str =
      "Use the main thread (no worker) to encode, which is simpler but halts the UI, does not report progress, and cannot be cancelled.";
  } else if (n === "fast-png") {
    str = "Use the fast-png module to encode, for benchmark comparison.";
  }
  status.textContent = str;
};

const typeSelect = document.querySelector("select");
typeSelect.oninput = (ev) => {
  updateStatus(ev.currentTarget.value);
  curBlob = null;
  img.src = "";
  download.setAttribute("disabled", true);
};
updateStatus(typeSelect.value);

document.querySelector(".info").textContent = JSON.stringify(
  {
    ...params,
    colorType: colorTypeToString(colorType),
    depth,
    width,
    height,
  },
  null,
  2
);

async function encodeWorkerBuffered(data, signal) {
  let buffers = [];
  await encodeWorker(data, (d) => buffers.push(d), signal);
  return flattenBuffers(buffers);
}

async function encodeWorker(data, write, signal) {
  const options = {
    width,
    height,
    depth,
    colorType,
    data,
    pixelsPerInch,
    filter,
  };
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    const close = () => {
      worker.terminate();
      resolve();
    };
    if (signal) signal.addEventListener("abort", close);
    worker.postMessage(options, [data.buffer]);
    const handler = async (ev) => {
      const data = ev.data;
      status.textContent = `Progress: ${Math.round(data.progress * 100)}%`;
      write(data.chunk);
      if (data.finished) {
        worker.removeEventListener("message", handler);
        if (signal) signal.removeEventListener("abort", close);
        close();
      }
    };
    worker.addEventListener("message", handler);
  });
}

function encodeCPU(data) {
  const ancillary = [];

  // optionally embed resolution
  if (pixelsPerInch) {
    ancillary.push({
      type: ChunkType.pHYs,
      data: encode_pHYs_PPI(pixelsPerInch),
    });
  }

  const options = {
    width,
    height,
    data,
    depth,
    colorType,
    ancillary,
    filter,
  };
  return encode(options, pako.deflate, { level: 3 });
}

async function encodeCanvas(data) {
  const canvas = create8BitCanvas(data);
  let buffer = await canvasToBuffer(canvas);
  // if we have additional metadata, we can re-encode without having to re-compress
  if (pixelsPerInch) {
    let chunks = decodeChunks(buffer);
    // strip out an existing pHYs chunk if it exists
    chunks = withoutChunks(chunks, ChunkType.pHYs);
    // include the new chunk
    chunks.splice(1, 0, {
      type: ChunkType.pHYs,
      data: encode_pHYs_PPI(pixelsPerInch),
    });
    // re-encode the chunks (does not re-compress the data stream)
    buffer = encodeChunks(chunks);
  }
  return buffer;
}

async function getFileStream(opts = {}) {
  if (!window.showSaveFilePicker) {
    throw new Error("Not supported on this browser");
  }
  const { filename = "download.png" } = opts;

  // create a new handle
  const newHandle = await window.showSaveFilePicker({
    excludeAcceptAllOption: true,
    id: "benchmark",
    startIn: "downloads",
    suggestedName: filename,
    types: [
      {
        description: "PNG Image",
        accept: { "image/png": [".png"] },
      },
    ],
  });

  return newHandle.createWritable();
}

async function encodeFileWriter(data, writer, signal) {
  let chain = Promise.resolve();

  // create a chain of promises that write one after another
  const write = (chunk) => {
    chain = chain.then(() => writer.write(chunk));
  };

  // wait for encoder to finish
  await encodeWorker(data, write, signal);

  // make sure all writes are finished too
  await chain;

  // close writer
  await writer.close();
}

function create8BitCanvas(data) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (depth === 8 && channels === 4) {
    rgba.set(data);
  } else {
    const maxOutSample = 0xff;
    const maxInSample = depth === 16 ? 0xffff : 0xff;
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 4; c++) {
        if (c < channels) {
          let v = data[i * channels + c];
          v = Math.round((v / maxInSample) * maxOutSample);
          v = Math.max(0, Math.min(maxOutSample, v));
          rgba[i * 4 + c] = v;
        } else rgba[i * 4 + c] = 0xff;
      }
    }
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  canvas.width = width;
  canvas.height = height;
  const imgData = context.createImageData(width, height);
  imgData.data.set(rgba);
  context.putImageData(imgData, 0, 0);
  return canvas;
}

async function doEncode(data) {
  const type = document.querySelector("select").value;
  let enc;

  const ac = new AbortController();
  const signal = ac.signal;

  let didCancel = false;
  const onAbort = () => {
    didCancel = true;
  };
  const doAbort = () => {
    ac.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  cancel.addEventListener("click", doAbort, { once: true });

  let fileWriter;
  if (type === "file") {
    fileWriter = await getFileStream();
  }

  if (type === "file" || type === "worker") cancel.removeAttribute("disabled");
  else cancel.setAttribute("disabled", true);

  const then = performance.now();
  // console.profile("encode");
  if (type === "cpu") enc = encodeCPU(data);
  else if (type === "canvas") enc = await encodeCanvas(data);
  else if (type === "worker") enc = await encodeWorkerBuffered(data, signal);
  else if (type === "file") await encodeFileWriter(data, fileWriter, signal);
  else if (type === "fast-png") {
    enc = FastPNG.encode({ data, width, height, channels, depth });
  }
  // console.profileEnd("encode");
  const now = performance.now();

  signal.removeEventListener("abort", onAbort);
  cancel.removeEventListener("click", doAbort);
  cancel.setAttribute("disabled", true);

  if (didCancel) {
    console.log("Cancelled");
    status.textContent = "Cancelled";
  } else {
    const ms = Math.round(now - then);
    const bytesSuffix = enc ? ` (Bytes: ${prettyBytes(enc.byteLength)})` : "";
    const timeStr = `Time: ${ms} ms` + bytesSuffix;
    console.log(timeStr);
    status.textContent = timeStr;

    if (enc) {
      curBlob = new Blob([enc], { type: "image/png" });
      download.removeAttribute("disabled");
      img.src = URL.createObjectURL(curBlob);
    }
  }
}

const worker = new Worker(new URL("./generate.js", import.meta.url), {
  type: "module",
});
worker.postMessage({ width, height, channels, depth });
worker.addEventListener("message", (ev) => {
  const btn = document.querySelector(".encode");
  btn.textContent = "Encode PNG";

  btn.removeAttribute("disabled");
  btn.onclick = async () => {
    btn.setAttribute("disabled", true);
    await new Promise((r) => setTimeout(r, 10));
    try {
      console.log("encoding");
      await doEncode(ev.data.slice());
    } catch (err) {
      if (err.name != "AbortError") {
        console.error(err);
        alert(err.message);
      }
    }
    btn.removeAttribute("disabled");
  };
});
