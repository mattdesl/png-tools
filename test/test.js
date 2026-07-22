import test from "tape";
import fs from "fs/promises";
import { inflate, deflate } from "pako";
import { pngs } from "./png-fixtures.js";
import * as FastPNG from "fast-png";

import {
  // Utils
  crc32,
  flattenBuffers,
  colorTypeToChannels,

  // Constants
  ChunkType,
  ColorType,
  FilterMethod,
  Intent,

  // Encoding
  encode,
  encodeHeader,
  encodeChunk,
  writeChunks,

  // Decoding
  decode,
  readChunks,
  readIHDR,
  reader,

  // Chunk utils
  encode_IDAT_raw,
  encode_pHYs,
  encode_pHYs_PPI,
  encode_sRGB,
  encode_standardChromatics,
  encode_standardGamma,
  encode_iTXt,
  encode_IHDR,
  encode_iCCP,
  decode_iCCP,
  decode_iTXt,
  decode_IHDR,
  chunkNameToType,
  chunkTypeToName,
} from "../index.js";

test("crc32", async (t) => {
  const buf = new Uint8Array(32);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = i ** 2 % 256;
  }
  const r = crc32(buf);
  t.equal(r, 1934867379);
});

test("profile data", async (t) => {
  const enc = encode_iCCP({
    name: "Some Profile",
    data: new Uint8Array([4, 3, 1, 2]),
  });
  const data = decode_iCCP(enc);
  t.equals(data.name, "Some Profile");
  t.equals(data.compression, 0);
  t.deepEquals(data.data, new Uint8Array([4, 3, 1, 2]));

  const long =
    "Some Profile With a Really Long Name This is Long Again Some Profile With a Really Long Name This is Long";
  const enc2 = encode_iCCP({ name: long, data: new Uint8Array([4, 3, 1, 2]) });
  const data2 = decode_iCCP(enc2);
  t.equals(data2.name.length, 79);
  t.deepEquals(data2.compression, 0);
  t.deepEquals(data2.data, new Uint8Array([4, 3, 1, 2]));
});

test("iTXt data", async (t) => {
  const enc = encode_iTXt({
    keyword: "metadata",
    compressionFlag: 0,
    compressionMethod: 0,
    languageTag: "en",
    translatedKeyword: "test",
    text: "hello world",
  });
  const data = decode_iTXt(enc);
  t.deepEquals(data, {
    keyword: "metadata",
    compressionFlag: 0,
    compressionMethod: 0,
    languageTag: "en",
    translatedKeyword: "test",
    text: "hello world",
  });
});

test("iTXt data", async (t) => {
  const enc = encode_IHDR({
    width: 256,
    height: 121,
    depth: 16,
    colorType: ColorType.GRAYSCALE,
    interlace: 1,
  });
  const data = decode_IHDR(enc);
  t.deepEquals(data, {
    width: 256,
    height: 121,
    depth: 16,
    colorType: ColorType.GRAYSCALE,
    compression: 0,
    filter: 0,
    interlace: 1,
  });
});

test("encoder matches", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const colorType = pngs[i].channels === 4 ? ColorType.RGBA : ColorType.RGB;
    const input = pngs[i];
    const enc0 = FastPNG.encode(input);
    const enc1 = encode(
      {
        ...input,
        filter: FilterMethod.None,
        colorType,
      },
      deflate,
      { level: 3 }
    );
    const c0 = readChunks(enc0).find((f) => f.type === ChunkType.IDAT);
    const c1 = readChunks(enc1).find((f) => f.type === ChunkType.IDAT);

    const eq = Buffer.from(inflate(c0.data)).equals(
      Buffer.from(inflate(c1.data))
    );
    t.ok(eq, "buffer equals idx " + i);
  }
});

test("test png encoder filtering", async (t) => {
  const arr = pngs;
  for (let i = 0; i < arr.length; i++) {
    const colorType = arr[i].channels === 4 ? ColorType.RGBA : ColorType.RGB;
    const input = arr[i];
    const filters = Object.values(FilterMethod);
    for (let f of filters) {
      const enc = encode({ ...input, colorType, filter: f }, deflate, {
        level: 3,
      });
      const { data } = FastPNG.decode(enc);
      t.deepEqual(input.data, data, `img ${i} filter ${f}`);
    }
  }
});

