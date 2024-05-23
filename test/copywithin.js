// prettier-ignore
const u8 = new Uint8Array([
  1,2,3,4,
  5,6,7,8,
  9,10,11,12,
]);

const bytesPerScanline = 4;
const scanlineCount = 3;
const expectedByteLength = scanlineCount * bytesPerScanline;
const depth = 8;

const outputByteLength = scanlineCount * (bytesPerScanline + 1);
const out = new Uint8Array(outputByteLength);
const copyWithin = typeof out.copyWithin === "function";
if (depth === 8 && copyWithin) {
  // First, copy the entire input into the larger output buffer
  // But make sure we shift it right far enough to account for the scanline
  out.set(u8, scanlineCount);
}

// now we need to write each scanline
for (let i = 0; i < scanlineCount; i++) {
  const srcStart = i * bytesPerScanline + scanlineCount;
  const dstStart = i * (bytesPerScanline + 1) + 1;
  out.copyWithin(dstStart, srcStart, srcStart + bytesPerScanline);
  out[i * (bytesPerScanline + 1)] = 0;
}

// const out = new Uint8Array(expectedByteLength * 2);
// const copyWithin = true && typeof out.copyWithin === "function";
// if (depth === 8 && copyWithin) {
//   // First, copy the entire input into the larger output buffer
//   // But make sure we shift it right far enough to account for the scanline
//   out.set(u8, expectedByteLength);
// }

// console.log("CURVAL", out);

// // now we need to write each scanline
// for (let i = 0; i < scanlineCount; i++) {
//   // scanline size
//   const srcIdxInBytes = i * bytesPerScanline;
//   // scanline size + 1 byte for filter type
//   const dstIdxInBytes = i * (bytesPerScanline + 1);
//   // out[dstIdxInBytes] = 0; // Not needed as 0 is default
//   if (copyWithin) {
//     // copy the stream from the right to the left
//     out.copyWithin(
//       dstIdxInBytes + 1,
//       expectedByteLength + srcIdxInBytes,
//       expectedByteLength + srcIdxInBytes + bytesPerScanline
//     );
//   } else {
//     out.set(
//       u8.subarray(srcIdxInBytes, srcIdxInBytes + bytesPerScanline),
//       dstIdxInBytes + 1
//     );
//   }
// }

// console.log(out.slice(0, expectedByteLength + scanlineCount));
for (let y = 0; y < scanlineCount; y++) {
  console.log(
    out.slice(
      y * (bytesPerScanline + 1),
      y * (bytesPerScanline + 1) + bytesPerScanline + 1
    )
  );
}
