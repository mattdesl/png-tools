export function* splitPixels(data, width, height, channels, splitCount) {
  const chunkHeight = Math.floor(height / splitCount);
  const chunkSize = chunkHeight * width * channels;
  for (let i = 0; i < splitCount; i++) {
    const start = i * chunkSize;
    const end = i === splitCount - 1 ? data.length : start + chunkSize;
    yield {
      index: i,
      start,
      end,
      view: data.subarray(start, end),
      isFirst: i === 0,
      isLast: i === splitCount - 1,
    };
  }
}
