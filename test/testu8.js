import { deflate, inflate } from "pako";
import { colorTypeToChannels, encode_IDAT_raw } from "../src/util.js";
import {
  ChunkType,
  ColorType,
  decodeChunks,
  matchesChunkType,
} from "../src/png-io.js";
import { encode } from "fast-png";

const colorType = ColorType.RGBA;
const img = {
  colorType,
  width: 2,
  height: 2,
  depth: 16,
  channels: colorTypeToChannels(colorType),
  data: new Uint16Array([
    ...floatsToUint16([1, 0, 0, 1]),
    ...floatsToUint16([0, 1, 0, 0.5]),
    ...floatsToUint16([0, 0, 1, 0.25]),
    ...floatsToUint16([0, 0, 0, 0]),
  ]).fill(0xfaff),
};

const u16 = img.data;
const u8 = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
console.log("U16", u16);
console.log("U8", u8);
const arrayBufBig = new ArrayBuffer(u16.byteLength + 1);
const u8Big = new Uint8Array(arrayBufBig);
u8Big.set(u8, 1);

console.log("U8 2", u8Big);
// const u16second = new Uint16Array()

const end = new Uint8Array([255, 250]);
const dv = new DataView(end.buffer);
const isBigEndian = false;
const U16Val = dv.getUint16(0, isBigEndian ? false : true);
console.log("vallll", U16Val, "wants", 0xfaff);

const idat = deflate(encode_IDAT_raw(img.data, img), { level: 3 });
const decompressed = inflate(idat);

const expectedIDAT = decodeChunks(encode(img)).find((f) =>
  matchesChunkType(f.type, ChunkType.IDAT)
);
const expectedDecrompressed = inflate(expectedIDAT.data);
console.log(decompressed);
console.log(expectedDecrompressed);

console.log(
  "equals",
  Buffer.from(decompressed).equals(Buffer.from(expectedDecrompressed))
);

function floatsToUint16(rgb) {
  return rgb.map((r) => Math.max(0, Math.min(0xffff, Math.round(r * 0xffff))));
}
