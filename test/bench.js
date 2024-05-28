import {
  ColorType,
  FilterMethod,
  colorTypeToChannels,
  encode,
} from "../index.js";
import { deflate } from "pako";

const image = createImage({
  width: 4096 * 2,
  height: 4096 * 2,
  depth: 8,
  filter: FilterMethod.Up,
});

// encode an image
console.time("encode");
encode(image, deflate, { level: 3 });
console.timeEnd("encode");

function createImage(opts = {}) {
  const { width, height, colorType = ColorType.RGBA, depth = 8 } = opts;
  const ArrType = depth === 16 ? Uint16Array : Uint8ClampedArray;
  const maxValue = depth === 16 ? 0xffff : 0xff;

  const channels = colorTypeToChannels(colorType);
  let data = new ArrType(width * height * channels).fill(maxValue);

  const A = [1, 0, 0];
  const B = [0, 0, 1];

  for (let x = 0; x < width; x++) {
    const u = width <= 1 ? 1 : x / (width - 1);
    const [r, g, b] = lerpArray(A, B, u).map((n) => toByte(n));
    data[x * channels + 0] = r;
    data[x * channels + 1] = g;
    data[x * channels + 2] = b;
  }

  // quickly generate an image of expected size
  for (let y = 1; y < height; y++) {
    const x = 0;
    const idx = x + y * width;
    data.copyWithin(idx * channels, 0, width * channels);
  }

  return { ...opts, colorType, depth, data };

  function lerp(min, max, t) {
    return min * (1 - t) + max * t;
  }

  function lerpArray(min, max, t, out = []) {
    for (var i = 0; i < min.length; i++) {
      out[i] = lerp(min[i], max[i], t);
    }
    return out;
  }

  function toByte(v) {
    return Math.max(0, Math.min(maxValue, Math.round(v * maxValue)));
  }
}