test("decode round trips encoder output", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const input = pngs[i];
    const colorType = input.channels === 4 ? ColorType.RGBA : ColorType.RGB;
    for (const filter of Object.values(FilterMethod)) {
      const encoded = encode({ ...input, colorType, filter }, deflate);
      const decoded = decode(encoded, inflate);
      t.equal(decoded.width, input.width);
      t.equal(decoded.height, input.height);
      t.equal(decoded.depth, input.depth);
      t.equal(decoded.colorType, colorType);
      t.equal(decoded.channels, input.channels);
      t.deepEqual(decoded.data, input.data, `img ${i} filter ${filter}`);
    }
  }
});

test("decode concatenates multiple IDAT chunks", async (t) => {
  const input = pngs[0];
  const encoded = encode(
    { ...input, colorType: ColorType.RGB },
    deflate
  );
  const chunks = readChunks(encoded);
  const idat = chunks.find((chunk) => chunk.type === ChunkType.IDAT);
  const middle = idat.data.length >> 1;
  const split = chunks.flatMap((chunk) =>
    chunk === idat
      ? [
          { type: ChunkType.IDAT, data: chunk.data.slice(0, middle) },
          { type: ChunkType.IDAT, data: chunk.data.slice(middle) },
        ]
      : chunk
  );
  t.deepEqual(decode(writeChunks(split), inflate).data, input.data);
});

test("decode indexed PNG depths and transparency", async (t) => {
  const palette = new Uint8Array([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 255,
  ]);
  const transparency = new Uint8Array([255, 160, 80, 0]);

  for (const depth of [1, 2, 4, 8]) {
    const count = 1 << Math.min(depth, 2);
    const indices = new Uint8Array([0, 1, count - 1, 0, 1, 1, 0, count - 1]);
    const encoded = encodeIndexed({
      width: 4,
      height: 2,
      depth,
      indices,
      palette: palette.subarray(0, count * 3),
      transparency: transparency.subarray(0, count),
    });
    const decoded = decode(encoded, inflate);
    const expected = new Uint8Array(indices.length * 4);
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      expected.set(palette.subarray(index * 3, index * 3 + 3), i * 4);
      expected[i * 4 + 3] = transparency[index];
    }
    t.equal(decoded.colorType, ColorType.INDEXED);
    t.equal(decoded.depth, depth);
    t.equal(decoded.channels, 4);
    t.deepEqual(decoded.data, expected, `${depth}-bit indexed data`);
  }

  const opaque = decode(
    encodeIndexed({
      width: 2,
      height: 1,
      depth: 1,
      indices: new Uint8Array([1, 0]),
      palette: palette.subarray(0, 6),
    }),
    inflate
  );
  t.equal(opaque.channels, 3);
  t.deepEqual(opaque.data, new Uint8Array([0, 255, 0, 255, 0, 0]));
});

test("decode grayscale color types", async (t) => {
  t.equal(ColorType.GRAYSCALE, 0, "grayscale uses the PNG color type code");

  const grayscale1 = decode(
    encodeRawPNG({
      width: 4,
      height: 1,
      depth: 1,
      colorType: ColorType.GRAYSCALE,
      raw: new Uint8Array([0, 0b01010000]),
    }),
    inflate
  );
  t.equal(grayscale1.channels, 1);
  t.deepEqual(grayscale1.data, new Uint8Array([0, 255, 0, 255]));

  const grayscale16 = decode(
    encodeRawPNG({
      width: 2,
      height: 1,
      depth: 16,
      colorType: ColorType.GRAYSCALE,
      raw: new Uint8Array([0, 0x12, 0x34, 0xab, 0xcd]),
    }),
    inflate
  );
  t.deepEqual(grayscale16.data, new Uint16Array([0x1234, 0xabcd]));

  const grayscaleAlpha = decode(
    encodeRawPNG({
      width: 2,
      height: 1,
      depth: 8,
      colorType: ColorType.GRAYSCALE_ALPHA,
      raw: new Uint8Array([0, 20, 255, 100, 80]),
    }),
    inflate
  );
  t.equal(grayscaleAlpha.channels, 2);
  t.deepEqual(grayscaleAlpha.data, new Uint8Array([20, 255, 100, 80]));
});

test("decode validates pixel stream", async (t) => {
  const png = writeChunks([
    {
      type: ChunkType.IHDR,
      data: encode_IHDR({
        width: 1,
        height: 1,
        depth: 8,
        colorType: ColorType.RGB,
      }),
    },
    { type: ChunkType.IDAT, data: deflate(new Uint8Array([5, 0, 0, 0])) },
    { type: ChunkType.IEND },
  ]);
  t.throws(() => decode(png, inflate), /filter type 5/);
  t.throws(() => decode(png), /inflate function/);
  t.throws(
    () =>
      encode(
        {
          data: new Uint8Array([0, 0, 0]),
          width: 1,
          height: 1,
          colorType: ColorType.RGB,
          interlace: 1,
        },
        deflate
      ),
    /interlaced encoding/
  );
});

