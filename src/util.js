import { ColorType, FilterMethod } from "./constants.js";

/**
 * Concatenates a given array of array-like data (array buffers, typed arrays) into a single Uint8Array.
 *
 * @param {ArrayLike[]} chunks
 * @returns Uint8Array concatenated data
 */
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
  dstIdxInBytesPlusOne,
  inputView,
  outputView
) {
  if (filter === FilterMethod.Paeth) {
    let j = 0;
    if (i === 0) {
      for (; j < bytesPerPixel; j++) {
        out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j];
      }
      for (; j < bytesPerScanline; j++) {
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] -
          data[srcIdxInBytes + j - bytesPerPixel];
      }
    } else {
      const above = srcIdxInBytes - bytesPerScanline;
      for (; j < bytesPerPixel; j++) {
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] - data[above + j];
      }
      for (; j < bytesPerScanline; j++) {
        const left = data[srcIdxInBytes + j - bytesPerPixel];
        const up = data[above + j];
        const upLeft = data[above + j - bytesPerPixel];
        const distanceLeft = Math.abs(up - upLeft);
        const distanceUp = Math.abs(left - upLeft);
        const distanceUpLeft = Math.abs(left + up - 2 * upLeft);
        const predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
            ? left
            : distanceUp <= distanceUpLeft
              ? up
              : upLeft;
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] - predictor;
      }
    }
  } else if (filter === FilterMethod.Sub) {
    if ((bytesPerPixel & 3) === 0) {
      const input =
        inputView ?? new DataView(data.buffer, data.byteOffset, data.byteLength);
      const output =
        outputView ?? new DataView(out.buffer, out.byteOffset, out.byteLength);
      out.set(
        data.subarray(srcIdxInBytes, srcIdxInBytes + bytesPerPixel),
        dstIdxInBytesPlusOne
      );
      for (let j = bytesPerPixel; j < bytesPerScanline; j += 4) {
        output.setUint32(
          dstIdxInBytesPlusOne + j,
          subtractBytes(
            input.getUint32(srcIdxInBytes + j),
            input.getUint32(srcIdxInBytes + j - bytesPerPixel)
          )
        );
      }
      return;
    }
    let j = 0;
    for (; j < bytesPerPixel; j++) {
      out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j];
    }
    for (; j < bytesPerScanline; j++) {
      out[dstIdxInBytesPlusOne + j] =
        data[srcIdxInBytes + j] -
        data[srcIdxInBytes + j - bytesPerPixel];
    }
  } else if (filter === FilterMethod.Up) {
    if (i === 0) {
      out.set(
        data.subarray(srcIdxInBytes, srcIdxInBytes + bytesPerScanline),
        dstIdxInBytesPlusOne
      );
    } else {
      const above = srcIdxInBytes - bytesPerScanline;
      const input =
        inputView ?? new DataView(data.buffer, data.byteOffset, data.byteLength);
      const output =
        outputView ?? new DataView(out.buffer, out.byteOffset, out.byteLength);
      const wordEnd = bytesPerScanline & ~3;
      let j = 0;
      for (; j < wordEnd; j += 4) {
        output.setUint32(
          dstIdxInBytesPlusOne + j,
          subtractBytes(
            input.getUint32(srcIdxInBytes + j),
            input.getUint32(above + j)
          )
        );
      }
      for (; j < bytesPerScanline; j++) {
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] - data[above + j];
      }
      return;
    }
  } else if (filter === FilterMethod.Average) {
    if ((bytesPerPixel & 3) === 0) {
      const input =
        inputView ?? new DataView(data.buffer, data.byteOffset, data.byteLength);
      const output =
        outputView ?? new DataView(out.buffer, out.byteOffset, out.byteLength);
      const above = srcIdxInBytes - bytesPerScanline;
      for (let j = 0; j < bytesPerScanline; j += 4) {
        const left =
          j < bytesPerPixel
            ? 0
            : input.getUint32(srcIdxInBytes + j - bytesPerPixel);
        const up = i === 0 ? 0 : input.getUint32(above + j);
        output.setUint32(
          dstIdxInBytesPlusOne + j,
          subtractBytes(
            input.getUint32(srcIdxInBytes + j),
            averageBytes(left, up)
          )
        );
      }
      return;
    }
    let j = 0;
    if (i === 0) {
      for (; j < bytesPerPixel; j++) {
        out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j];
      }
      for (; j < bytesPerScanline; j++) {
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] -
          (data[srcIdxInBytes + j - bytesPerPixel] >> 1);
      }
    } else {
      const above = srcIdxInBytes - bytesPerScanline;
      for (; j < bytesPerPixel; j++) {
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] - (data[above + j] >> 1);
      }
      for (; j < bytesPerScanline; j++) {
        out[dstIdxInBytesPlusOne + j] =
          data[srcIdxInBytes + j] -
          ((data[srcIdxInBytes + j - bytesPerPixel] + data[above + j]) >> 1);
      }
    }
  }

  // Should never get here in this version as applyFilter is only called
  // when a non-None filter is specified
  // if (filter === FilterMethod.None) {
  //   for (let j = 0; j < bytesPerScanline; j++) {
  //     out[dstIdxInBytesPlusOne + j] = data[srcIdxInBytes + j];
  //   }
  // }
}

const BYTE_HIGH_BITS = 0x80808080;
const BYTE_LOW_BITS = 0x7f7f7f7f;

// Compute four independent modulo-256 byte subtractions without allowing a
// borrow to cross byte boundaries.
function subtractBytes(value, minus) {
  return (
    ((value | BYTE_HIGH_BITS) - (minus & BYTE_LOW_BITS)) ^
    (~(value ^ minus) & BYTE_HIGH_BITS)
  );
}

// Compute floor((a + b) / 2) independently in each packed byte.
function averageBytes(a, b) {
  return (a & b) + (((a ^ b) & 0xfefefefe) >>> 1);
}

export function paethPredictor(left, above, upLeft) {
  let paeth = left + above - upLeft;
  let pLeft = Math.abs(paeth - left);
  let pAbove = Math.abs(paeth - above);
  let pUpLeft = Math.abs(paeth - upLeft);
  if (pLeft <= pAbove && pLeft <= pUpLeft) return left;
  if (pAbove <= pUpLeft) return above;
  return upLeft;
}

/**
 * Converts a ColorType enum to a human readable string, for example ColorType.RGBA (= 6) becomes "RGBA".
 * Although these numerical constants are defined in the PNG spec, the exact string for each is not.
 *
 * @param {ColorType} colorType the type to convert
 * @returns {string} a readable string
 */
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
