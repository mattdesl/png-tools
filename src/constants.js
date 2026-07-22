export const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * An enum for Intent when specifying sRGB chunk.
 *
 * @enum {Intent}
 * @property {number} Perceptual (0x00)
 * @property {number} Relative relative colorimetric (0x01)
 * @property {number} Saturation (0x02)
 * @property {number} Absolute absolute colorimetric (0x03)
 **/
export const Intent = Object.freeze({
  Perceptual: 0,
  Relative: 1, // Relative colorimetric
  Saturation: 2,
  Absolute: 3, // Aboslute colorimetric
});

/**
 * An enum for standard PNG scanline filter methods.
 *
 * @enum {FilterMethod}
 * @property {number} None No filter (0x00)
 * @property {number} Sub Compute from left (0x01)
 * @property {number} Up Compute from above scanline (0x02)
 * @property {number} Average Compute from average of up and left (0x03)
 * @property {number} Paeth Compute the PNG 'paeth' predictor from up & left (0x04)
 **/
export const FilterMethod = Object.freeze({
  None: 0x00,
  Sub: 0x01,
  Up: 0x02,
  Average: 0x03,
  Paeth: 0x04,
});

/**
 * An enum for standard PNG color types, such as RGB or RGBA.
 *
 * @enum {ColorType}
 * @property {number} GRAYSCALE (0)
 * @property {number} RGB (2)
 * @property {number} INDEXED (3)
 * @property {number} GRAYSCALE_ALPHA (4)
 * @property {number} RGBA (6)
 **/
export const ColorType = Object.freeze({
  GRAYSCALE: 0,
  RGB: 2,
  INDEXED: 3,
  GRAYSCALE_ALPHA: 4,
  RGBA: 6,
});

/**
 * An enum for standard PNG chunk type codes (4-byte Uint32 decimal), including critical and ancillary chunks.
 *
 * @enum {ChunkType}
 * @property {number} IHDR
 * @property {number} PLTE
 * @property {number} IDAT
 * @property {number} IEND
 * @property {number} (...) - see source for full list
 * */
export const ChunkType = Object.freeze({
  // Critical chunks
  IHDR: 0x49484452,
  PLTE: 0x504c5445,
  IDAT: 0x49444154,
  IEND: 0x49454e44,
  // Ancillary Chunks
  cHRM: 0x6348524d,
  gAMA: 0x67414d41,
  iCCP: 0x69434350,
  sBIT: 0x73424954,
  sRGB: 0x73524742,
  bKGD: 0x624b4744,
  hIST: 0x68495354,
  tRNS: 0x74524e53,
  pHYs: 0x70485973,
  sPLT: 0x73504c54,
  tIME: 0x74494d45,
  iTXt: 0x69545874,
  tEXt: 0x74455874,
  zTXt: 0x7a545874,
});
