// import convert from 'convert-length';
export const Intents = {
  Perceptual: 0,
  Relative: 1, // Relative colorimetric
  Saturation: 2,
  Absolute: 3, // Aboslute colorimetric
};

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
  dv.setUint8(off++, data.compression || 0);
  dv.setUint8(off++, data.filter || 0);
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

function decodeNULTerminatedString(data, offset = 0, maxLength = Infinity) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let str = "";
  for (let i = 0; offset < data.length && i < maxLength; offset++, i++) {
    const b = dv.getUint8(offset);
    if (b === 0x00) {
      break;
    } else {
      const chr = String.fromCharCode(b);
      str += chr;
    }
  }
  // String is always terminated with NUL so we can move forward one more
  offset++;
  return [str, offset];
}

function mergeData(...arrays) {
  // convert to byte arrays
  arrays = arrays.map((a) => {
    if (typeof a === "number") return new Uint8Array([a]);
    if (typeof a === "string") return convertStringToBytes(a);
    return a;
  });

  // Get the total length of all arrays.
  let length = 0;
  for (let array of arrays) length += array.length;

  // Create a new array with total length and merge all source arrays.
  let mergedArray = new Uint8Array(length);
  let offset = 0;
  for (let item of arrays) {
    mergedArray.set(item, offset);
    offset += item.length;
  }
  return mergedArray;
}

function convertStringToBytes(val) {
  const data = new Uint8Array(val.length);
  for (let i = 0; i < data.length; i++) {
    data[i] = val.charCodeAt(i);
  }
  return data;
}

export function withoutChunks(chunks, nameFilter) {
  if (typeof nameFilter === "string") nameFilter = [nameFilter];
  return chunks.filter((c) => !nameFilter.includes(c.name));
}

export function encode_IDAT_raw(data, opts = {}) {
  const { width, height, colorType, depth } = opts;
  const channels = colorTypeToChannels(colorType);
  if (depth !== 8 && depth !== 16)
    throw new Error(`Unsupported bit depth ${depth}`);

  const bytesPerPixel = (depth / 8) * channels;
  const bytesPerScanline = width * bytesPerPixel;
  const elementsPerScanline = width * channels;

  // const expectedByteLength = height * bytesPerScanline;
  // if (data.byteLength !== expectedByteLength) {
  //   throw new Error(
  //     `Data size mismatch: expected ${expectedByteLength}, got ${data.byteLength}`
  //   );
  // }

  const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const scanlineCount = data.byteLength / bytesPerScanline;
  if (scanlineCount % 1 !== 0)
    throw new Error(`Bytes are not padded to channels and scanlines`);
  if (scanlineCount > height)
    throw new Error(
      "Expected scanline count to be less than total image height"
    );
  const expectedByteLength = scanlineCount * bytesPerScanline;

  // additional amount to account for filter bytes at the beginning of each scanline
  const out = new Uint8Array(expectedByteLength + scanlineCount);
  const outDV = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // now we need to write each scanline
  for (let i = 0; i < scanlineCount; i++) {
    // scanline size
    const srcIdxInBytes = i * bytesPerScanline;
    // scanline size + 1 byte for filter type
    const dstIdxInBytes = i * (bytesPerScanline + 1);
    // out[dstIdxInBytes] = 0; // Not needed as 0 is default
    if (depth === 16) {
      // Note: This works fine but it is slow since it touches each element
      // It would be good to find a faster copy method
      for (let j = 0; j < elementsPerScanline; j++) {
        const v = data[i * elementsPerScanline + j];
        outDV.setUint16(dstIdxInBytes + 1 + j * 2, v);
      }
    } else {
      out.set(
        u8.subarray(srcIdxInBytes, srcIdxInBytes + bytesPerScanline),
        dstIdxInBytes + 1
      );
    }
  }
  return out;
}

export function colorTypeToChannels(colorType) {
  switch (colorType) {
    case 0:
      return 1; // grayscale
    case 2:
      return 3; // RGB
    case 3:
      return 1; // indexed
    case 4:
      return 2; // grayscale + alpha
    case 6:
      return 4; // RGBA
    default:
      throw new Error(`Invalid colorType ${colorType}`);
  }
}

function* splitPixels(data, width, height, channels, splitCount) {
  const chunkHeight = Math.floor(height / splitCount);
  const chunkSize = chunkHeight * width * channels;
  for (let i = 0; i < splitCount; i++) {
    const start = i * chunkSize;
    const end = i === splitCount - 1 ? data.length : start + chunkSize;
    yield data.subarray(start, end);
  }
}
