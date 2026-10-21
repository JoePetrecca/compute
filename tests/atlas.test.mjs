import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { prepareProfiles, expandNodes, sidebarSubtitle } from "../scripts/profiles.js";
import { buildUsage, usageDefaults, usageConfig, usageValuesFor, graceSetup } from "../scripts/usage.js";

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

test("development titles use architectures and GPU workload subtitles stay distinct", () => {
  const expected = [
    ["dev-amd24", "Dev · Genoa"],
    ["dev-amd24-h200", "Dev · Genoa · Hopper"],
    ["dev-amd20", "Dev · Rome"],
    ["dev-amd20-v100", "Dev · Cascade Lake · Volta"],
    ["dev-intel18", "Dev · Skylake"]
  ];
  for (const [id, label] of expected) {
    const p = profiles.find((p) => p.id === id);
    assert.equal(p.label, id);
    assert.equal(p.secondaryLabel, label);
    assert.ok(p.nodes.includes(id));
    assert.equal(sidebarSubtitle(p, "workload"), p.gpu ? "Compile, debug & GPU tests" : "Compile, debug & tests");
    if (p.gpu) assert.equal(sidebarSubtitle(p, "specs"), `${p.vram}/GPU · ${p.memory} RAM`);
  }
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
    buildUsage,
    usageDefaults,
    usageConfig,
    usageValuesFor,
    graceSetup,
    prepareProfiles,
    sidebarSubtitle,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: {
      querySelector(key) {
        if (!elements.has(key)) elements.set(key, { value: "", listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, insertAdjacentHTML(position, html) { this.adjacentPosition = position; this.adjacentHTML = html; }, focus() {}, showModal() {}, close() {}, setAttribute() {}, removeAttribute() {} });
        return elements.get(key);
      },
      querySelectorAll: () => []
    },
    fetch: async (path) => ({ ok: true, json: () => json(path) })
  });
  let app = await readFile(new URL("scripts/app.js", root), "utf8");
  app = app.replace(/^import .*\n/gm, "").replace("loadProfiles().catch", "globalThis.ready = loadProfiles().catch");
  vm.runInContext(app, context);
  await context.ready;
  assert.deepEqual(manifest.slice(0, 5), ["dev-amd24", "dev-amd24-h200", "dev-amd20", "dev-amd20-v100", "dev-intel18"]);
  assert.ok(elements.get("#computer-list").innerHTML.includes('<strong>dev-amd24</strong><small class="profile-subname">Dev · Genoa</small>'));
  assert.equal((elements.get("#computer-list").innerHTML.match(/class="pickaxe-glyph"/g) || []).length, 1);
  assert.match(elements.get("#computer-list").innerHTML, /data-id="moria"[^>]*><span class="profile-icon pickaxe-icon"/);
  for (const [group, icon] of [["ICER · CPU", "cpu"], ["ICER · GPU", "graphics-card"], ["ICER · Data Machine", "storage"]]) {
    const count = profiles.filter(p => p.group === group).length;
    assert.equal((elements.get("#computer-list").innerHTML.match(new RegExp(`data-icon="${icon}"`, "g")) || []).length, count);
  }
  assert.equal((elements.get("#computer-list").innerHTML.match(/data-icon="terminal-gpu"/g) || []).length, 2);
  assert.equal((elements.get("#computer-list").innerHTML.match(/data-icon="terminal"/g) || []).length, 3);
  assert.equal((elements.get("#computer-list").innerHTML.match(/data-icon="grace-hopper"/g) || []).length, 2);
  assert.equal((elements.get("#computer-list").innerHTML.match(/data-icon="grace-grace"/g) || []).length, 1);
  for (const group of ["CPU", "GPU", "Data Machine", "Development", "Superchips"]) assert.ok(elements.get("#computer-list").innerHTML.includes(`data-group="ICER · ${group}"`));
  assert.equal(vm.runInContext("state.diagramView", context), "simple");
  assert.equal(vm.runInContext("state.sidebarMode", context), "specs");
  vm.runInContext("choose('h200-4'); setMachineTab('usage');", context);
  assert.equal(elements.get("#usage-panel").hidden, false);
  assert.equal(elements.get("#inspector").hidden, true);
  assert.ok(elements.get("#usage-panel").innerHTML.includes("Configure your resources"));
  assert.ok(elements.get("#usage-panel").innerHTML.includes('value="any" selected'));
  assert.ok(!elements.get("#usage-output").innerHTML.includes("--nodelist="));
  assert.equal(elements.get("#resource-form").adjacentPosition, "afterend");
  assert.ok(elements.get("#resource-form").adjacentHTML.includes("Advanced · whole-node request"));
  assert.ok(elements.get("#resource-form").adjacentHTML.includes("This can take a while."));
  assert.ok(!elements.get("#resource-form").adjacentHTML.includes('class="whole-node-control" open'));
  assert.ok(elements.get("#usage-panel").innerHTML.includes('aria-label="Increase CPU cores"'));
  assert.ok(elements.get("#usage-output").innerHTML.includes('class="usage-terminal"'));
  assert.ok(elements.get("#usage-output").innerHTML.includes('class="usage-steps"'));
  assert.ok(elements.get("#usage-output").innerHTML.includes("sbatch hopper.sbatch"));
  const cpuInput = { name: "cpus", value: "4", min: "1", max: "192" };
  elements.set("#resource-cpus", cpuInput);
  const adjustCpu = async (delta) => elements.get("#usage-panel").listeners.click({ target: { closest: selector => selector === "[data-adjust]" ? { dataset: { adjust: "cpus", delta: String(delta) } } : null } });
  await adjustCpu(1);
  assert.equal(cpuInput.value, "5");
  assert.ok(elements.get("#usage-output").innerHTML.includes("--cpus-per-task=5"));
  cpuInput.value = "192";
  await adjustCpu(1);
  assert.equal(cpuInput.value, "192");
  cpuInput.value = "1";
  await adjustCpu(-1);
  assert.equal(cpuInput.value, "1");
  const toggleWholeNode = async () => elements.get("#usage-panel").listeners.click({ target: { closest: selector => selector === "#whole-node" ? {} : null } });
  await toggleWholeNode();
  assert.ok(elements.get("#resource-form").adjacentHTML.includes('aria-pressed="true"'));
  assert.ok(elements.get("#usage-output").innerHTML.includes("--exclusive"));
  assert.ok(elements.get("#usage-output").innerHTML.includes("--mem=0"));
  assert.ok(elements.get("#usage-panel").innerHTML.includes('value="All available"'));
  await toggleWholeNode();
  assert.ok(!elements.get("#usage-output").innerHTML.includes("--exclusive"));
  assert.ok(elements.get("#usage-output").innerHTML.includes("--cpus-per-task=1"));
  elements.get("#usage-panel").listeners.input({ target: { name: "targetNode", value: "nfh-005" } });
  assert.ok(elements.get("#usage-output").innerHTML.includes("--nodelist=nfh-005"));
  elements.get("#usage-panel").listeners.input({ target: { name: "targetNode", value: "any" } });
  assert.ok(!elements.get("#usage-output").innerHTML.includes("--nodelist="));
  elements.get("#usage-panel").listeners.input({ target: { name: "targetNode", value: "nfh-005" } });
  vm.runInContext("usageMode = 'interactive'; updateUsage();", context);
  assert.ok(elements.get("#usage-output").innerHTML.includes("ssh dev-amd24-h200"));
  assert.ok(elements.get("#usage-output").innerHTML.includes("does not reserve"));
  vm.runInContext("showInspector('gpu');", context);
  assert.equal(elements.get("#usage-panel").hidden, true);
  vm.runInContext("choose('h200-8');", context);
  assert.equal(elements.get("#machine-tabs").hidden, false);
  vm.runInContext("setMachineTab('usage');", context);
  assert.ok(elements.get("#usage-panel").innerHTML.includes('max="8"'));
  assert.ok(elements.get("#usage-output").innerHTML.includes("--constraint=neh"));
  vm.runInContext("choose('h200-4'); setMachineTab('usage');", context);
  assert.ok(elements.get("#usage-panel").innerHTML.includes('value="nfh-005" selected'));
  elements.get("#usage-panel").listeners.input({ target: { name: "targetNode", value: "nfh-000" } });
  vm.runInContext("choose('moria');", context);
  assert.equal(elements.get("#machine-tabs").hidden, true);
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
    vm.runInContext(`choose('${profile.id}'); setMachineTab('usage');`, context);
    assert.equal(elements.get("#usage-panel").hidden, profile.id === "moria");
    if (profile.id !== "moria") {
      const config = usageConfig(profile, profiles);
      assert.ok(!elements.get("#usage-output").innerHTML.includes("undefined"), profile.id);
      assert.equal(elements.get("#usage-panel").innerHTML.includes('name="gpus"'), Boolean(config.maxGpus), profile.id);
      if (profile.mig) assert.ok(!elements.get("#usage-panel").innerHTML.includes('id="whole-node"'));
      if (profile.sourceKey === "development") {
        assert.ok(elements.get("#usage-output").innerHTML.includes(`ssh ${profile.id}`));
        assert.ok(!elements.get("#usage-panel").innerHTML.includes('id="resource-form"'));
        assert.ok(!elements.get("#usage-panel").innerHTML.includes("data-usage-mode"));
        assert.ok(!elements.get("#usage-output").innerHTML.includes("#SBATCH"));
        assert.ok(elements.get("#usage-output").innerHTML.includes("two hours of aggregate CPU time"));
      } else {
        if (config.anyNode && profile.id !== "h200-4") {
          assert.ok(elements.get("#usage-panel").innerHTML.includes('value="any" selected'), profile.id);
          assert.ok(!elements.get("#usage-output").innerHTML.includes("--nodelist="), profile.id);
        } else assert.ok(elements.get("#usage-output").innerHTML.includes(`--nodelist=${config.nodes[0]}`), profile.id);
        vm.runInContext("usageMode = 'interactive'; updateUsage();", context);
        assert.ok(elements.get("#usage-output").innerHTML.includes("--pty /bin/bash"));
        if (config.grace) {
          for (const text of ["Copy setup", "inside the allocated Grace shell", "Compiled", "file ./your_executable", "node-local", "Non-owner jobs", "ICER describes these nodes as beta"]) assert.ok(elements.get("#usage-output").innerHTML.includes(text), text);
          assert.ok(!elements.get("#usage-output").innerHTML.includes("ssh dev-"));
        }
        vm.runInContext("usageMode = 'slurm'; updateUsage();", context);
        assert.ok(elements.get("#usage-output").innerHTML.includes("#SBATCH"));
      }
    }
    for (const view of ["simple", "detailed"]) {
      vm.runInContext(`state.diagramView = '${view}'; choose('${profile.id}'); details();`, context);
      const svg = elements.get("#diagram").innerHTML;
      assert.ok(svg.includes("<svg"), `${profile.id}/${view}`);
      assert.ok(svg.includes('class="topology-note"'));
      if (profile.gpu === "L40S") assert.ok(svg.includes("PCIe · no NVLink."));
      if (profile.gpu === "H200" && profile.nvlink === "Yes") assert.ok(svg.includes("GPU-to-GPU NVLink documented."));
      if (profile.gpu && profile.layout !== "grace-hopper") assert.ok(svg.includes("peer-access support are unverified"));
      if (profile.layout === "grace-hopper") assert.ok(svg.includes("coherent NVLink-C2C"));
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
