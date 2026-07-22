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

test("packed filtering matches scalar PNG filters", (t) => {
  for (const channels of [3, 4]) {
    const width = 7;
    const height = 5;
    const backing = new Uint8Array(width * height * channels + 3);
    const data = backing.subarray(3);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 73 + i * i * 19 + 41) & 255;
    }

    const colorType = channels === 4 ? ColorType.RGBA : ColorType.RGB;
    for (const filter of Object.values(FilterMethod)) {
      const actual = encode_IDAT_raw(data, {
        width,
        height,
        colorType,
        filter,
      });
      t.deepEqual(
        actual,
        filterScalar(data, width, height, channels, filter),
        `${channels}-channel filter ${filter}`
      );
    }
  }
  t.end();
});

test("decode round trips encoder output", async (t) => {
  for (let i = 0; i < pngs.length; i++) {
    const input = pngs[i];
    const colorType = input.channels === 4 ? ColorType.RGBA : ColorType.RGB;
    for (const filter of Object.values(FilterMethod)) {
      const encoded = encode({ ...input, colorType, filter }, deflate);
      const decoded = decode(encoded, inflate, { preserveFormat: true });
      t.equal(decoded.width, input.width);
      t.equal(decoded.height, input.height);
      t.equal(decoded.depth, input.depth);
      t.equal(decoded.colorType, colorType);
      t.equal(decoded.channels, input.channels);
      t.deepEqual(decoded.data, input.data, `img ${i} filter ${filter}`);

      const rgba = decode(encoded, inflate);
      t.equal(rgba.channels, 4);
      t.equal(rgba.colorType, ColorType.RGBA);
      t.equal(rgba.depth, input.depth);
      t.equal(rgba.sourceColorType, colorType);
      t.equal(rgba.sourceDepth, input.depth);
      t.deepEqual(
        rgba.data,
        toRGBA(input.data, input.channels, input.depth),
        `img ${i} filter ${filter} RGBA`
      );
    }
  }
});

test("normalized decode output can be re-encoded", async (t) => {
  for (const input of pngs) {
    const colorType = input.channels === 4 ? ColorType.RGBA : ColorType.RGB;
    const decoded = decode(encode({ ...input, colorType }, deflate), inflate);
    const roundTrip = decode(encode(decoded, deflate), inflate);
    t.equal(roundTrip.colorType, ColorType.RGBA);
    t.equal(roundTrip.channels, 4);
    t.deepEqual(roundTrip.data, decoded.data);
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
  t.deepEqual(
    decode(writeChunks(split), inflate, { preserveFormat: true }).data,
    input.data
  );
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
    t.equal(decoded.colorType, ColorType.RGBA);
    t.equal(decoded.depth, 8);
    t.equal(decoded.sourceColorType, ColorType.INDEXED);
    t.equal(decoded.sourceDepth, depth);
    t.equal(decoded.channels, 4);
    t.deepEqual(decoded.data, expected, `${depth}-bit indexed data`);

    const options = { preserveFormat: true, customInflateOption: depth };
    let receivedOptions;
    const preserved = decode(
      encoded,
      (data, inflateOptions) => {
        receivedOptions = inflateOptions;
        return inflate(data);
      },
      options
    );
    const expectedPalette = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      expectedPalette.set(palette.subarray(i * 3, i * 3 + 3), i * 4);
      expectedPalette[i * 4 + 3] = transparency[i];
    }
    t.equal(preserved.colorType, ColorType.INDEXED);
    t.equal(preserved.depth, depth);
    t.equal(preserved.channels, 1);
    t.deepEqual(preserved.data, indices, `${depth}-bit preserved indices`);
    t.deepEqual(preserved.palette, expectedPalette, `${depth}-bit RGBA palette`);
    t.deepEqual(receivedOptions, { customInflateOption: depth });
    t.deepEqual(options, {
      preserveFormat: true,
      customInflateOption: depth,
    });

    const reencoded = encode(preserved, deflate);
    const roundTrip = decode(reencoded, inflate, { preserveFormat: true });
    t.equal(readIHDR(reencoded).depth, depth);
    t.deepEqual(roundTrip.data, indices, `${depth}-bit re-encoded indices`);
    t.deepEqual(
      roundTrip.palette,
      expectedPalette,
      `${depth}-bit re-encoded palette`
    );
    t.deepEqual(decode(reencoded, inflate).data, expected);
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
  t.equal(opaque.channels, 4);
  t.deepEqual(
    opaque.data,
    new Uint8Array([0, 255, 0, 255, 255, 0, 0, 255])
  );

  const preservedOpaque = decode(
    encodeIndexed({
      width: 2,
      height: 1,
      depth: 1,
      indices: new Uint8Array([1, 0]),
      palette: palette.subarray(0, 6),
    }),
    inflate,
    { preserveFormat: true }
  );
  t.equal(preservedOpaque.channels, 1);
  t.deepEqual(preservedOpaque.data, new Uint8Array([1, 0]));
  t.deepEqual(
    preservedOpaque.palette,
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
  );
});

