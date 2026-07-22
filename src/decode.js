import crc32 from "./crc32.js";
import { ChunkType, ColorType, PNG_HEADER } from "./constants.js";
import { chunkTypeToName, decode_IHDR } from "./chunks.js";
import {
  colorTypeToChannels,
  flattenBuffers,
  paethPredictor,
} from "./util.js";

/**
 * @typedef {Object} PNGReaderOptions
 * @property {boolean} [checkCRC=false] whether to check and verify CRC values of each chunk (slower but can detect errors and corruption earlier during parsing)
 * @property {boolean} [copy=true] whether to return a sliced copy of each chunk data instead of a shallow subarray view into the input buffer
 **/

/**
 * @typedef {Object} DecodeResult
 * @property {Uint8Array|Uint16Array} data the decoded pixel data
 * @property {number} width the width of the image
 * @property {number} height the height of the image
 * @property {number} depth the PNG bit depth
 * @property {ColorType} colorType the PNG color type
 * @property {number} channels the number of channels in `data`
 * @property {Uint8Array} [palette] the RGBA palette when preserving indexed data
 **/

/**
 * Decodes a PNG into pixel data, using the specified `inflate` algorithm and
 * optional decompression options. Pixels are expanded to RGBA by default. Set
 * `preserveChannels` to retain the source channel layout, or
 * `preserveIndexed` to return one palette index per pixel and an RGBA palette.
 * The inflate function should have the signature
 * `(buf, [inflateOptions]) => Uint8Array`.
 *
 * @param {ArrayBufferView} buf the PNG buffer to decode
 * @param {Function} inflate the sync inflate function to use
 * @param {Object} [options] optional inflate and decoder options
 * @returns {DecodeResult}
 **/
export function decode(buf, inflate, options) {
  if (!inflate) throw new Error(`must specify an inflate function`);

  const preserveIndexed = options?.preserveIndexed === true;
  const preserveChannels = options?.preserveChannels === true;
  let inflateOptions = options;
  if (
    options &&
    ("preserveIndexed" in options || "preserveChannels" in options)
  ) {
    inflateOptions = { ...options };
    delete inflateOptions.preserveIndexed;
    delete inflateOptions.preserveChannels;
  }

  let meta;
  let palette;
  let transparency;
  let compressed;
  let idats;

  reader(buf, { copy: false }, (type, data) => {
    if (type === ChunkType.IHDR) {
      if (data.length !== 13) throw new Error("Invalid PNG: malformed IHDR");
      meta = decode_IHDR(data);
    } else if (type === ChunkType.PLTE) palette = data;
    else if (type === ChunkType.tRNS) transparency = data;
    else if (type === ChunkType.IDAT) {
      if (!compressed) compressed = data;
      else if (idats) idats.push(data);
      else idats = [compressed, data];
    }
  });

  validateIHDR(meta);
  if (!compressed) throw new Error("Invalid PNG: IDAT missing");

  if (idats) compressed = flattenBuffers(idats);
  const inflated = inflate(compressed, inflateOptions);
  if (!ArrayBuffer.isView(inflated)) {
    throw new Error("Expected inflate() to return a typed array");
  }

  const raw = new Uint8Array(
    inflated.buffer,
    inflated.byteOffset,
    inflated.byteLength
  );
  const { width, height, depth, colorType } = meta;
  const sourceChannels = colorTypeToChannels(colorType);
  const rowBytes = Math.ceil((width * sourceChannels * depth) / 8);
  const expectedLength = (rowBytes + 1) * height;
  if (raw.length !== expectedLength) {
    throw new Error(
      `Invalid PNG: expected ${expectedLength} inflated bytes, got ${raw.length}`
    );
  }

  const bytesPerPixel = Math.max(1, Math.ceil((sourceChannels * depth) / 8));
  unfilter(raw, height, rowBytes, bytesPerPixel);

  const packed = raw.subarray(0, rowBytes * height);
  let data;
  let resultPalette;
  let channels = sourceChannels;

  if (colorType === ColorType.INDEXED) {
    if (!palette || palette.length === 0 || palette.length % 3 !== 0) {
      throw new Error("Invalid indexed PNG: PLTE missing or malformed");
    }
    const entries = palette.length / 3;
    if (entries > (1 << depth)) {
      throw new Error("Invalid indexed PNG: palette exceeds bit depth");
    }
    if (transparency && transparency.length > entries) {
      throw new Error("Invalid indexed PNG: tRNS exceeds palette size");
    }
    if (preserveIndexed) {
      channels = 1;
      data =
        depth === 8
          ? packed
          : unpackSamples(packed, width, height, depth, false);
      resultPalette = createPalette(palette, transparency);
    } else {
      channels = preserveChannels && !transparency ? 3 : 4;
      data = expandPalette(
        packed,
        width,
        height,
        depth,
        palette,
        transparency,
        channels
      );
    }
  } else if (depth < 8) {
    data = unpackSamples(packed, width, height, depth, true);
  } else if (depth === 16) {
    data = unpack16(packed);
  } else {
    data = packed;
  }

  if (
    colorType !== ColorType.INDEXED &&
    !preserveChannels &&
    colorType !== ColorType.RGBA
  ) {
    data = expandToRGBA(data, width, height, depth, colorType, transparency);
    channels = 4;
  }

  const result = { width, height, depth, colorType, channels, data };
  if (resultPalette) result.palette = resultPalette;
  return result;
}

