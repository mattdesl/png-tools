import crc32 from "./crc32.js";
import { ChunkType, ColorType, FilterMethod, PNG_HEADER } from "./constants.js";
import { chunkTypeToName, decode_IHDR } from "./chunks.js";
import {
  addPackedBytes,
  averagePackedBytes,
  colorTypeToChannels,
  flattenBuffers,
  simplifyFirstRowFilter,
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
 * @property {number} sourceDepth the source PNG bit depth
 * @property {ColorType} sourceColorType the source PNG color type
 * @property {Uint8Array} [palette] the RGBA palette when preserving indexed data
 * @property {Uint16Array} [transparentColor] the source tRNS color
 **/

/**
 * Decodes a PNG into pixel data, using the specified `inflate` algorithm and
 * optional decompression options. Pixels are expanded to RGBA by default. Set
 * `preserveFormat` to retain the source color format. Indexed sources then
 * return one palette index per pixel and an RGBA palette.
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

  const preserveFormat = options?.preserveFormat === true;
  let inflateOptions = options;
  if (options && "preserveFormat" in options) {
    inflateOptions = { ...options };
    delete inflateOptions.preserveFormat;
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
  const packed = unfilter(raw, height, rowBytes, bytesPerPixel);
  let data;
  let resultPalette;
  let transparentColor;
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
    if (preserveFormat) {
      channels = 1;
      data =
        depth === 8
          ? packed
          : unpackSamples(packed, width, height, depth, false);
      resultPalette = createPalette(palette, transparency);
    } else {
      channels = 4;
      data = expandPalette(
        packed,
        width,
        height,
        depth,
        palette,
        transparency
      );
    }
  } else if (depth < 8) {
    data = unpackSamples(packed, width, height, depth, !preserveFormat);
  } else if (depth === 16) {
    data = unpack16(packed);
  } else {
    data = packed;
  }

  if (colorType !== ColorType.INDEXED && transparency) {
    transparentColor = decodeTransparentColor(transparency, colorType);
  }

  let outputColorType = colorType;
  let outputDepth = depth;
  if (!preserveFormat && colorType !== ColorType.RGBA) {
    if (colorType !== ColorType.INDEXED) {
      data = expandToRGBA(
        data,
        width,
        height,
        depth,
        colorType,
        transparentColor
      );
    }
    channels = 4;
    outputColorType = ColorType.RGBA;
    if (depth < 8 || colorType === ColorType.INDEXED) outputDepth = 8;
  }

  const result = {
    width,
    height,
    depth: outputDepth,
    colorType: outputColorType,
    channels,
    data,
    sourceDepth: depth,
    sourceColorType: colorType,
  };
  if (resultPalette) result.palette = resultPalette;
  if (preserveFormat && transparentColor) {
    result.transparentColor = transparentColor;
  }
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

// Decode and compact each row in place. The compact destination always precedes
// the filtered source, so unread input cannot be overwritten.
function unfilter(data, height, rowBytes, bytesPerPixel) {
  const stride = rowBytes + 1;
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pixelsAlignToWords = bytesPerPixel % 4 === 0;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const filter = data[row];
    const source = row + 1;
    const target = y * rowBytes;
    if (filter > 4) throw new Error(`Invalid PNG filter type ${filter}`);
    const effectiveFilter = simplifyFirstRowFilter(filter, y);

    if (effectiveFilter === FilterMethod.None) {
      data.copyWithin(target, source, source + rowBytes);
    } else if (effectiveFilter === FilterMethod.Sub) {
      if (pixelsAlignToWords) {
        data.copyWithin(target, source, source + bytesPerPixel);
        for (let x = bytesPerPixel; x < rowBytes; x += 4) {
          dataView.setUint32(
            target + x,
            addPackedBytes(
              dataView.getUint32(source + x),
              dataView.getUint32(target + x - bytesPerPixel)
            )
          );
        }
        continue;
      }
      let x = 0;
      for (; x < bytesPerPixel; x++) data[target + x] = data[source + x];
      for (; x < rowBytes; x++) {
        data[target + x] =
          data[source + x] + data[target + x - bytesPerPixel];
      }
    } else if (effectiveFilter === FilterMethod.Up) {
      const above = target - rowBytes;
      const packedLength = rowBytes - (rowBytes % 4);
      let x = 0;
      for (; x < packedLength; x += 4) {
        dataView.setUint32(
          target + x,
          addPackedBytes(
            dataView.getUint32(source + x),
            dataView.getUint32(above + x)
          )
        );
      }
      for (; x < rowBytes; x++) {
        data[target + x] = data[source + x] + data[above + x];
      }
    } else if (effectiveFilter === FilterMethod.Average) {
      if (pixelsAlignToWords) {
        const above = target - rowBytes;
        for (let x = 0; x < rowBytes; x += 4) {
          const left =
            x < bytesPerPixel
              ? 0
              : dataView.getUint32(target + x - bytesPerPixel);
          const up = y === 0 ? 0 : dataView.getUint32(above + x);
          dataView.setUint32(
            target + x,
            addPackedBytes(
              dataView.getUint32(source + x),
              averagePackedBytes(left, up)
            )
          );
        }
        continue;
      }
      let x = 0;
      if (y === 0) {
        for (; x < bytesPerPixel; x++) data[target + x] = data[source + x];
        for (; x < rowBytes; x++) {
          data[target + x] =
            data[source + x] + (data[target + x - bytesPerPixel] >> 1);
        }
      } else {
        const above = target - rowBytes;
        for (; x < bytesPerPixel; x++) {
          data[target + x] = data[source + x] + (data[above + x] >> 1);
        }
        for (; x < rowBytes; x++) {
          data[target + x] =
            data[source + x] +
            ((data[target + x - bytesPerPixel] + data[above + x]) >> 1);
        }
      }
    } else {
      const above = target - rowBytes;
      let x = 0;
      for (; x < bytesPerPixel; x++) {
        data[target + x] = data[source + x] + data[above + x];
      }
      for (; x < rowBytes; x++) {
        const left = data[target + x - bytesPerPixel];
        const up = data[above + x];
        const upperLeft = data[above + x - bytesPerPixel];
        const distanceLeft = Math.abs(up - upperLeft);
        const distanceUp = Math.abs(left - upperLeft);
        const distanceUpperLeft = Math.abs(left + up - 2 * upperLeft);
        const predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft
            ? left
            : distanceUp <= distanceUpperLeft
              ? up
              : upperLeft;
        data[target + x] = data[source + x] + predictor;
      }
    }
  }
  return data.subarray(0, rowBytes * height);
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

function decodeTransparentColor(data, colorType) {
  const expectedLength = colorType === ColorType.GRAYSCALE ? 2 : 6;
  if (
    (colorType !== ColorType.GRAYSCALE && colorType !== ColorType.RGB) ||
    data.length !== expectedLength
  ) {
    throw new Error("Invalid PNG: tRNS is not valid for this color format");
  }

  const result = new Uint16Array(expectedLength / 2);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < result.length; i++) result[i] = view.getUint16(i * 2);
  return result;
}

function expandToRGBA(
  data,
  width,
  height,
  depth,
  colorType,
  transparentColor
) {
  const result =
    depth === 16
      ? new Uint16Array(width * height * 4)
      : new Uint8Array(width * height * 4);
  const max = depth === 16 ? 0xffff : 0xff;
  let transparentGray = transparentColor?.[0];
  const transparentRed = transparentColor?.[0];
  const transparentGreen = transparentColor?.[1];
  const transparentBlue = transparentColor?.[2];
  if (transparentColor && depth < 8) {
    transparentGray *= 255 / ((1 << depth) - 1);
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
  transparency
) {
  const result = new Uint8Array(width * height * 4);
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
      result[dst++] =
        transparency && index < transparency.length
          ? transparency[index]
          : 255;
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
