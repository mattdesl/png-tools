import { ColorType, FilterMethod } from "./constants.js";

export function flattenBuffers(chunks) {
  let totalSize = 0;
  for (let chunk of chunks) {
    totalSize += chunk.length;
  }

  const result = new Uint8Array(totalSize);
  for (let i = 0, pos = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

export function decodeNULTerminatedString(
  data,
  offset = 0,
  maxLength = Infinity
) {
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

export function mergeData(...arrays) {
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

export function convertStringToBytes(val) {
  const data = new Uint8Array(val.length);
  for (let i = 0; i < data.length; i++) {
    data[i] = val.charCodeAt(i);
  }
  return data;
}

export function applyFilter(
  out,
  data,
  i,
  filter,
  bytesPerPixel,
  bytesPerScanline,
  srcIdxInBytes,
  dstIdxInBytesPlusOne
) {
  if (filter === FilterMethod.None) {
    for (let j = 0; j < bytesPerScanline; j++) {
      out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j];
    }
  } else if (filter === FilterMethod.Sub) {
    for (let j = 0; j < bytesPerScanline; j++) {
      const leftPixel =
        j < bytesPerPixel ? 0 : data[srcIdxInBytes + j - bytesPerPixel];
      out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j] - leftPixel;
    }
  } else if (filter === FilterMethod.Up) {
    for (let j = 0; j < bytesPerScanline; j++) {
      const upPixel = i === 0 ? 0 : data[srcIdxInBytes + j - bytesPerScanline];
      out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j] - upPixel;
    }
  } else if (filter === FilterMethod.Average) {
    for (let j = 0; j < bytesPerScanline; j++) {
      const left =
        j < bytesPerPixel ? 0 : data[srcIdxInBytes + j - bytesPerPixel];
      const up = i === 0 ? 0 : data[srcIdxInBytes + j - bytesPerScanline];
      const avg = (left + up) >> 1;
      out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j] - avg;
    }
  } else if (filter === FilterMethod.Paeth) {
    for (let j = 0; j < bytesPerScanline; j++) {
      const left =
        j < bytesPerPixel ? 0 : data[srcIdxInBytes + j - bytesPerPixel];
      const up = i === 0 ? 0 : data[srcIdxInBytes + j - bytesPerScanline];
      const upLeft =
        i === 0 || j < bytesPerPixel
          ? 0
          : data[srcIdxInBytes + j - bytesPerScanline - bytesPerPixel];
      out[dstIdxInBytesPlusOne + j] =
        data[srcIdxInBytes + j] - paethPredictor(left, up, upLeft);
    }
  }
}

// not needed
// export function* splitPixels(data, width, height, channels, splitCount) {
//   const chunkHeight = Math.floor(height / splitCount);
//   const chunkSize = chunkHeight * width * channels;
//   for (let i = 0; i < splitCount; i++) {
//     const start = i * chunkSize;
//     const end = i === splitCount - 1 ? data.length : start + chunkSize;
//     yield data.subarray(start, end);
//   }
// }

function paethPredictor(left, above, upLeft) {
  let paeth = left + above - upLeft;
  let pLeft = Math.abs(paeth - left);
  let pAbove = Math.abs(paeth - above);
  let pUpLeft = Math.abs(paeth - upLeft);
  if (pLeft <= pAbove && pLeft <= pUpLeft) return left;
  if (pAbove <= pUpLeft) return above;
  return upLeft;
}

export function colorTypeToString(colorType) {
  const entries = Object.entries(ColorType);
  return entries.find((e) => e[1] === colorType)[0];
}

export function colorTypeToChannels(colorType) {
  switch (colorType) {
    case ColorType.GRAYSCALE:
      return 1; // grayscale
    case ColorType.RGB:
      return 3; // RGB
    case ColorType.INDEXED:
      return 1; // indexed
    case ColorType.GRAYSCALE_ALPHA:
      return 2; // grayscale + alpha
    case ColorType.RGBA:
      return 4; // RGBA
    default:
      throw new Error(`Invalid colorType ${colorType}`);
  }
}
