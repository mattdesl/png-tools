import crc32 from "./crc32.js";
import { ChunkType, ColorType, PNG_HEADER } from "./constants.js";
import { encode_IHDR, encode_IDAT_raw } from "./chunks.js";

/**
 * @typedef {Object} EncodeOptions
 * @property {Uint8Array} data the raw pixel data to encode
 * @property {number} width the width of the image
 * @property {number} height the height of the image
 * @property {ColorType} [colorType=ColorType.RGBA] the color type of the pixel data
 * @property {number} [depth=8] the bit depth of the image
 * @property {number} [filterMethod=FilterMethod.Paeth] the filter method to use
 * @property {number} [firstFilter=filter] the first scanline filter method to use
 * @property {Uint8Array} [palette] flat RGBA entries for indexed encoding
 * @property {Uint16Array} [transparentColor] RGB samples for a tRNS chunk
 * @property {Chunk[]} [ancillary=[]] additional chunks to include in the PNG
 */

/**
 * Encodes a PNG buffer from the given image and options, using the specified `deflate` algorithm and optional compression options.
 * The deflate function should have the signature `(buf, [deflateOptions]) => Uint8Array`.
 *
 * @param {EncodeOptions} options the encoding options
 * @param {Function} deflate the sync deflate function to use
 * @param {Object} [deflateOptions] optional deflate options passed to the deflate() function
 */
export function encode(options = {}, deflate, deflateOptions) {
  const {
    data,
    palette,
    ancillary = [],
    colorType = palette ? ColorType.INDEXED : ColorType.RGBA,
  } = options;
  if (!data) throw new Error(`must specify { data }`);
  if (!deflate) throw new Error(`must specify a deflate function`);
  if (options.interlace) {
    throw new Error("interlaced encoding is not currently supported");
  }
  if (
    colorType !== ColorType.RGB &&
    colorType !== ColorType.RGBA &&
    colorType !== ColorType.INDEXED
  ) {
    throw new Error(
      "only RGB, RGBA, or indexed colorType encoding is currently supported"
    );
  }

  if (colorType === ColorType.INDEXED) {
    return encodeIndexed(
      options,
      data,
      palette,
      ancillary,
      deflate,
      deflateOptions
    );
  }

  return encodeImage(options, data, ancillary, deflate, deflateOptions);
}

function encodeImage(options, data, ancillary, deflate, deflateOptions) {
  let trns;
  if (options.transparentColor) {
    if ((options.colorType ?? ColorType.RGBA) !== ColorType.RGB) {
      throw new Error("transparentColor is only supported for RGB encoding");
    }
    if (ancillary.some((chunk) => chunk.type === ChunkType.tRNS)) {
      throw new Error("tRNS is already specified by transparentColor");
    }
    const color = options.transparentColor;
    const max = (options.depth ?? 8) === 16 ? 0xffff : 0xff;
    if (color.length !== 3) {
      throw new Error("RGB transparentColor must contain three samples");
    }
    trns = new Uint8Array(6);
    const view = new DataView(trns.buffer);
    for (let i = 0; i < 3; i++) {
      if (!Number.isInteger(color[i]) || color[i] < 0 || color[i] > max) {
        throw new Error("transparentColor sample is outside the image depth");
      }
      view.setUint16(i * 2, color[i]);
    }
  }

  return writeChunks([
    { type: ChunkType.IHDR, data: encode_IHDR(options) },
    ...ancillary,
    ...(trns ? [{ type: ChunkType.tRNS, data: trns }] : []),
    {
      type: ChunkType.IDAT,
      data: deflate(encode_IDAT_raw(data, options), deflateOptions),
    },
    { type: ChunkType.IEND },
  ]);
}

function encodeIndexed(
  options,
  data,
  palette,
  ancillary,
  deflate,
  deflateOptions
) {
  if (!palette || palette.BYTES_PER_ELEMENT !== 1 || palette.length % 4 !== 0) {
    throw new Error("indexed encoding requires a flat RGBA Uint8 palette");
  }

  const entries = palette.length / 4;
  if (entries < 1 || entries > 256) {
    throw new Error("indexed palette must contain between 1 and 256 entries");
  }

  const width = options.width;
  const height = options.height;
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1
  ) {
    throw new Error("indexed encoding requires positive integer width and height");
  }
  if (data.BYTES_PER_ELEMENT !== 1 || data.length !== width * height) {
    throw new Error("indexed data must contain one Uint8 index per pixel");
  }

  const depth = options.depth ?? paletteDepth(entries);
  if (depth !== 1 && depth !== 2 && depth !== 4 && depth !== 8) {
    throw new Error("indexed depth must be 1, 2, 4, or 8");
  }
  if (entries > (1 << depth)) {
    throw new Error(`indexed palette has too many entries for depth ${depth}`);
  }
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= entries) {
      throw new Error(`indexed data contains missing palette index ${data[i]}`);
    }
  }

  const imageOptions = {
    ...options,
    colorType: ColorType.INDEXED,
    depth,
  };
  const { plte, trns } = encodePalette(palette);
  const beforePalette = [];
  const afterPalette = [];
  for (const chunk of ancillary) {
    if (chunk.type === ChunkType.PLTE || chunk.type === ChunkType.tRNS) {
      throw new Error("PLTE and tRNS chunks are generated from the RGBA palette");
    }
    (mustPrecedePalette(chunk.type) ? beforePalette : afterPalette).push(chunk);
  }

  const raw = encodeIndexedRaw(data, imageOptions);
  return writeChunks([
    { type: ChunkType.IHDR, data: encode_IHDR(imageOptions) },
    ...beforePalette,
    { type: ChunkType.PLTE, data: plte },
    ...(trns ? [{ type: ChunkType.tRNS, data: trns }] : []),
    ...afterPalette,
    { type: ChunkType.IDAT, data: deflate(raw, deflateOptions) },
    { type: ChunkType.IEND },
  ]);
}