function validateIHDR(meta) {
  if (!meta || meta.width === 0 || meta.height === 0) {
    throw new Error("Invalid PNG: malformed IHDR");
  }
  if (meta.compression !== 0 || meta.filter !== 0) {
    throw new Error("Invalid PNG: unsupported compression or filter method");
  }
  if (meta.interlace !== 0) {
    throw new Error("Interlaced PNGs are not supported");
  }

  const { colorType, depth } = meta;
  const validColorType =
    colorType === ColorType.GRAYSCALE ||
    colorType === ColorType.RGB ||
    colorType === ColorType.INDEXED ||
    colorType === ColorType.GRAYSCALE_ALPHA ||
    colorType === ColorType.RGBA;
  const validDepth =
    depth === 8 ||
    (depth === 16 && colorType !== ColorType.INDEXED) ||
    ((depth === 1 || depth === 2 || depth === 4) &&
      (colorType === ColorType.GRAYSCALE || colorType === ColorType.INDEXED));
  if (!validColorType || !validDepth) {
    throw new Error(
      `Invalid PNG: unsupported color type ${meta.colorType} and depth ${meta.depth}`
    );
  }
}

// Decode each scanline in the inflater's output, then compact the whole image
// in place to discard filter bytes. This avoids another full image buffer.
function unfilter(data, height, rowBytes, bytesPerPixel) {
  const stride = rowBytes + 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const filter = data[row];
    const start = row + 1;
    if (filter > 4) throw new Error(`Invalid PNG filter type ${filter}`);
    if (filter === 0) continue;

    if (filter === 1) {
      for (let x = bytesPerPixel; x < rowBytes; x++) {
        data[start + x] += data[start + x - bytesPerPixel];
      }
    } else if (filter === 2) {
      if (y === 0) continue;
      for (let x = 0; x < rowBytes; x++) {
        data[start + x] += data[start + x - stride];
      }
    } else if (filter === 3) {
      for (let x = 0; x < rowBytes; x++) {
        const i = start + x;
        const left = x < bytesPerPixel ? 0 : data[i - bytesPerPixel];
        const above = y === 0 ? 0 : data[i - stride];
        data[i] += (left + above) >> 1;
      }
    } else {
      for (let x = 0; x < rowBytes; x++) {
        const i = start + x;
        const left = x < bytesPerPixel ? 0 : data[i - bytesPerPixel];
        const above = y === 0 ? 0 : data[i - stride];
        const upperLeft =
          y === 0 || x < bytesPerPixel
            ? 0
            : data[i - stride - bytesPerPixel];
        data[i] += paethPredictor(left, above, upperLeft);
      }
    }
  }

  for (let y = 0; y < height; y++) {
    const start = y * stride + 1;
    data.copyWithin(y * rowBytes, start, start + rowBytes);
  }
}

