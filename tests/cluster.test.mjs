import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prepareProfiles } from "../scripts/profiles.js";
import { clusterInventory, clusterLayout, fitCluster, zoomCluster } from "../scripts/cluster.js";

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const ids = await json("data/computers.json");
const profiles = prepareProfiles(await Promise.all(ids.map(id => json(`data/computers/${id}.json`))), await json("data/hardware.json"));

test("HPCC inventory counts each represented physical node once and excludes Moria", () => {
  const inventory = clusterInventory(profiles);
  const nodes = inventory.configurations.flatMap(p => p.nodes);
  assert.equal(inventory.configurations.length, 36);
  assert.equal(nodes.length, new Set(nodes).size);
  assert.equal(inventory.totalNodes, 645);
  assert.equal(inventory.computeNodes, 640);
  assert.equal(inventory.developmentNodes, 5);
  assert.equal(inventory.physicalCores, 69936);
  assert.equal(inventory.physicalGpus, 284);
  assert.ok(!inventory.configurations.some(p => p.id === "moria"));
  assert.equal(inventory.groups.flatMap(g => g.profiles).length, inventory.configurations.length);
  assert.equal(inventory.configurations.find(p => p.id === "v100").nodes.length, 8);
  assert.equal(inventory.configurations.find(p => p.id === "v100s").nodes.length, 20);
});

test("one world-space map places every node without overlapping configurations", () => {
  const layout = clusterLayout(clusterInventory(profiles));
  const boxes = layout.groups.flatMap(g => g.configurations);
  assert.equal(boxes.flatMap(b => b.nodes).length, 645);
  assert.ok(layout.width > 0 && layout.width < 7600);
  const islandArea = layout.groups.reduce((sum, group) => sum + group.width * group.height, 0);
  assert.ok(islandArea / (layout.width * layout.height) > 0.8, "islands fill at least 80% of map bounds");
  for (const label of ["Milan", "Rome"]) {
    const islands = layout.groups.filter(group => group.label === label && group.name === "ICER · CPU");
    assert.equal(islands.length, 1);
    assert.equal(islands[0].configurations.length, 3);
  }
  for (let i = 0; i < layout.groups.length; i++) for (let j = i + 1; j < layout.groups.length; j++) {
    const a = layout.groups[i], b = layout.groups[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
  for (const group of layout.groups) {
    assert.ok(group.y + group.height <= layout.height);
    for (const box of group.configurations) {
      assert.ok(box.x >= group.x && box.x + box.width <= group.x + group.width);
      assert.ok(box.y >= group.y && box.y + box.height <= group.y + group.height);
      for (const node of box.nodes) {
        assert.ok(node.x >= box.x && node.x + node.width <= box.x + box.width);
        assert.ok(node.y >= box.y && node.y + node.height <= box.y + box.height);
      }
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
});

test("fit shows the entire map and cursor-centered zoom keeps its world point fixed", () => {
  const fit = fitCluster(1000, 600, 5200, 4000);
  assert.ok(fit.x >= 0 && fit.y >= 0);
  assert.ok(fit.x + 5200 * fit.scale <= 1000);
  assert.ok(fit.y + 4000 * fit.scale <= 600);
  const point = { x: 230, y: 180 };
  const zoomed = zoomCluster(fit, point, 3);
  assert.ok(Math.abs((point.x - fit.x) / fit.scale - (point.x - zoomed.x) / zoomed.scale) < 1e-8);
  assert.ok(Math.abs((point.y - fit.y) / fit.scale - (point.y - zoomed.y) / zoomed.scale) < 1e-8);
  assert.equal(zoomCluster(fit, point, 1e8).scale, 8);
  assert.equal(zoomCluster(fit, point, 0).scale, 0.01);
});
