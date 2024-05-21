import getDimensions from "canvas-dimensions";
import * as pako from "pako";
import * as FastPNG from "fast-png";

import { encode, ColorType } from "../../src/png-io.js";
import { colorTypeToChannels } from "../../src/util.js";
import { canvasToBuffer, downloadBlob, flattenBuffers } from "../../save.js";

import EncoderWorker from "./worker.js?worker";

const { canvasWidth: width, canvasHeight: height } = getDimensions({
  dimensions: "A0",
  pixelsPerInch: 300,
  units: "cm",
});

const depth = 8;
const colorType = ColorType.RGBA;
const channels = colorTypeToChannels(colorType);

const status = document.querySelector(".status");
const cancel = document.querySelector(".cancel");
// let canvas = document.createElement("canvas");
// const container = document.querySelector(".canvas-container");
// container.appendChild(canvas);

document.querySelector(".info").textContent = JSON.stringify(
  {
    width,
    height,
    depth,
    colorType,
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
  const options = {
    width,
    height,
    data,
    depth,
    colorType,
  };
  return encode(options, pako.deflate, { level: 3 });
}

async function encodeCanvas(data) {
  const canvas = create8BitCanvas(data);
  const buffer = await canvasToBuffer(canvas);
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
  if (type === "cpu") enc = encodeCPU(data);
  else if (type === "canvas") enc = await encodeCanvas(data);
  else if (type === "worker") enc = await encodeWorkerBuffered(data, signal);
  else if (type === "file") await encodeFileWriter(data, fileWriter, signal);
  else if (type === "fast-png") {
    enc = FastPNG.encode({ data, width, height, channels, depth });
  }
  const now = performance.now();

  signal.removeEventListener("abort", onAbort);
  cancel.removeEventListener("click", doAbort);
  cancel.setAttribute("disabled", true);

  if (didCancel) {
    console.log("Cancelled");
    status.textContent = "Cancelled";
  } else {
    const ms = Math.round(now - then);
    const timeStr = `Time: ${ms} ms`;
    console.log(timeStr);
    status.textContent = timeStr;

    if (enc) {
      const blob = new Blob([enc], { type: "image/png" });
      downloadBlob(blob, { filename: "download.png" });

      const img = document.querySelector(".image");
      img.src = URL.createObjectURL(blob);
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