test("encode indexed PNG input", async (t) => {
  const palette = new Uint8Array([
    255, 0, 0, 128,
    0, 255, 0, 255,
    0, 0, 255, 255,
  ]);
  const data = new Uint8Array([0, 1, 2, 1, 2, 0]);
  const encoded = encode({ width: 3, height: 2, data, palette }, deflate);
  const meta = readIHDR(encoded);
  t.equal(meta.colorType, ColorType.INDEXED);
  t.equal(meta.depth, 2, "infers the smallest palette depth");

  const chunks = readChunks(encoded);
  t.deepEqual(
    chunks.find((chunk) => chunk.type === ChunkType.PLTE).data,
    new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255])
  );
  t.deepEqual(
    chunks.find((chunk) => chunk.type === ChunkType.tRNS).data,
    new Uint8Array([128]),
    "trims trailing opaque alpha entries"
  );

  const decoded = decode(encoded, inflate, { preserveFormat: true });
  t.deepEqual(decoded.data, data);
  t.deepEqual(decoded.palette, palette);

  for (const filter of Object.values(FilterMethod)) {
    const filtered = encode(
      {
        width: 3,
        height: 2,
        depth: 4,
        colorType: ColorType.INDEXED,
        data,
        palette,
        filter,
      },
      deflate
    );
    t.deepEqual(
      decode(filtered, inflate, { preserveFormat: true }).data,
      data,
      `indexed filter ${filter}`
    );
  }

  const opaque = encode(
    {
      width: 1,
      height: 1,
      data: new Uint8Array([0]),
      palette: new Uint8Array([10, 20, 30, 255]),
    },
    deflate
  );
  t.notOk(
    readChunks(opaque).some((chunk) => chunk.type === ChunkType.tRNS),
    "omits tRNS for opaque palettes"
  );
});

test("encode validates indexed input", async (t) => {
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  const base = {
    width: 1,
    height: 1,
    colorType: ColorType.INDEXED,
    data: new Uint8Array([0]),
    palette,
  };
  t.throws(() => encode({ ...base, palette: undefined }, deflate), /palette/);
  t.throws(
    () => encode({ ...base, palette: new Uint8Array(3) }, deflate),
    /RGBA/
  );
  t.throws(
    () => encode({ ...base, data: new Uint8Array([2]) }, deflate),
    /palette index 2/
  );
  t.throws(() => encode({ ...base, depth: 3 }, deflate), /depth/);
  t.throws(
    () => encode({ ...base, depth: 1, palette: new Uint8Array(12) }, deflate),
    /too many entries/
  );
});

test("encode grayscale depths and filters", async (t) => {
  const width = 5;
  const height = 2;
  for (const depth of [1, 2, 4, 8, 16]) {
    const max = depth === 16 ? 0xffff : (1 << depth) - 1;
    const data =
      depth === 16
        ? new Uint16Array(width * height)
        : new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = (i * 3) % (max + 1);

    for (const filter of Object.values(FilterMethod)) {
      const encoded = encode(
        {
          width,
          height,
          depth,
          colorType: ColorType.GRAYSCALE,
          data,
          filter,
        },
        deflate
      );
      const preserved = decode(encoded, inflate, { preserveFormat: true });
      t.equal(preserved.colorType, ColorType.GRAYSCALE);
      t.equal(preserved.depth, depth);
      t.equal(preserved.channels, 1);
      t.deepEqual(preserved.data, data, `gray ${depth}-bit filter ${filter}`);
      t.deepEqual(
        decode(encoded, inflate).data,
        grayscaleToRGBA(data, depth),
        `gray ${depth}-bit filter ${filter} RGBA`
      );
    }

    const preserved = decode(
      encode(
        { width, height, depth, colorType: ColorType.GRAYSCALE, data },
        deflate
      ),
      inflate,
      { preserveFormat: true }
    );
    t.deepEqual(
      decode(encode(preserved, deflate), inflate, { preserveFormat: true }).data,
      data,
      `gray ${depth}-bit re-encode`
    );
  }
});

