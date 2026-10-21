import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { prepareProfiles, expandNodes } from "../scripts/profiles.js";
import { buildUsage, usageDefaults, usageConfig, usageValuesFor, graceSetup } from "../scripts/usage.js";

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const ids = await json("data/computers.json");
const profiles = prepareProfiles(await Promise.all(ids.map(id => json(`data/computers/${id}.json`))), await json("data/hardware.json"));
const profile = profiles.find(p => p.id === "h200-4");

test("every ICER configuration has correct SSH or single-node scheduled access", () => {
  assert.equal(profiles.filter(p => usageConfig(p, profiles)).length, 36);
  for (const p of profiles) {
    if (p.id === "moria") {
      assert.equal(usageConfig(p, profiles), null);
      assert.ok(buildUsage(p, usageDefaults).error);
      continue;
    }
    const config = usageConfig(p, profiles);
    const values = usageValuesFor(p, profiles);
    if (config.development) {
      assert.equal(buildUsage(p, values, "interactive").code, `ssh ${p.id}`);
      execFileSync("bash", ["-n"], { input: buildUsage(p, values, "interactive").code });
      assert.ok(buildUsage(p, values, "slurm").error);
      continue;
    }
    for (const mode of ["slurm", "interactive"]) {
      const { code, error } = buildUsage(p, values, mode, profiles);
      assert.equal(error, undefined, p.id);
      assert.ok(code.includes("--nodes=1"));
      if (config.anyNode) {
        assert.equal(values.targetNode, "any");
        assert.ok(!code.includes("--nodelist="));
        if (config.exclude) assert.ok(code.includes(`--exclude=${config.exclude}`));
      } else assert.ok(code.includes(`--nodelist=${config.nodes[0]}`));
      assert.ok(!code.includes("undefined") && !code.includes("NaN"));
      assert.equal(code.includes("--gpus="), Boolean(config.maxGpus), p.id);
      assert.ok(!code.includes("--nodelist=dev-"));
      execFileSync("bash", ["-n"], { input: code });
      const node = config.nodes.at(-1);
      assert.ok(buildUsage(p, { ...values, targetNode: node }, mode, profiles).code.includes(`--nodelist=${node}`));
    }
  }
});

test("any-node filtering keeps exactly the selected class within the published inventory", () => {
  for (const p of profiles) {
    const config = usageConfig(p, profiles);
    if (!config?.anyNode) continue;
    const excluded = new Set(config.excludedNodes);
    const familyNodes = profiles.flatMap(other => {
      const candidate = usageConfig(other, profiles);
      return candidate && !candidate.development && candidate.constraint === config.constraint ? candidate.nodes : [];
    });
    assert.deepEqual(new Set(familyNodes.filter(node => !excluded.has(node))), new Set(config.nodes), p.id);
    const expanded = config.exclude ? config.exclude.split(/,(?![^\[]*\])/).flatMap(expandNodes) : [];
    assert.deepEqual(new Set(expanded), excluded, p.id);
    const values = { ...usageValuesFor(p, profiles), wholeNode: true };
    if (config.wholeNode) {
      const code = buildUsage(p, values, "slurm", profiles).code;
      assert.ok(code.includes("--nodes=1") && code.includes("--exclusive"));
      assert.ok(!code.includes("--nodelist="));
    }
  }
  const grace = profiles.find(p => p.id === "grace-hopper");
  assert.deepEqual(new Set(usageConfig(grace, profiles).excludedNodes), new Set(["nch-003", "ncc-000"]));
  const genoa = profiles.find(p => p.id === "genoa-768");
  assert.ok(usageConfig(genoa, profiles).excludedNodes.includes("agg-048"));
  assert.ok(!usageConfig(genoa, profiles).excludedNodes.includes("agg-000"));
  const interactive = buildUsage(genoa, usageValuesFor(genoa, profiles), "interactive", profiles).code;
  const args = execFileSync("bash", ["-c", `srun() { printf '%s\\n' "$@"; }\n${interactive}`], { encoding: "utf8" }).trim().split("\n");
  assert.ok(args.includes(`--exclude=${usageConfig(genoa, profiles).exclude}`));
  assert.ok(args.includes("--nodes=1"));
  assert.ok(!args.some(arg => arg.startsWith("--nodelist=")));
  const single = profiles.find(p => p.id === "grace-grace");
  assert.ok(buildUsage(single, { ...usageValuesFor(single, profiles), targetNode: "any" }, "slurm", profiles).error);
});

test("Hopper templates preserve typed GPUs, system memory and CPU count on job steps", () => {
  const { code, error } = buildUsage(profile, usageDefaults);
  assert.equal(error, undefined);
  for (const option of ["--nodes=1", "--ntasks=1", "--cpus-per-task=4", "--mem=32G", "--gpus=h200:1", "--constraint=nfh", "--time=01:00:00"]) assert.ok(code.includes(`#SBATCH ${option}`));
  assert.ok(code.includes("srun --cpus-per-task=4 python your_program.py"));
  assert.ok(!code.includes("--mem-per-gpu"));
  assert.ok(!code.includes("--account="));
  const interactive = buildUsage(profile, { ...usageDefaults, cpus: "8", memory: "64", gpus: "2", time: "02:30:00", account: "lab-account" }, "interactive").code;
  for (const option of ["--cpus-per-task=8", "--mem=64G", "--gpus=h200:2", "--time=02:30:00", "--account=lab-account", "--pty /bin/bash"]) assert.ok(interactive.includes(option));
});