function unpack16(data) {
  const result = new Uint16Array(data.length / 2);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < result.length; i++) result[i] = view.getUint16(i * 2);
  return result;
}

function unpackSamples(data, width, height, depth, scale) {
  const result = new Uint8Array(width * height);
  const rowBytes = Math.ceil((width * depth) / 8);
  const mask = (1 << depth) - 1;
  const factor = scale ? 255 / mask : 1;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const sample = (data[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask;
      result[dst++] = sample * factor;
    }
  }
  return result;
}

function createPalette(palette, transparency) {
  const result = new Uint8Array((palette.length / 3) * 4);
  for (let src = 0, dst = 0, index = 0; src < palette.length; index++) {
    result[dst++] = palette[src++];
    result[dst++] = palette[src++];
    result[dst++] = palette[src++];
    result[dst++] =
      transparency && index < transparency.length ? transparency[index] : 255;
  }
  return result;
}

function expandToRGBA(data, width, height, depth, colorType, transparency) {
  const result =
    depth === 16
      ? new Uint16Array(width * height * 4)
      : new Uint8Array(width * height * 4);
  const max = depth === 16 ? 0xffff : 0xff;
  let transparentGray;
  let transparentRed;
  let transparentGreen;
  let transparentBlue;

  if (transparency) {
    const view = new DataView(
      transparency.buffer,
      transparency.byteOffset,
      transparency.byteLength
    );
    if (colorType === ColorType.GRAYSCALE) {
      if (transparency.length !== 2) {
        throw new Error("Invalid grayscale PNG: malformed tRNS");
      }
      transparentGray = view.getUint16(0);
      if (depth < 8) transparentGray *= 255 / ((1 << depth) - 1);
    } else if (colorType === ColorType.RGB) {
      if (transparency.length !== 6) {
        throw new Error("Invalid RGB PNG: malformed tRNS");
      }
      transparentRed = view.getUint16(0);
      transparentGreen = view.getUint16(2);
      transparentBlue = view.getUint16(4);
    }
  }

  if (colorType === ColorType.GRAYSCALE) {
    for (let src = 0, dst = 0; src < data.length; src++) {
      const gray = data[src];
      result[dst++] = gray;
      result[dst++] = gray;
      result[dst++] = gray;
      result[dst++] = gray === transparentGray ? 0 : max;
    }
  } else if (colorType === ColorType.GRAYSCALE_ALPHA) {
    for (let src = 0, dst = 0; src < data.length; ) {
      const gray = data[src++];
      result[dst++] = gray;
      result[dst++] = gray;
      result[dst++] = gray;
      result[dst++] = data[src++];
    }
  } else {
    for (let src = 0, dst = 0; src < data.length; ) {
      const red = data[src++];
      const green = data[src++];
      const blue = data[src++];
      result[dst++] = red;
      result[dst++] = green;
      result[dst++] = blue;
      result[dst++] =
        red === transparentRed &&
        green === transparentGreen &&
        blue === transparentBlue
          ? 0
          : max;
    }
  }
  return result;
}

function expandPalette(
  data,
  width,
  height,
  depth,
  palette,
  transparency,
  channels
) {
  const result = new Uint8Array(width * height * channels);
  const rowBytes = Math.ceil((width * depth) / 8);
  const mask = (1 << depth) - 1;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const index =
        (data[y * rowBytes + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask;
      const src = index * 3;
      if (src >= palette.length) {
        throw new Error(`Invalid indexed PNG: palette index ${index} missing`);
      }
      result[dst++] = palette[src];
      result[dst++] = palette[src + 1];
      result[dst++] = palette[src + 2];
      if (channels === 4) {
        result[dst++] =
          transparency && index < transparency.length
            ? transparency[index]
            : 255;
      }
    }
  }
  return result;
}

/**
 * Reads a PNG buffer up to the end of the IHDR chunk and returns this metadata, giving its width, height, bit depth, and color type.
 *
 * @param {ArrayBufferView} buf the PNG buffer to read
 * @param {PNGReaderOptions} [opts={}] optional parameters for reading
 * @returns {IHDRData}
 **/