test("encode grayscale-alpha depths and filters", async (t) => {
  const width = 3;
  const height = 2;
  for (const depth of [8, 16]) {
    const max = depth === 16 ? 0xffff : 0xff;
    const data =
      depth === 16
        ? new Uint16Array(width * height * 2)
        : new Uint8Array(width * height * 2);
    for (let i = 0; i < data.length; i += 2) {
      data[i] = (i * 29) % (max + 1);
      data[i + 1] = max - data[i];
    }

    for (const filter of Object.values(FilterMethod)) {
      const encoded = encode(
        {
          width,
          height,
          depth,
          colorType: ColorType.GRAYSCALE_ALPHA,
          data,
          filter,
        },
        deflate
      );
      const preserved = decode(encoded, inflate, { preserveFormat: true });
      t.equal(preserved.colorType, ColorType.GRAYSCALE_ALPHA);
      t.equal(preserved.depth, depth);
      t.equal(preserved.channels, 2);
      t.deepEqual(
        preserved.data,
        data,
        `gray alpha ${depth}-bit filter ${filter}`
      );
      t.deepEqual(
        decode(encoded, inflate).data,
        grayscaleAlphaToRGBA(data, depth),
        `gray alpha ${depth}-bit filter ${filter} RGBA`
      );
    }
  }
});

test("encode grayscale transparentColor", async (t) => {
  const encoded = encode(
    {
      width: 2,
      height: 1,
      depth: 4,
      colorType: ColorType.GRAYSCALE,
      data: new Uint8Array([2, 15]),
      transparentColor: new Uint16Array([2]),
    },
    deflate
  );
  t.deepEqual(
    readChunks(encoded).find((chunk) => chunk.type === ChunkType.tRNS).data,
    new Uint8Array([0, 2])
  );
  t.deepEqual(
    decode(encoded, inflate).data,
    new Uint8Array([34, 34, 34, 0, 255, 255, 255, 255])
  );
  const preserved = decode(encoded, inflate, { preserveFormat: true });
  t.deepEqual(preserved.transparentColor, new Uint16Array([2]));
  t.deepEqual(
    decode(encode(preserved, deflate), inflate, { preserveFormat: true })
      .transparentColor,
    new Uint16Array([2])
  );
});

test("encode validates grayscale input", async (t) => {
  const base = {
    width: 1,
    height: 1,
    colorType: ColorType.GRAYSCALE,
    data: new Uint8Array([0]),
  };
  t.throws(() => encode({ ...base, depth: 2, data: new Uint8Array([4]) }, deflate), /exceeds/);
  t.throws(
    () =>
      encode(
        {
          ...base,
          depth: 4,
          colorType: ColorType.GRAYSCALE_ALPHA,
          data: new Uint8Array([0, 0]),
        },
        deflate
      ),
    /unsupported depth/
  );
  t.throws(() => encode({ ...base, data: new Uint8Array(0) }, deflate), /pixel data/);
});

test("decode grayscale color types", async (t) => {
  t.equal(ColorType.GRAYSCALE, 0, "grayscale uses the PNG color type code");

  const grayscale1PNG = encodeRawPNG({
    width: 4,
    height: 1,
    depth: 1,
    colorType: ColorType.GRAYSCALE,
    raw: new Uint8Array([0, 0b01010000]),
  });
  const grayscale1 = decode(
    grayscale1PNG,
    inflate,
    { preserveFormat: true }
  );
  t.equal(grayscale1.channels, 1);
  t.equal(grayscale1.depth, 1);
  t.equal(grayscale1.colorType, ColorType.GRAYSCALE);
  t.deepEqual(grayscale1.data, new Uint8Array([0, 1, 0, 1]));
  t.deepEqual(
    decode(grayscale1PNG, inflate).data,
    new Uint8Array([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ])
  );

  const grayscale16 = decode(
    encodeRawPNG({
      width: 2,
      height: 1,
      depth: 16,
      colorType: ColorType.GRAYSCALE,
      raw: new Uint8Array([0, 0x12, 0x34, 0xab, 0xcd]),
    }),
    inflate,
    { preserveFormat: true }
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
    inflate,
    { preserveFormat: true }
  );
  t.equal(grayscaleAlpha.channels, 2);
  t.deepEqual(grayscaleAlpha.data, new Uint8Array([20, 255, 100, 80]));
  t.deepEqual(
    decode(
      encodeRawPNG({
        width: 2,
        height: 1,
        depth: 8,
        colorType: ColorType.GRAYSCALE_ALPHA,
        raw: new Uint8Array([0, 20, 255, 100, 80]),
      }),
      inflate
    ).data,
    new Uint8Array([20, 20, 20, 255, 100, 100, 100, 80])
  );
});

