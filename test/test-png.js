import test from "tape";
import {
  encode_iCCP,
  decode_iCCP,
  encode_iTXt,
  decode_iTXt,
  encode_IHDR,
  decode_IHDR,
  colorTypeToChannels,
} from "../src/util.js";
import getDimensions from "canvas-dimensions";
import fs from "fs/promises";
import { inflate, deflate } from "pako";
import { pngs } from "./png-fixtures.js";
import * as FastPNG from "fast-png";
import {
  encode,
  encodeChunks,
  decodeChunks,
  chunkNameToType,
  matchesChunkType,
  ChunkType,
  readPNGMetadata,
  ColorType,
} from "../src/png-io.js";

test("encoder matches", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const colorType = pngs[i].channels === 4 ? ColorType.RGBA : ColorType.RGB;
    const input = pngs[i];
    const enc0 = FastPNG.encode(input);
    const enc1 = encode({
      ...input,
      colorType,
      deflate: (d) => deflate(d, { level: 3 }),
    });
    const c0 = decodeChunks(enc0).find((f) =>
      matchesChunkType(f.type, ChunkType.IDAT)
    );
    const c1 = decodeChunks(enc1).find((f) =>
      matchesChunkType(f.type, ChunkType.IDAT)
    );

    const eq = Buffer.from(inflate(c0.data)).equals(
      Buffer.from(inflate(c1.data))
    );
    t.ok(eq, "buffer equals idx " + i);
    // if (i) {
    // console.log("i 4");
    // console.log(inflate(c0.data));
    // console.log(inflate(c1.data));
    // }
    // if (i == 4) console.log(inflate(c0.data));
    // console.log("idx", i);
    // console.log(inflate(c0.data), inflate(c1.data));
    // console.log(enc0, enc1);
    // t.ok(Buffer.from(enc0).equals(Buffer.from(enc1)), "buffers equal idx " + i);
  }
});

test("comparison png decoder works", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const buf = await fs.readFile(`test/fixtures/png/generated-${i}.png`);
    const data = FastPNG.decode(buf);
    t.deepEqual(data, { ...pngs[i], text: {} });
  }
});

test("our png decoder works", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const buf = await fs.readFile(`test/fixtures/png/generated-${i}.png`);
    const chunks = decodeChunks(buf);
    const data = encodeChunks(chunks);
    t.ok(Buffer.from(buf).equals(Buffer.from(data)), "buffers equal");

    chunks[0].type = chunkNameToType("IHDR");
    const data2 = encodeChunks(chunks);
    t.ok(
      Buffer.from(buf).equals(Buffer.from(data2)),
      "accepts uint32 decimal types instead of string names"
    );
  }

  for (let i = 0; i < pngs.length; i++) {
    const png = pngs[i];
    const buf = await fs.readFile(`test/fixtures/png/generated-${i}.png`);
    const meta = readPNGMetadata(buf);
    t.equals(meta.width, png.width);
    t.equals(meta.height, png.height);
    t.equals(meta.depth, png.depth);
    t.equals(meta.colorType, png.channels === 3 ? 2 : 6);
  }

  const inputBuf = await fs.readFile(`test/fixtures/png/generated-0.png`);
  const inputLargerBuf = new Uint8Array(inputBuf.length + 8);
  inputLargerBuf.set(inputBuf, 4);
  const subBuf = inputLargerBuf.subarray(4, 4 + inputBuf.length);
  t.deepEqual(
    readPNGMetadata(subBuf),
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
  t.ok(matchesChunkType(0x49484452, ChunkType.IHDR));
  t.ok(matchesChunkType(0x49484452, 0x49484452));
  t.ok(matchesChunkType(0x49484452, "IHDR"));
  t.ok(matchesChunkType("IHDR", "IHDR"));
  t.ok(matchesChunkType("IHDR", 0x49484452));
  t.ok(!matchesChunkType("IDHR", 0x49484452));
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
