import assert from "node:assert/strict";
import test from "node:test";
import { mountClusterMap } from "../scripts/cluster-view.js";

test("map supports zoom, pan, pinch, keyboard, fullscreen and listener cleanup", async () => {
  const element = () => ({
    events: new Map(), attributes: {}, textContent: "", classList: { add() {}, remove() {} },
    addEventListener(type, callback) { this.events.set(type, callback); },
    removeEventListener(type) { this.events.delete(type); },
    setAttribute(key, value) { this.attributes[key] = value; },
    focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 600 }; }
  });
  const root = element(), viewport = element(), world = element(), readout = element(), document = element(), fullscreen = element(), status = element();
  root.ownerDocument = document;
  root.querySelector = selector => selector.includes("fullscreen") ? fullscreen : status;
  root.requestFullscreen = async () => { document.fullscreenElement = root; document.events.get("fullscreenchange")(); };
  document.exitFullscreen = async () => { document.fullscreenElement = null; document.events.get("fullscreenchange")(); };
  const dispose = mountClusterMap({ root, viewport, world, readout, width: 5200, height: 4000 });
  const initial = world.attributes.transform;
  assert.ok(world.attributes.style.includes("--map-nodes: 0.18"), "nodes stay faintly visible in the overview");
  const click = action => root.events.get("click")({ target: { closest: () => ({ dataset: { mapAction: action } }) } });
  await click("in");
  assert.notEqual(world.attributes.transform, initial);
  await click("fit");
  assert.equal(world.attributes.transform, initial);
  await click("actual");
  assert.equal(readout.textContent, "100%");
  assert.ok(world.attributes.style.includes("--map-nodes: 1;"), "nodes become fully visible when zoomed in");
  let prevented = false;
  viewport.events.get("wheel")({ deltaY: -100, deltaMode: 0, clientX: 250, clientY: 200, preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.ok(Number(readout.textContent.replace("%", "")) > 100);
  const pointer = (type, id, x, y) => viewport.events.get(type)({ pointerId: id, button: 0, clientX: x, clientY: y });
  pointer("pointerdown", 1, 100, 100);
  const beforePan = world.attributes.transform;
  pointer("pointermove", 1, 150, 130);
  assert.notEqual(world.attributes.transform, beforePan);
  pointer("pointerdown", 2, 250, 130);
  const beforePinch = readout.textContent;
  pointer("pointermove", 2, 350, 130);
  assert.notEqual(readout.textContent, beforePinch);
  pointer("pointerup", 1, 150, 130);
  pointer("pointercancel", 2, 350, 130);
  viewport.events.get("keydown")({ key: "0", preventDefault() {} });
  assert.equal(world.attributes.transform, initial);
  viewport.events.get("keydown")({ key: "ArrowRight", preventDefault() {} });
  assert.notEqual(world.attributes.transform, initial);
  await click("fullscreen");
  assert.equal(document.fullscreenElement, root);
  assert.equal(fullscreen.textContent, "Exit fullscreen");
  await click("fullscreen");
  assert.equal(document.fullscreenElement, null);
  dispose();
  assert.equal(viewport.events.size, 0);
  assert.equal(root.events.size, 0);
  assert.equal(document.events.size, 0);
});
