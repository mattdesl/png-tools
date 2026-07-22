import { performance } from "node:perf_hooks";
import { deflate, inflate } from "pako";
import * as FastPNG from "fast-png";
import {
  ColorType,
  FilterMethod,
  decode,
  encode,
  encode_IDAT_raw,
  readChunks,
  writeChunks,
} from "../index.js";

const width = Number(process.env.PNG_BENCH_WIDTH ?? 1024);
const height = Number(process.env.PNG_BENCH_HEIGHT ?? width);
const samples = Number(process.env.PNG_BENCH_SAMPLES ?? 12);
const warmups = Number(process.env.PNG_BENCH_WARMUPS ?? 4);
const channels = 4;
const data = createImage(width, height, channels);
const image = { width, height, channels, depth: 8, data };
const options = { ...image, colorType: ColorType.RGBA };

console.log(
  `Node ${process.version}; ${width}x${height} RGBA8; ${samples} samples after ${warmups} warmups`,
);

for (const level of [0, 3]) {
  compare(
    `encode None, zlib level ${level}`,
    () => encode({ ...options, filter: FilterMethod.None }, deflate, { level }),
    () => FastPNG.encode(image, { zlib: { level } }),
  );
  compare(
    `encode Up vs None, zlib level ${level}`,
    () => encode({ ...options, filter: FilterMethod.Up }, deflate, { level }),
    () => FastPNG.encode(image, { zlib: { level } }),
  );
}

const nonePng = encode(
  { ...options, filter: FilterMethod.None },
  deflate,
  { level: 3 },
);
const paethPng = encode(
  { ...options, filter: FilterMethod.Paeth },
  deflate,
  { level: 3 },
);
const upPng = encode(
  { ...options, filter: FilterMethod.Up },
  deflate,
  { level: 3 },
);

compare(
  "decode None",
  () => decode(nonePng, inflate, { preserveFormat: true }),
  () => FastPNG.decode(nonePng),
);

console.log("\npng-tools decode without inflate:");
for (const [name, filter] of Object.entries(FilterMethod)) {
  const png = encode({ ...options, filter }, deflate, { level: 0 });
  const rawPng = uncompressed(png);
  benchmark(name, () => decode(rawPng, clone, { preserveFormat: true }));
}
compare(
  "decode Up",
  () => decode(upPng, inflate, { preserveFormat: true }),
  () => FastPNG.decode(upPng),
);
compare(
  "decode Paeth",
  () => decode(paethPng, inflate, { preserveFormat: true }),
  () => FastPNG.decode(paethPng),
);

console.log("\nRaw png-tools filtering (no compression):");
for (const [name, filter] of Object.entries(FilterMethod)) {
  benchmark(name, () => encode_IDAT_raw(data, { ...options, filter }));
}

function compare(name, pngTools, fastPng) {
  const [ours, theirs] = measurePair(pngTools, fastPng);
  console.log(`\n${name}:`);
  console.log(format("png-tools", ours));
  console.log(format("fast-png", theirs));
  console.log(`  ratio       ${(theirs.median / ours.median).toFixed(2)}x`);
}

function measurePair(first, second) {
  let result;
  for (let i = 0; i < warmups; i++) {
    result = first();
    result = second();
  }
  const firstTimes = [];
  const secondTimes = [];
  for (let i = 0; i < samples; i++) {
    const functions = i & 1 ? [second, first] : [first, second];
    const timings = i & 1 ? [secondTimes, firstTimes] : [firstTimes, secondTimes];
    for (let j = 0; j < 2; j++) {
      globalThis.gc?.();
      const start = performance.now();
      result = functions[j]();
      timings[j].push(performance.now() - start);
    }
  }
  if (!result) throw new Error("benchmark result was empty");
  return [summarize(firstTimes), summarize(secondTimes)];
}

function benchmark(name, fn) {
  console.log(format(name, measure(fn)));
}

function measure(fn) {
  let result;
  for (let i = 0; i < warmups; i++) result = fn();
  const times = [];
  for (let i = 0; i < samples; i++) {
    globalThis.gc?.();
    const start = performance.now();
    result = fn();
    times.push(performance.now() - start);
  }
  if (!result) throw new Error("benchmark result was empty");
  return summarize(times);
}

function summarize(times) {
  times.sort((a, b) => a - b);
  return {
    median: percentile(times, 0.5),
    p10: percentile(times, 0.1),
    p90: percentile(times, 0.9),
  };
}

function uncompressed(png) {
  const chunks = readChunks(png);
  for (const chunk of chunks) {
    if (chunk.type === 0x49444154) chunk.data = inflate(chunk.data);
  }
  return writeChunks(chunks);
}

function clone(value) {
  return value.slice();
}

function percentile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.ceil(index)] * weight;
}

function format(name, result) {
  return `  ${name.padEnd(12)} ${result.median.toFixed(2).padStart(8)} ms median (${result.p10.toFixed(2)}-${result.p90.toFixed(2)} ms p10-p90)`;
}

function createImage(width, height, channels) {
  const result = new Uint8Array(width * height * channels);
  let seed = 0x12345678;
  for (let y = 0, offset = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      result[offset++] = (x + (seed & 31)) & 255;
      result[offset++] = (y + ((seed >>> 5) & 31)) & 255;
      result[offset++] = (x + y + ((seed >>> 10) & 31)) & 255;
      result[offset++] = 255;
    }
  }
  return result;
}