function paletteDepth(entries) {
  if (entries <= 2) return 1;
  if (entries <= 4) return 2;
  if (entries <= 16) return 4;
  return 8;
}

function encodePalette(palette) {
  const entries = palette.length / 4;
  const plte = new Uint8Array(entries * 3);
  let lastTransparent = -1;
  for (let src = 0, dst = 0, index = 0; index < entries; index++) {
    plte[dst++] = palette[src++];
    plte[dst++] = palette[src++];
    plte[dst++] = palette[src++];
    if (palette[src++] !== 255) lastTransparent = index;
  }

  let trns;
  if (lastTransparent >= 0) {
    trns = new Uint8Array(lastTransparent + 1);
    for (let i = 0; i <= lastTransparent; i++) trns[i] = palette[i * 4 + 3];
  }
  return { plte, trns };
}

function encodeIndexedRaw(data, options) {
  const { width, height, depth } = options;
  if (depth === 8) return encode_IDAT_raw(data, options);

  const rowBytes = Math.ceil((width * depth) / 8);
  const packed = new Uint8Array(rowBytes * height);
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      packed[row + (bit >> 3)] |=
        (data[y * width + x] & mask) << (8 - depth - (bit & 7));
    }
  }

  return encode_IDAT_raw(packed, {
    ...options,
    width: rowBytes,
    depth: 8,
    colorType: ColorType.GRAYSCALE,
  });
}

function mustPrecedePalette(type) {
  return (
    type === ChunkType.cHRM ||
    type === ChunkType.gAMA ||
    type === ChunkType.iCCP ||
    type === ChunkType.sBIT ||
    type === ChunkType.sRGB
  );
}

/**
 * Encodes just the raw PNG header into a Uint8Array buffer.
 * @returns {Uint8Array} the PNG header
 */
export function encodeHeader() {
  return PNG_HEADER.slice();
}

/**
 * Encodes a single PNG chunk into a Uint8Array buffer, by writing the chunk length, type, data, and CRC value.
 * @param {Chunk} chunk the chunk to encode
 * @returns {Uint8Array} the encoded chunk buffer
 */
export function encodeChunk(chunk) {
  const length = chunk.data ? chunk.data.length : 0;
  const output = new Uint8Array(4 + length + 4 + 4);
  const dv = new DataView(output.buffer, output.byteOffset, output.byteLength);
  // Write chunk length
  let idx = 0;
  encodeChunkRaw(output, dv, chunk, idx);
  return output;
}

/**
 * Writes and formats an array of PNG chunks into a complete PNG buffer, including the PNG header.
 *
 * @param {Chunk[]} chunks the array of chunks to encode
 * @returns {Uint8Array} the encoded PNG buffer
 */
export function writeChunks(chunks) {
  let totalSize = PNG_HEADER.length; // start with header
  let idx = totalSize;
  for (let chunk of chunks) {
    totalSize += chunk.data ? chunk.data.length : 0;
    totalSize += 12; // length, code, CRC value (4 bytes each)
  }

  const output = new Uint8Array(totalSize);
  const dv = new DataView(output.buffer);

  // write header
  output.set(PNG_HEADER, 0);

  for (let chunk of chunks) {
    idx = encodeChunkRaw(output, dv, chunk, idx);
  }

  return output;
}

function encodeChunkRaw(output, dv, chunk, idx = 0) {
  // Write chunk length
  const length = chunk.data ? chunk.data.length : 0;
  dv.setUint32(idx, length);
  idx += 4;

  // Where the chunk index starts (before type code)
  const chunkStartIdx = idx;
  const chunkDataStartIdx = idx + 4;
  const chunkDataEndIdx = chunkDataStartIdx + length;

  // Write chunk type code
  const type = chunk.type;
  dv.setUint32(chunkStartIdx, type);

  // Write chunk data
  if (chunk.data) output.set(chunk.data, chunkDataStartIdx);

  // get the whole chunk buffer including type
  const chunkBuf = output.subarray(chunkStartIdx, chunkDataEndIdx);

  // compute CRC and write it
  const crcValue = crc32(chunkBuf);
  dv.setInt32(chunkDataEndIdx, crcValue);

  // return next index for reading
  return chunkDataEndIdx + 4;
}
