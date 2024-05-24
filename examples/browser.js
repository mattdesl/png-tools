import { ColorType, encode_IDAT_raw } from "../index.js";
console.log(
  encode_IDAT_raw(new Uint8Array([0xff, 0x00, 0x00, 0xff]), {
    colorType: ColorType.RGBA,
    width: 1,
    height: 1,
    depth: 8,
  })
);