export function readIHDR(buf, opts = {}) {
  let meta = {};
  reader(buf, { ...opts, copy: false }, (type, view) => {
    if (type === ChunkType.IHDR) {
      meta = decode_IHDR(view);
      return false; // stop reading the rest of PNG
    }
  });
  return meta;
}

/**
 * Parses a PNG buffer and returns an array of chunks, each containing a type code and its data.
 * The individual chunks are not decoded, but left as raw Uint8Array data. If `copy` option is `false`,
 * the chunk data is a view into the original ArrayBufferView (no copy involved), which is more memory efficient
 * for large files.
 *
 * @param {ArrayBufferView} buf
 * @param {PNGReaderOptions} [opts={}] optional parameters for reading PNG chunks
 * @returns {Chunk[]} an array of chunks
 */
export function readChunks(buf, opts = {}) {
  const chunks = [];
  reader(buf, opts, (type, data) => chunks.push({ type, data }));
  return chunks;
}

/**
 * A low-level interface for stream reading a PNG file. With the speicifed buffer, this function reads
 * each chunk and calls the `read(type, data)` function, which is expected to do something with the chunk data.
 * If the `read()` function returns `false`, the stream will stop reading the rest of the PNG file and safely end early,
 * otherwise it will expect to end on an IEND type chunk to form a valid PNG file.
 *
 * @param {ArrayBufferView} buf
 * @param {PNGReaderOptions} [opts={}] optional parameters for reading PNG chunks
 * @returns {Chunk[]} an array of chunks
 */
export function reader(buf, opts = {}, read = () => {}) {
  if (!ArrayBuffer.isView(buf)) {
    throw new Error("Expected a typed array such as Uint8Array");
  }

  if (typeof opts === "function") {
    read = opts;
    opts = {};
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const data = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);

  if (data.length < PNG_HEADER.length) {
    throw new Error(`Buffer too small to contain PNG header`);
  }

  const { checkCRC = false, copy = true } = opts;

  for (let i = 0; i < PNG_HEADER.length; i++) {
    if (data[i] !== PNG_HEADER[i]) throw new Error(`Invalid PNG file header`);
  }

  let ended = false;
  let hasMetIHDR = false;
  let idx = 8;
  while (idx < data.length) {
    if (data.length - idx < 12) throw new Error("Invalid PNG: truncated chunk");

    // Length of current chunk
    const chunkLength = dv.getUint32(idx);
    idx += 4;

    // Extract 4-byte type code
    const type = dv.getUint32(idx);

    // First chunk must be IHDR
    if (!hasMetIHDR) {
      if (type !== ChunkType.IHDR) throw new Error("Invalid PNG: IHDR missing");
      hasMetIHDR = true;
    }

    const chunkDataIdx = idx + 4;
    const chunkDataEndIdx = chunkDataIdx + chunkLength;
    if (chunkDataEndIdx + 4 > data.length) {
      throw new Error("Invalid PNG: truncated chunk data");
    }
    if (checkCRC) {
      // Get the chunk contents including the type code but not CRC code
      const chunkBuffer = data.subarray(idx, chunkDataEndIdx);

      // Int32 CRC value that comes after the chunk data
      const crcCode = dv.getInt32(chunkDataEndIdx);
      let crcExpect = crc32(chunkBuffer);
      if (crcExpect !== crcCode) {
        throw new Error(
          `CRC value for ${chunkTypeToName(
            type
          )} does not match, PNG file may be corrupted`
        );
      }
    }

    // parse the current chunk
    const v = read(
      type,
      copy
        ? data.slice(chunkDataIdx, chunkDataEndIdx)
        : data.subarray(chunkDataIdx, chunkDataEndIdx)
    );
    if (v === false || type === ChunkType.IEND) {
      // safely end the stream
      ended = true;
      break;
    }

    // Skip past the chunk data and CRC value
    idx = chunkDataEndIdx + 4;
  }

  if (!ended) {
    throw new Error("PNG ended without IEND chunk");
  }
}