test("comparison png decoder works", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const buf = await fs.readFile(`test/encoded/generated-${i}.png`);
    const data = FastPNG.decode(buf);
    t.deepEqual(data, { ...pngs[i], text: {} });
  }
});

test("our png decoder works", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const buf = await fs.readFile(`test/encoded/generated-${i}.png`);
    const chunks = readChunks(buf);
    const data = writeChunks(chunks);
    t.ok(Buffer.from(buf).equals(Buffer.from(data)), "buffers equal");
  }

  for (let i = 0; i < pngs.length; i++) {
    const png = pngs[i];
    const buf = await fs.readFile(`test/encoded/generated-${i}.png`);
    const meta = readIHDR(buf);
    t.equals(meta.width, png.width);
    t.equals(meta.height, png.height);
    t.equals(meta.depth, png.depth);
    t.equals(meta.colorType, png.channels === 3 ? 2 : 6);
  }

  const inputBuf = await fs.readFile(`test/encoded/generated-0.png`);
  const inputLargerBuf = new Uint8Array(inputBuf.length + 8);
  inputLargerBuf.set(inputBuf, 4);
  const subBuf = inputLargerBuf.subarray(4, 4 + inputBuf.length);
  t.deepEqual(
    readIHDR(subBuf),
    {
      width: 2,
      height: 2,
      depth: 8,
      colorType: 2,
      compression: 0,
      filter: 0,
      interlace: 0,
    },
    "subarray should work"
  );

  t.equals(0x49484452, ChunkType.IHDR);
  t.equals(chunkNameToType("IHDR"), ChunkType.IHDR);
  t.equals(chunkTypeToName(ChunkType.IHDR), "IHDR");
});

test("encode and decode fields", async (t) => {
  t.deepEqual(
    decode_IHDR(
      encode_IHDR({
        width: 256,
        height: 256,
      })
    ),
    {
      width: 256,
      height: 256,
      depth: 8,
      colorType: 6,
      compression: 0,
      filter: 0,
      interlace: 0,
    }
  );

  t.deepEqual(
    decode_IHDR(
      encode_IHDR({
        width: 128,
        height: 256,
        depth: 16,
        colorType: 2,
        interlace: 1,
      })
    ),
    {
      width: 128,
      height: 256,
      depth: 16,
      colorType: 2,
      compression: 0,
      filter: 0,
      interlace: 1,
    }
  );
});

// writes the chunk types in hex
function writeChunkTable() {
  const ChunkTypeNames = [
    // Critical
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    // Ancillary
    "cHRM",
    "gAMA",
    "iCCP",
    "sBIT",
    "sRGB",
    "bKGD",
    "hIST",
    "tRNS",
    "pHYs",
    "sPLT",
    "tIME",
    "iTXt",
    "tEXt",
    "zTXt",
  ];

  for (let name of ChunkTypeNames) {
    console.log(
      `  ${name}: 0x${chunkNameToType(name).toString(16).padStart(2, "0")},`
    );
  }
}

function encodeIndexed({
  width,
  height,
  depth,
  indices,
  palette,
  transparency,
}) {
  const rowBytes = Math.ceil((width * depth) / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1) + 1;
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      raw[row + (bit >> 3)] |=
        (indices[y * width + x] & mask) << (8 - depth - (bit & 7));
    }
  }
  return writeChunks([
    {
      type: ChunkType.IHDR,
      data: encode_IHDR({
        width,
        height,
        depth,
        colorType: ColorType.INDEXED,
      }),
    },
    { type: ChunkType.PLTE, data: palette },
    ...(transparency
      ? [{ type: ChunkType.tRNS, data: transparency }]
      : []),
    { type: ChunkType.IDAT, data: deflate(raw) },
    { type: ChunkType.IEND },
  ]);
}

function encodeRawPNG({ width, height, depth, colorType, raw }) {
  return writeChunks([
    {
      type: ChunkType.IHDR,
      data: encode_IHDR({ width, height, depth, colorType }),
    },
    { type: ChunkType.IDAT, data: deflate(raw) },
    { type: ChunkType.IEND },
  ]);
}
