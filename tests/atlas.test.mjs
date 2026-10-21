import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { prepareProfiles, expandNodes } from "../scripts/profiles.js";

const root = new URL("../", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const manifest = await json("data/computers.json");
const raw = await Promise.all(manifest.map((id) => json(`data/computers/${id}.json`)));
const hardware = await json("data/hardware.json");
const profiles = prepareProfiles(raw, hardware);

test("manifest contains unique, complete profiles and valid node counts", () => {
  assert.equal(new Set(manifest).size, manifest.length);
  assert.equal(profiles.length, 39);
  for (const p of profiles) {
    assert.ok(p.id && p.label && p.cpu && p.memory && p.goodFor && p.limitations, p.id);
    if (p.group.startsWith("ICER")) {
      assert.equal(p.nodeCount, p.nodes.length, p.id);
      assert.ok(p.source?.url, p.id);
    }
  }
  assert.deepEqual(expandNodes("agg-[048,065–072]"), ["agg-048", ...Array.from({ length: 8 }, (_, i) => `agg-${String(65 + i).padStart(3, "0")}`)]);
});

test("all archived ICER nodes remain represented without duplicates", async () => {
  const archive = await readFile(new URL("Compute-Atlas.html", root), "utf8");
  const old = JSON.parse(archive.match(/const PROFILES = (\[[\s\S]*?\n    \]);/)[1]);
  const expected = new Set(old.filter((p) => p.group.startsWith("ICER")).flatMap((p) => p.nodes));
  const current = profiles.filter((p) => p.group.startsWith("ICER")).flatMap((p) => p.nodes);
  assert.equal(current.length, new Set(current).size);
  assert.deepEqual(new Set(current), expected);
});

test("physical core and slice capacities are distinct from allocatable resources", () => {
  assert.equal(profiles.find((p) => p.id === "data-cpu").cores, 128);
  const mig = profiles.find((p) => p.id === "data-mig");
  assert.equal(mig.gpuCount, 4);
  assert.equal(mig.vram, "80 GB");
  assert.equal(mig.sliceMemory, "10 GB");
  assert.equal(profiles.find((p) => p.id === "grace-grace").cpuLink, "NVLink-C2C");
});

test("every view and clickable component renders usable information", async () => {
  const elements = new Map();
  const context = vm.createContext({
    prepareProfiles,
    document: {
      querySelector(key) {
        if (!elements.has(key)) elements.set(key, { value: "", addEventListener() {}, showModal() {}, close() {} });
        return elements.get(key);
      },
      querySelectorAll: () => []
    },
    fetch: async (path) => ({ ok: true, json: () => json(path) })
  });
  let app = await readFile(new URL("scripts/app.js", root), "utf8");
  app = app.replace(/^import .*\n/, "").replace("loadProfiles().catch", "globalThis.ready = loadProfiles().catch");
  vm.runInContext(app, context);
  await context.ready;
  for (const profile of profiles) {
    for (const view of ["simple", "detailed"]) {
      vm.runInContext(`state.diagramView = '${view}'; choose('${profile.id}'); details();`, context);
      const svg = elements.get("#diagram").innerHTML;
      assert.ok(svg.includes("<svg"), `${profile.id}/${view}`);
      assert.ok(!svg.includes("undefined") && !svg.includes("NaN"), profile.id);
      const gpuCount = [...svg.matchAll(/data-part="gpu"/g)].length;
      assert.equal(gpuCount, profile.gpuCount || (profile.localOptions ? 1 : 0), profile.id);
      const kinds = [undefined, ...new Set([...svg.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]))];
      for (const kind of kinds) {
        vm.runInContext(`showInspector(${JSON.stringify(kind)});`, context);
        const panel = elements.get("#inspector").innerHTML;
        assert.ok(!panel.includes("undefined") && !panel.includes("NaN"), `${profile.id}/${kind}`);
        assert.ok(panel.includes("Good for") && panel.includes("Not good for"));
        if (profile.id !== "moria") assert.ok(!/thread|SMT/i.test(panel), profile.id);
      }
    }
  }
  elements.get("#search").value = "agg-073";
  vm.runInContext("renderList()", context);
  assert.ok(elements.get("#computer-list").innerHTML.includes('data-id="genoa-2300"'));
});