test("invalid requests and shell injection cannot produce runnable templates", () => {
  for (const [key, value] of [["cpus", "0"], ["cpus", "193"], ["cpus", "1.5"], ["cpus", "4;id"], ["memory", ""], ["memory", "769"], ["gpus", "0"], ["gpus", "5"], ["time", "00:00:00"], ["time", "01:60:00"], ["time", "01:00:00\nwhoami"], ["account", "lab;id"], ["account", "lab\n#SBATCH --exclusive"], ["targetNode", "nfh-000;id"], ["targetNode", "nfh-[000-005]"], ["targetNode", "neh-000"]]) {
    const result = buildUsage(profile, { ...usageDefaults, [key]: value });
    assert.ok(result.error, `${key}: ${value}`);
    assert.equal(result.code, undefined);
  }
  assert.ok(buildUsage(profile, usageDefaults, "unknown").error);
});

test("whole-node requests are exclusive except for MIG and preserve custom settings", () => {
  for (const p of profiles.filter(p => p.group.startsWith("ICER"))) {
    const config = usageConfig(p, profiles);
    if (config.development) continue;
    const values = { ...usageValuesFor(p, profiles), wholeNode: true };
    const before = { ...values };
    for (const mode of ["slurm", "interactive"]) {
      const result = buildUsage(p, values, mode, profiles);
      if (p.mig) { assert.ok(result.error); continue; }
      assert.ok(!result.error, p.id);
      for (const option of ["--exclusive", `--cpus-per-task=${config.maxCpus}`, "--mem=0"]) assert.ok(result.code.includes(option));
      if (config.maxGpus) assert.ok(result.code.includes(`--gpus=${config.gpuType ? config.gpuType + ":" : ""}${config.maxGpus}`));
      assert.deepEqual(values, before);
    }
  }
});

test("Data Machine requires its account, paired CPU units and proper MIG resources", () => {
  for (const id of ["data-cpu", "data-gpu", "data-mig"]) {
    const p = profiles.find(p => p.id === id);
    const values = usageValuesFor(p, profiles);
    assert.equal(values.account, "data-machine");
    assert.ok(buildUsage(p, { ...values, account: "" }, "slurm", profiles).error);
    assert.ok(buildUsage(p, { ...values, cpus: "3" }, "slurm", profiles).error);
    assert.ok(buildUsage(p, values, "slurm", profiles).code.includes("--account=data-machine"));
  }
  const p = profiles.find(p => p.id === "data-mig");
  assert.equal(usageConfig(p).maxGpus, 28);
  assert.ok(buildUsage(p, usageValuesFor(p)).code.includes("--gpus=a100_slice:1"));
  assert.ok(buildUsage(p, { ...usageValuesFor(p), gpus: "29" }).error);
});

test("Grace uses ARM setup, special constraints and untargeted GPU type; CPU Grace has no GPU", () => {
  for (const id of ["grace-hopper", "grace-hopper-003", "grace-grace"]) {
    const p = profiles.find(p => p.id === id);
    const values = usageValuesFor(p);
    const { code } = buildUsage(p, values);
    assert.ok(code.includes("--constraint=NOAUTO:grace"));
    assert.ok(code.includes("source /cvmfs/software.eessi.io/versions/2023.06/init/bash"));
    assert.equal(code.includes("--gpus=1"), id !== "grace-grace");
    assert.ok(buildUsage(p, { ...values, time: "04:00:00" }).error);
    assert.equal(values.time, "03:00:00");
    assert.equal(values.memory, "10");
    if (p.gpu) {
      assert.equal(values.cpus, "72");
      assert.ok(code.includes("module load CUDA-Samples"));
      assert.ok(code.includes("srun --cpus-per-task=72 matrixMulCUBLAS"));
      assert.ok(!code.includes("python your_program.py"));
      const custom = buildUsage(p, { ...values, workload: "custom" }).code;
      assert.ok(custom.includes("module load Compiled"));
      assert.ok(custom.includes("./your_arm_program"));
    } else assert.ok(buildUsage(p, { ...values, workload: "cuda-sample" }).error);
    execFileSync("bash", ["-n"], { input: graceSetup(values.workload) });
  }
  for (const p of profiles.filter(p => p.id.startsWith("vim-"))) assert.ok(buildUsage(p, usageValuesFor(p)).code.includes("--constraint=NOAUTO:vim"));
});

test("development pages are SSH-only, with no batch or whole-node reservations", () => {
  for (const p of profiles.filter(p => p.sourceKey === "development")) {
    const config = usageConfig(p, profiles);
    assert.equal(config.target.id, p.id);
    assert.equal(config.devNode, p.id);
    assert.equal(config.wholeNode, false);
    assert.equal(buildUsage(p, usageValuesFor(p), "interactive").code, `ssh ${p.id}`);
    assert.ok(buildUsage(p, { ...usageDefaults, wholeNode: true }, "slurm").error);
  }
});
