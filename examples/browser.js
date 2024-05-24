const render = ({ context, width, height }) => {
  const grad = context.createLinearGradient(width * 0.1, 0, width * 0.9, 0);
  grad.addColorStop(0, "color(display-p3 0 1 0)");
  grad.addColorStop(1, "color(display-p3 1 0 0)");

  context.fillStyle = grad;
  context.fillRect(0, 0, width, height);
};

async function setup() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    colorSpace: "display-p3",
  });
  document.body.appendChild(canvas);

  // A6 standard paper size
  // const { width, height } = paperSizes.
  const width = 256;
  const height = 256;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `256px`;
  canvas.style.height = `256px`;
  render({ context, width, height });

  const data = context.getImageData(0, 0, width, height);
  console.log("raw data", data.data);
}
