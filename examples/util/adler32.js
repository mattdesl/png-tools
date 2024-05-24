const BASE = 65521;

export function adler32_combine(adler1, adler2, len2) {
  // https://github.com/DavidBuchanan314/parallel-png-proposal
  // https://github.com/madler/zlib/blob/cacf7f1d4e3d44d871b605da3b647f07d718623f/adler32.c#L143
  if (adler1 == null) return adler2;
  let a1hi = (adler1 >>> 16) & 0xffff;
  let a1lo = adler1 & 0xffff;
  let a2hi = (adler2 >>> 16) & 0xffff;
  let a2lo = adler2 & 0xffff;
  let sum1 = (a1lo + a2lo - 1) % BASE;
  if (sum1 < 0) sum1 += BASE; // Handle negative results
  let sum2 = (len2 * a1lo + a1hi + a2hi - len2) % BASE;
  if (sum2 < 0) sum2 += BASE; // Handle negative results
  return (sum1 | (sum2 << 16)) >>> 0; // Ensure unsigned 32-bit result
}

export function adler32(buf, adler = 1, len = buf.length, pos = 0) {
  // from pako
  // https://github.com/nodeca/pako/blob/62cb729e7813176ce2d2694b89c8724680fca383/lib/zlib/adler32.js#L26
  let s1 = (adler & 0xffff) | 0,
    s2 = ((adler >>> 16) & 0xffff) | 0,
    n = 0;

  while (len !== 0) {
    // Set limit ~ twice less than 5552, to keep
    // s2 in 31-bits, because we force signed ints.
    // in other case %= will fail.
    n = len > 2000 ? 2000 : len;
    len -= n;

    do {
      s1 = (s1 + buf[pos++]) | 0;
      s2 = (s2 + s1) | 0;
    } while (--n);

    s1 %= 65521;
    s2 %= 65521;
  }

  return (s1 | (s2 << 16) | 0) >>> 0;
}
