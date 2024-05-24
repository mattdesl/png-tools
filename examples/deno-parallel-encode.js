// TODO:
// https://github.com/DavidBuchanan314/parallel-png-proposal

import {
  ColorType,
  FilterMethod,
  colorTypeToChannels,
  encodeChunk,
  encodeHeader,
  ChunkType,
  encode_IHDR,
  colorTypeToString,
  flattenBuffers,
} from "../index.js";
// import ProgressBar from "https://deno.land/x/progress@v1.4.9/mod.ts";
import { MultiProgressBar } from "https://deno.land/x/progress@v1.4.9/mod.ts";

import { adler32_combine } from "./util/adler32.js";

const output = Deno.args[0];
if (!output)
  throw new Error(
    "Must specify an output, example:\n  deno run deno-parallel-encode.js myfile.png"
  );

const width = 16000;
const height = 16000;
const colorType = ColorType.RGB;
const depth = 16;
const channels = colorTypeToChannels(colorType);
const filter = FilterMethod.Up;
const pageCount = 16;
console.log("Workers:", pageCount);

const ArrType = depth === 16 ? Uint16Array : Uint8ClampedArray;
const maxValue = depth === 16 ? 0xffff : 0xff;

const data = new ArrType(width * height * channels);

// quickly generate some image data
const tileSize = Math.floor(width * 0.1);
for (let y = 0; y < tileSize; y++) {
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < channels; c++) {
      const idx = x + y * height;
      const px = Math.floor(x / tileSize);
      const py = Math.floor(y / (tileSize / 2));
      const v = (px + py) % 2 === 0 ? maxValue : 0x00;
      data[idx * channels + c] = v;
    }
  }
}

// copy data across rest of buffer
const tileChunkSize = tileSize * width * channels;
let i = tileChunkSize;
while (i < data.length) {
  data.copyWithin(i, 0, tileChunkSize);
  i += tileChunkSize;
}

// our image options
const options = {
  width,
  height,
  depth,
  colorType,
  filter,
};

console.log(`Image Size: %s x %s px`, width, height);
console.log(`Depth: %s bpp`, depth);
console.log(`Color Type: %s`, colorTypeToString(colorType));

// show progress
const progressBar = new MultiProgressBar({ title: "encoding" });

const file = await Deno.open(output, {
  create: true,
  write: true,
  truncate: true,
});

const fileWriter = file.writable.getWriter();
await fileWriter.ready;

console.time("encode");

async function writeChunk(chunk) {
  return fileWriter.write(encodeChunk(chunk));
}

// encode PNG header
await fileWriter.write(encodeHeader());

// encode metadata
await writeChunk({
  type: ChunkType.IHDR,
  data: encode_IHDR(options),
});

// number of pages i.e. number of threads that will be run
// await progressBar.render(Array(pageCount));

const deflateOptions = { level: 3 };

const results = await processWorkers(
  data,
  options,
  pageCount,
  deflateOptions,
  (progresses) =>
    progressBar.render(
      progresses.map((p) => ({
        completed: p * 100,
        total: 100,
      }))
    )
);

let adler;
for (let i = 0; i < results.length; i++) {
  const { result, adler: chunkAdler, size } = results[i];
  adler = adler32_combine(adler, chunkAdler, size);

  let compressed = result;
  if (i === results.length - 1) {
    // last chunk, concat with adler32
    const adlerBytes = new Uint8Array(4);
    const dv = new DataView(adlerBytes.buffer);
    dv.setUint32(0, adler);
    compressed = flattenBuffers([result, adlerBytes]);
  }

  // encode the current IDAT chunk
  await writeChunk({ type: ChunkType.IDAT, data: compressed });
}

// write ending chunk
await writeChunk({ type: ChunkType.IEND });

// stop progress
await progressBar.render(results.map((p) => ({ completed: 100, total: 100 })));
await progressBar.end();

// // end stream
await fileWriter.close();
console.timeEnd("encode");

async function processWorkers(
  data,
  options,
  pageCount,
  deflateOptions,
  progress = () => {}
) {
  const { width, height, colorType = ColorType.RGBA } = options;
  const channels = colorTypeToChannels(colorType);

  const workerResults = Array(pageCount).fill(null);
  let remaining = pageCount;
  return new Promise((resolve) => {
    // split whole stream into smaller sections
    for (let { index, view, isFirst, isLast } of splitPixels(
      data,
      width,
      height,
      channels,
      pageCount
    )) {
      const worker = new Worker(
        new URL("./util/parallel-encoder.js", import.meta.url),
        {
          type: "module",
        }
      );

      // we need to create a slice to pass it off to the worker
      // otherwise subarray view gets detached
      const sliced = view.slice();

      worker.postMessage(
        {
          ...options, // image encoding options and data
          view: sliced,
          index,
          isFirst,
          isLast,
          deflateOptions,
        },
        [sliced.buffer]
      );
      const handler = async (ev) => {
        const r = ev.data;
        workerResults[r.index] = r;
        if (r.result) {
          worker.removeEventListener("message", handler);
          worker.terminate();
          remaining--;
          // TODO: Use MultiProgressBar to indicate the progress of each
          const progresses = workerResults.map((r) => {
            return r ? r.progress || 0 : 0;
            // (pageCount - remaining) / pageCount
          });
          await progress(progresses);
          if (remaining === 0) {
            resolve(workerResults);
          } else if (remaining < 0) {
            throw new Error("Worker received too many events");
          }
        }
      };
      worker.addEventListener("message", handler);
    }
  });
}

function* splitPixels(data, width, height, channels, splitCount) {
  const chunkHeight = Math.floor(height / splitCount);
  const chunkSize = chunkHeight * width * channels;
  for (let i = 0; i < splitCount; i++) {
    const start = i * chunkSize;
    const end = i === splitCount - 1 ? data.length : start + chunkSize;
    yield {
      index: i,
      start,
      end,
      view: data.subarray(start, end),
      isFirst: i === 0,
      isLast: i === splitCount - 1,
    };
  }
}
