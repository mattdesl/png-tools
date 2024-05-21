# PNG Spec

## Encoding

- The browser's own encoder is usually much faster than anything that can be done in JS
- The best approach is to encode with the browser, and re-encode ancillary chunks if needed
  - This can be even better if, instead of decoding whole file and re-encoding it, you just insert data into the buffer and stop reading once you hit IDATs - but the problem is that you may miss text chunks which can appear anywhere. Since the bulk of time is spent in DEFLATE, it is probably OK to decode and recode the entire stream of chunks without having to recompress.
- It's often expensive to get pixel data in RGBA format from a canvas, so usually cheaper to just use canvas.toBlob to get the final PNG rather than getPixels -> encodePixelsToPNG
- Worker encoder is possible but mainly useful if (a) you have a massive file and want to offload encoding to prevent UI lockups, or (b) already have pixel data for some reason, such as doing 16 bit images where canvas.toBlob is useless