test("decode expands tRNS transparency to RGBA", async (t) => {
  const rgbPNG = encodeRawPNG({
    width: 2,
    height: 1,
    depth: 8,
    colorType: ColorType.RGB,
    raw: new Uint8Array([0, 10, 20, 30, 40, 50, 60]),
    transparency: new Uint8Array([0, 10, 0, 20, 0, 30]),
  });
  const rgb = decode(rgbPNG, inflate);
  t.deepEqual(
    rgb.data,
    new Uint8Array([10, 20, 30, 0, 40, 50, 60, 255])
  );
  const nativeRGB = decode(rgbPNG, inflate, { preserveFormat: true });
  t.equal(nativeRGB.colorType, ColorType.RGB);
  t.equal(nativeRGB.channels, 3);
  t.deepEqual(nativeRGB.data, new Uint8Array([10, 20, 30, 40, 50, 60]));
  t.deepEqual(nativeRGB.transparentColor, new Uint16Array([10, 20, 30]));

  const reencoded = encode(nativeRGB, deflate);
  t.deepEqual(
    readChunks(reencoded).find((chunk) => chunk.type === ChunkType.tRNS).data,
    new Uint8Array([0, 10, 0, 20, 0, 30])
  );
  t.deepEqual(
    decode(reencoded, inflate, { preserveFormat: true }).transparentColor,
    nativeRGB.transparentColor
  );

  const grayscale = decode(
    encodeRawPNG({
      width: 2,
      height: 1,
      depth: 4,
      colorType: ColorType.GRAYSCALE,
      raw: new Uint8Array([0, 0x2f]),
      transparency: new Uint8Array([0, 2]),
    }),
    inflate
  );
  t.deepEqual(
    grayscale.data,
    new Uint8Array([34, 34, 34, 0, 255, 255, 255, 255])
  );
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

function filterScalar(data, width, height, channels, filter) {
  const rowBytes = width * channels;
  const stride = rowBytes + 1;
  const result = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const source = y * rowBytes;
    const target = y * stride;
    result[target] = filter;
    for (let x = 0; x < rowBytes; x++) {
      const value = data[source + x];
      const left = x < channels ? 0 : data[source + x - channels];
      const up = y === 0 ? 0 : data[source + x - rowBytes];
      const upperLeft =
        y === 0 || x < channels
          ? 0
          : data[source + x - rowBytes - channels];
      let predictor = 0;
      if (filter === FilterMethod.Sub) predictor = left;
      else if (filter === FilterMethod.Up) predictor = up;
      else if (filter === FilterMethod.Average) predictor = (left + up) >> 1;
      else if (filter === FilterMethod.Paeth) {
        const estimate = left + up - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        predictor =
          leftDistance <= upDistance && leftDistance <= upperLeftDistance
            ? left
            : upDistance <= upperLeftDistance
              ? up
              : upperLeft;
      }
      result[target + x + 1] = value - predictor;
    }
  }
  return result;
}

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

function encodeRawPNG({
  width,
  height,
  depth,
  colorType,
  raw,
  transparency,
}) {
  return writeChunks([
    {
      type: ChunkType.IHDR,
      data: encode_IHDR({ width, height, depth, colorType }),
    },
    ...(transparency
      ? [{ type: ChunkType.tRNS, data: transparency }]
      : []),
    { type: ChunkType.IDAT, data: deflate(raw) },
    { type: ChunkType.IEND },
  ]);
}

function toRGBA(data, channels, depth) {
  if (channels === 4) return data;
  const result =
    depth === 16
      ? new Uint16Array((data.length / channels) * 4)
      : new Uint8Array((data.length / channels) * 4);
  const alpha = depth === 16 ? 0xffff : 0xff;
  for (let src = 0, dst = 0; src < data.length; ) {
    result[dst++] = data[src++];
    result[dst++] = data[src++];
    result[dst++] = data[src++];
    result[dst++] = alpha;
  }
  return result;
}

function grayscaleToRGBA(data, depth) {
  const result =
    depth === 16
      ? new Uint16Array(data.length * 4)
      : new Uint8Array(data.length * 4);
  const sourceMax = depth === 16 ? 0xffff : (1 << depth) - 1;
  const outputMax = depth === 16 ? 0xffff : 0xff;
  for (let src = 0, dst = 0; src < data.length; src++) {
    const gray = (data[src] * outputMax) / sourceMax;
    result[dst++] = gray;
    result[dst++] = gray;
    result[dst++] = gray;
    result[dst++] = outputMax;
  }
  return result;
}

function grayscaleAlphaToRGBA(data, depth) {
  const result =
    depth === 16
      ? new Uint16Array((data.length / 2) * 4)
      : new Uint8Array((data.length / 2) * 4);
  for (let src = 0, dst = 0; src < data.length; ) {
    const gray = data[src++];
    result[dst++] = gray;
    result[dst++] = gray;
    result[dst++] = gray;
    result[dst++] = data[src++];
  }
  return result;
}
