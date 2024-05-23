import { ColorType, FilterMethod } from "./constants.js";
import {
  decodeNULTerminatedString,
  convertStringToBytes,
  mergeData,
  applyFilter,
  colorTypeToChannels,
} from "./util.js";

export function matchesChunkType(a, b) {
  if (a == null || b == null)
    throw new Error(
      `chunk type does not exist; maybe a spelling mistake in ChunkType enum?`
    );
  const aType = typeof a === "string" ? chunkNameToType(a) : a;
  const bType = typeof b === "string" ? chunkNameToType(b) : b;
  return aType === bType;
}

export function chunkFilter(type) {
  if (!type) throw new Error("Must specify a type parameter");
  const types = Array.isArray(type) ? type : [type];
  return (c) => types.some((n) => matchesChunkType(c.type, n));
}

export function withoutChunks(chunks, type) {
  const filter = chunkFilter(type);
  return chunks.filter((c) => !filter(c));
}

export function chunkTypeToName(type) {
  return String.fromCharCode(
    (type >> 24) & 0xff,
    (type >> 16) & 0xff,
    (type >> 8) & 0xff,
    type & 0xff
  );
}

export function chunkNameToType(name) {
  if (name.length !== 4) {
    throw new Error("Chunk name must be exactly 4 characters");
  }
  return (
    (name.charCodeAt(0) << 24) |
    (name.charCodeAt(1) << 16) |
    (name.charCodeAt(2) << 8) |
    name.charCodeAt(3)
  );
}

export function decode_IHDR(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  const width = dv.getUint32(off);
  off += 4;
  const height = dv.getUint32(off);
  off += 4;
  const depth = dv.getUint8(off++);
  const colorType = dv.getUint8(off++);
  const compression = dv.getUint8(off++);
  const filter = dv.getUint8(off++);
  const interlace = dv.getUint8(off++);
  return {
    width,
    height,
    depth,
    colorType,
    compression,
    filter,
    interlace,
  };
}

export function encode_IHDR(data) {
  const buf = new Uint8Array(13);
  const dv = new DataView(buf.buffer);
  let off = 0;
  dv.setUint32(off, data.width);
  off += 4;
  dv.setUint32(off, data.height);
  off += 4;
  dv.setUint8(off++, data.depth ?? 8);
  dv.setUint8(off++, data.colorType ?? 6);
  dv.setUint8(off++, 0); // Only compression type 0 is defined
  dv.setUint8(off++, 0); // Only filter type 0 is defined
  dv.setUint8(off++, data.interlace || 0);
  return buf;
}

export function decode_iCCP(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let [name, i] = decodeNULTerminatedString(data, 0, 79);

  // compression mode & offset for data
  const compression = dv.getUint8(i++);

  return {
    name,
    compression,
    data: data.slice(i),
  };
}

export function encode_iCCP({ name, data } = {}) {
  const nameBytes = convertStringToBytes(name).slice(0, 79);
  const buf = new Uint8Array(nameBytes.length + 2 + data.length);
  buf.set(nameBytes, 0);
  buf.set(data, nameBytes.length + 2);
  return buf;
}

export function decode_iTXt(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let offset = 0;

  const [keyword, idx0] = decodeNULTerminatedString(data, 0, 79);
  offset = idx0;

  const compressionFlag = dv.getUint8(offset++);
  const compressionMethod = dv.getUint8(offset++);

  const [languageTag, idx1] = decodeNULTerminatedString(data, offset);
  offset = idx1;

  const [translatedKeyword, idx2] = decodeNULTerminatedString(data, offset);
  offset = idx2;

  let text = "";
  for (; offset < data.length; offset++) {
    const b = dv.getUint8(offset);
    const chr = String.fromCharCode(b);
    text += chr;
  }

  return {
    keyword,
    compressionFlag,
    compressionMethod,
    languageTag,
    translatedKeyword,
    text,
  };
}

export function encode_iTXt(opts = {}) {
  const {
    keyword = "",
    compressionFlag = 0,
    compressionMethod = 0,
    languageTag = "en",
    translatedKeyword = "",
    text = "",
  } = opts;

  const result = mergeData(
    keyword.slice(0, 79),
    0x00,
    compressionFlag,
    compressionMethod,
    languageTag,
    0x00,
    translatedKeyword,
    0x00,
    text
  );
  return result;
}

export function encode_standardGamma() {
  const data = new Uint8Array(4);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 45455);
  return data;
}

export function encode_standardChromatics() {
  const data = new Uint8Array(8 * 4);
  const dv = new DataView(data.buffer);
  const items = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
  for (let i = 0; i < items.length; i++) {
    dv.setUint32(i * 4, items[i]);
  }
  return data;
}

