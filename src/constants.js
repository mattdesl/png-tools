export const Intent = {
  Perceptual: 0,
  Relative: 1, // Relative colorimetric
  Saturation: 2,
  Absolute: 3, // Aboslute colorimetric
};

export const FilterType = {
  None: 0x00,
  Sub: 0x01,
  Up: 0x02,
  Average: 0x03,
  Paeth: 0x04,
};

export const ColorType = {
  GRAYSCALE: 1,
  RGB: 2,
  INDEXED: 3,
  GRAYSCALE_ALPHA: 4,
  RGBA: 6,
};

// 4 byte chunk codes in Uint32 decimal
export const ChunkType = {
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
};
