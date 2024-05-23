export function createSaveSetup(cb) {
  const keyDown = (ev) => {
    if (ev.key === "s" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      save();
    }
  };
  window.addEventListener("keydown", keyDown, { passive: false });

  const button = document.createElement("button");
  button.textContent = "Save PNG";
  button.style.cssText = `position: absolute; top: 20px; left: 20px; z-index: 1000;`;
  document.body.appendChild(button);
  button.onclick = (ev) => {
    ev.preventDefault();
    save();
  };

  const unload = () => {
    if (button.parentElement) button.parentElement.removeChild(button);
    window.removeEventListener("keydown", keyDown);
  };
  unload.button = button;
  return unload;

  async function save() {
    cb();
  }
}
