import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prepareProfiles } from "../scripts/profiles.js";
import { clusterInventory } from "../scripts/cluster.js";

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
