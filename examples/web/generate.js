self.onmessage = async (msg) => {
  const { width, height, depth, channels } = msg.data;
  const ArrType = depth === 16 ? Uint16Array : Uint8ClampedArray;
  const maxValue = depth === 16 ? 0xffff : 0xff;

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

  // A much slower gradient but more pretty, using more colours
  // for (let y = 0, i = 0; y < height; y++) {
  //   for (let x = 0; x < width; x++, i++) {
  //     const u = (x + 1) / width;
  //     const v = (y + 1) / height;
  //     const R = u;
  //     const G = 0.5;
  //     const B = v;
  //     data[i * channels + 0] = toByte(R);
  //     data[i * channels + 1] = toByte(G);
  //     data[i * channels + 2] = toByte(B);
  //     if (channels === 4) data[i * channels + 3] = maxValue;
  //   }
  // }
  self.postMessage(data);

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
};
