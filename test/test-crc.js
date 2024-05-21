import test from "tape";
import crc32 from "../src/crc32.js";

test("crc32", async (t) => {
  const buf = new Uint8Array(32);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = i ** 2 % 256;
  }
  const r = crc32(buf);
  t.equal(r, 1934867379);
});
