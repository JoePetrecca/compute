import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { prepareProfiles, expandNodes, sidebarSubtitle } from "../scripts/profiles.js";

const root = new URL("../", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const manifest = await json("data/computers.json");
const raw = await Promise.all(manifest.map((id) => json(`data/computers/${id}.json`)));
const hardware = await json("data/hardware.json");
const profiles = prepareProfiles(raw, hardware);

test("manifest contains unique, complete profiles and valid node counts", () => {
  assert.equal(new Set(manifest).size, manifest.length);
  assert.equal(profiles.length, 37);
  assert.ok(!manifest.includes("intel") && !manifest.includes("amd"));
  assert.ok(manifest.includes("moria"));
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
  assert.equal(profiles.find((p) => p.id === "moria").memory, "1024 GB");
  assert.equal(profiles.find((p) => p.id === "data-cpu").cores, 128);
  const mig = profiles.find((p) => p.id === "data-mig");
  assert.equal(mig.gpuCount, 4);
  assert.equal(mig.vram, "80 GB");
  assert.equal(mig.sliceMemory, "10 GB");
  assert.equal(profiles.find((p) => p.id === "grace-grace").cpuLink, "NVLink-C2C");
});

test("sidebar subtitles describe workloads or specifications without renaming machines", () => {
  for (const profile of profiles) {
    for (const mode of ["workload", "specs"]) {
      const subtitle = sidebarSubtitle(profile, mode);
      assert.ok(subtitle && !subtitle.includes("undefined"), `${profile.id}/${mode}`);
    }
  }
  const milan = profiles.find((p) => p.id === "acm");
  assert.equal(sidebarSubtitle(milan, "workload"), "Parallel CPU workloads");
  assert.equal(sidebarSubtitle(milan, "specs"), "EPYC 7763 · 128 cores");
  assert.equal(milan.label, "Milan · 493 GB");
});

test("L40S and H200 explain cooperation without implying automatic GPU pooling", () => {
  const l40s = profiles.find((p) => p.id === "l40s-8");
  const h200 = profiles.find((p) => p.id === "h200-8");
  assert.match(l40s.description, /separate jobs.*cooperate over PCIe/);
  assert.match(l40s.components["gpu-interconnect"].limitations, /depends on the allocated system/);
  assert.match(h200.description, /NVLink-connected.*separate memory/);
  assert.match(h200.limitations, /Not automatically one big GPU/);
  assert.match(h200.components["gpu-interconnect"].limitations, /separate devices with separate memory/);
});

test("V100S bandwidth comparison is per GPU, not extra capacity or guaranteed speed", () => {
  assert.equal(hardware.gpus.V100.memoryBandwidth, "900 GB/s per GPU");
  assert.equal(hardware.gpus.V100S.memoryBandwidth, "1134 GB/s per GPU");
  assert.equal(1134 / 900 - 1, 0.26);
  assert.match(hardware.gpus.V100S.limitations, /not measured application speed/);
  assert.equal(profiles.find((p) => p.id === "v100").vram, profiles.find((p) => p.id === "v100s").vram);
});

test("superchip titles distinguish storage without including node names", () => {
  const superchips = profiles.filter((p) => p.group === "ICER · Superchips");
  assert.deepEqual(superchips.map((p) => p.label), ["Grace Hopper · 1.5 TB SSD", "Grace Hopper · 3.2 TB SSD", "Grace–Grace · CPU Superchip"]);
  for (const p of superchips) assert.ok(!/nch-|ncc-/.test(p.label));
  assert.equal(sidebarSubtitle(superchips[0], "workload"), "Closely coupled CPU–GPU work");
  assert.equal(sidebarSubtitle(superchips[2], "workload"), "Parallel Arm CPU workloads");
});

test("every view and clickable component renders usable information", async () => {
  const elements = new Map();
  const storage = new Map([["compute-sidebar-mode", "specs"]]);
  const context = vm.createContext({
    prepareProfiles,
    sidebarSubtitle,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
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
  assert.equal(vm.runInContext("state.diagramView", context), "simple");
  assert.equal(vm.runInContext("state.sidebarMode", context), "specs");
  vm.runInContext("choose('acm'); showInspector('cpu');", context);
  const before = [elements.get("#diagram").innerHTML, elements.get("#inspector").innerHTML];
  vm.runInContext("setSidebarMode('workload')", context);
  assert.equal(storage.get("compute-sidebar-mode"), "workload");
  assert.equal(vm.runInContext("state.current.id", context), "acm");
  assert.deepEqual([elements.get("#diagram").innerHTML, elements.get("#inspector").innerHTML], before);
  assert.ok(elements.get("#computer-list").innerHTML.includes("Parallel CPU workloads"));
  vm.runInContext("setSidebarMode('specs')", context);
  assert.ok(elements.get("#computer-list").innerHTML.includes("EPYC 7763 · 128 cores"));
  for (const profile of profiles) {
    for (const view of ["simple", "detailed"]) {
      vm.runInContext(`state.diagramView = '${view}'; choose('${profile.id}'); details();`, context);
      const svg = elements.get("#diagram").innerHTML;
      assert.ok(svg.includes("<svg"), `${profile.id}/${view}`);
      assert.ok(!svg.includes("undefined") && !svg.includes("NaN"), profile.id);
      assert.equal(svg.includes('class="superchip-diagram"'), profile.group === "ICER · Superchips");
      if (profile.group === "ICER · Superchips") {
        for (const gradient of ["grace-blue", "hopper-purple", "memory-green", "superchip-gold"]) assert.ok(svg.includes(`id="${gradient}"`));
      }
      const gpuCount = [...svg.matchAll(/data-part="gpu"/g)].length;
      assert.equal(gpuCount, profile.gpuCount || (profile.localOptions ? 1 : 0), profile.id);
      const kinds = [undefined, ...new Set([...svg.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]))];
      for (const kind of kinds) {
        vm.runInContext(`showInspector(${JSON.stringify(kind)});`, context);
        const panel = elements.get("#inspector").innerHTML;
        assert.ok(!panel.includes("undefined") && !panel.includes("NaN"), `${profile.id}/${kind}`);
        assert.ok(panel.includes("Good for") && panel.includes("Not good for"));
        if (kind === "interconnect" && profile.layout === "grace-hopper") {
          for (const text of ["NVLink-C2C", "900 GB/s aggregate (450 GB/s each direction)", "Physically separate, coherently accessible memory", "Unified CPU–GPU address space", "without conventional explicit copies", "Treating CPU memory as equally fast as GPU HBM"]) assert.ok(panel.includes(text), `${profile.id}: ${text}`);
          assert.ok(!panel.includes("expansion devices"));
          assert.ok(!panel.includes("independent GPU jobs"));
        }
        if (kind === "gpu" && ["V100", "V100S"].includes(profile.gpu)) {
          assert.ok(panel.includes("Peak local memory bandwidth"));
          assert.ok(panel.includes(hardware.gpus[profile.gpu].memoryBandwidth));
        }
        if (profile.id !== "moria") assert.ok(!/thread|SMT/i.test(panel), profile.id);
      }
    }
  }
  elements.get("#search").value = "agg-073";
  vm.runInContext("renderList()", context);
  assert.ok(elements.get("#computer-list").innerHTML.includes('data-id="genoa-2300"'));
  elements.get("#search").value = "cache-sensitive";
  vm.runInContext("renderList()", context);
  assert.ok(elements.get("#computer-list").innerHTML.includes('data-id="genoa-x"'));
});
