import { fitCluster, zoomCluster } from "./cluster.js";

export function mountClusterMap({ root, viewport, world, readout, width, height }) {
  const document = root.ownerDocument;
  const pointers = new Map();
  const cleanup = [];
  let transform = { x: 0, y: 0, scale: 1 };
  let autoFit = true;
  let lastSize = { width: 0, height: 0 };
  const size = () => viewport.getBoundingClientRect();
  const listen = (element, type, callback, options) => {
    element.addEventListener(type, callback, options);
    cleanup.push(() => element.removeEventListener(type, callback, options));
  };
  const paint = () => {
    world.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.scale})`);
    readout.textContent = `${Math.round(transform.scale * 100)}%`;
  };
  const fit = () => {
    const rect = size();
    transform = fitCluster(rect.width, rect.height, width, height);
    autoFit = true;
    paint();
  };
  const zoom = (factor, point) => {
    const rect = size();
    const minimum = Math.max(0.001, fitCluster(rect.width, rect.height, width, height).scale / 2);
    transform = zoomCluster(transform, point || { x: rect.width / 2, y: rect.height / 2 }, factor, minimum);
    autoFit = false;
    paint();
  };
  const local = event => {
    const rect = size();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const resize = () => {
    const rect = size();
    if (autoFit) fit();
    else {
      transform.x += (rect.width - lastSize.width) / 2;
      transform.y += (rect.height - lastSize.height) / 2;
      paint();
    }
    lastSize = { width: rect.width, height: rect.height };
    const button = root.querySelector('[data-map-action="fullscreen"]');
    if (button) button.textContent = document.fullscreenElement === root ? "Exit fullscreen" : "Fullscreen";
  };
  listen(viewport, "wheel", event => {
    event.preventDefault();
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size().height : 1;
    zoom(Math.exp(Math.max(-1, Math.min(1, -event.deltaY * multiplier * 0.0015))), local(event));
  }, { passive: false });
  listen(viewport, "pointerdown", event => {
    if (event.button !== 0) return;
    viewport.focus({ preventScroll: true });
    pointers.set(event.pointerId, local(event));
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  });
  listen(viewport, "pointermove", event => {
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    const old = pointers.get(event.pointerId);
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      transform.x += point.x - old.x;
      transform.y += point.y - old.y;
    } else {
      const after = [...pointers.values()];
      const center = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const a = center(before), b = center(after);
      zoom(distance(after) / Math.max(distance(before), 1), a);
      transform.x += b.x - a.x;
      transform.y += b.y - a.y;
    }
    autoFit = false;
    paint();
  });
  const endPointer = event => {
    pointers.delete(event.pointerId);
    if (!pointers.size) viewport.classList.remove("is-panning");
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) listen(viewport, event, endPointer);
  listen(viewport, "keydown", event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (["+", "=", "-", "_", "0", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
    if (["+", "="].includes(event.key)) zoom(1.4);
    else if (["-", "_"].includes(event.key)) zoom(1 / 1.4);
    else if (["0", "Home"].includes(event.key)) fit();
    else if (event.key.startsWith("Arrow")) {
      transform.x += event.key === "ArrowLeft" ? 80 : event.key === "ArrowRight" ? -80 : 0;
      transform.y += event.key === "ArrowUp" ? 80 : event.key === "ArrowDown" ? -80 : 0;
      autoFit = false;
      paint();
    }
  });
  listen(root, "click", async event => {
    const action = event.target.closest("[data-map-action]")?.dataset.mapAction;
    if (action === "in") zoom(1.5);
    if (action === "out") zoom(1 / 1.5);
    if (action === "fit") fit();
    if (action === "actual") zoom(1 / transform.scale);
    if (action === "fullscreen") {
      try {
        if (document.fullscreenElement === root) await document.exitFullscreen();
        else await root.requestFullscreen();
      } catch { root.querySelector(".cluster-map-status").textContent = "Fullscreen is unavailable here. You can still zoom and pan."; }
    }
  });
  listen(document, "fullscreenchange", resize);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    cleanup.push(() => observer.disconnect());
  } else if (document.defaultView) listen(document.defaultView, "resize", resize);
  resize();
  return () => {
    cleanup.forEach(dispose => dispose());
    pointers.clear();
  };
}