export function encode_sRGB(byte) {
  return new Uint8Array([byte]);
}

export function encode_pHYs({ x, y, unit = 1 } = {}) {
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, x);
  dv.setUint32(4, y);
  dv.setUint8(8, unit);
  return data;
}

export function encode_pHYs_PPI(pixelsPerInch) {
  // convert 1 m to px at N PPI
  const ppu = Math.round((1 / 0.0254) * pixelsPerInch);
  return encode_pHYs({ x: ppu, y: ppu, unit: 1 });
}

export function encode_IDAT_raw(data, opts = {}) {
  const width = opts.width;
  const height = opts.height;
  const depth = opts.depth;
  const colorType = opts.colorType ?? ColorType.RGBA;
  const filter = opts.filter ?? FilterMethod.Paeth;
  const channels = colorTypeToChannels(colorType);
  if (depth !== 8 && depth !== 16) {
    throw new Error(`Unsupported bit depth ${depth}`);
  }

  const bytesPerPixel = (depth / 8) * channels;
  const bytesPerScanline = width * bytesPerPixel;
  const elementsPerScanline = width * channels;

  const scanlineCount = data.byteLength / bytesPerScanline;
  if (scanlineCount % 1 !== 0) {
    throw new Error(`Bytes are not padded to channels and scanlines`);
  }
  if (scanlineCount > height) {
    throw new Error(
      "Expected scanline count to be less than total image height"
    );
  }
  if (filter < 0x00 || filter > 0x04) {
    throw new Error(`filter type ${filter} unsupported`);
  }

  const expectedByteLength = scanlineCount * bytesPerScanline;
  const out = new Uint8Array(expectedByteLength + scanlineCount);

  if (depth === 16) {
    // Special case: we need to deal with endianness by converting input into big endian

    // To handle filtering, we will keep track of two scanlines worth of BE packed data:
    // The current scanline, and the previous
    const packed = new Uint8Array(bytesPerScanline * 2);
    const packedDV = new DataView(
      packed.buffer,
      packed.byteOffset,
      packed.byteLength
    );

    for (let i = 0; i < scanlineCount; i++) {
      const srcIdxInElements = i * elementsPerScanline;

      // Shift the second half of the buffer toward the front
      // The first half will be the 'above scanline' (initially 0)
      packed.copyWithin(0, bytesPerScanline);

      // now do the big packing into big endian format for this scanline
      // making sure to place it in the second half of the buffer
      for (let j = 0; j < elementsPerScanline; j++) {
        const v = data[srcIdxInElements + j];
        packedDV.setUint16(bytesPerScanline + j * 2, v);
      }

      const dstIdxInBytes = i * (bytesPerScanline + 1);
      const dstIdxInBytesPlusOne = dstIdxInBytes + 1;

      // Note: the source here is the latter half of the temp 2-scanline array
      const srcIdxInBytes = bytesPerScanline;

      if (filter == FilterMethod.None) {
        // fast mode, we can just copy the big endian bytes over to the output
        // being sure to only copy the second half of the buffer (current scanline)
        // and placing it after the filter (which doesn't need to be set, default 0x00)
        out.set(packed.subarray(bytesPerScanline), dstIdxInBytesPlusOne);
      } else {
        out[dstIdxInBytes] = filter;
        applyFilter(
          out,
          packed,
          i,
          filter,
          bytesPerPixel,
          bytesPerScanline,
          srcIdxInBytes,
          dstIdxInBytesPlusOne
        );
      }
    }
  } else {
    // 8 bit is simpler, we can just copy data
    for (let i = 0; i < scanlineCount; i++) {
      // scanline size + 1 byte for filter type
      const dstIdxInBytes = i * (bytesPerScanline + 1);
      const dstIdxInBytesPlusOne = dstIdxInBytes + 1;
      const srcIdxInBytes = i * bytesPerScanline;
      if (filter == FilterMethod.None) {
        // Copy each scanline over but with a 1 byte offset
        // place after 1 byte offset to account for 0x00 filter (does not need to be set, buffer defaults to 0)
        out.set(
          data.subarray(srcIdxInBytes, srcIdxInBytes + bytesPerScanline),
          dstIdxInBytesPlusOne
        );
      } else {
        out[dstIdxInBytes] = filter;
        applyFilter(
          out,
          data,
          i,
          filter,
          bytesPerPixel,
          bytesPerScanline,
          srcIdxInBytes,
          dstIdxInBytesPlusOne
        );
      }
    }
  }

  return out;
}
