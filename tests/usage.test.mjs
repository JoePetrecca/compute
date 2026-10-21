import assert from "node:assert/strict";
import test from "node:test";
import { buildUsage, usageDefaults } from "../scripts/usage.js";

const profile = { id: "h200-4", cores: 192, gpuCount: 4 };

test("batch template targets one nfh node with typed GPUs and total system memory", () => {
  const { code, error } = buildUsage(profile, usageDefaults);
  assert.equal(error, undefined);
  for (const option of ["--nodes=1", "--ntasks=1", "--cpus-per-task=4", "--mem=32G", "--gpus=h200:1", "--constraint=nfh", "--time=01:00:00"]) assert.ok(code.includes(`#SBATCH ${option}`));
  assert.ok(code.includes("srun python your_program.py"));
  assert.ok(!code.includes("--mem-per-gpu"));
  assert.ok(!code.includes("--account="));
});

test("interactive command uses edited resources and an optional safe account", () => {
  const { code } = buildUsage(profile, { ...usageDefaults, cpus: "8", memory: "64", gpus: "2", time: "02:30:00", account: "lab-account" }, "interactive");
  assert.ok(code.startsWith("srun "));
  for (const option of ["--cpus-per-task=8", "--mem=64G", "--gpus=h200:2", "--time=02:30:00", "--account=lab-account", "--pty /bin/bash"]) assert.ok(code.includes(option));
  assert.ok(!code.includes("#SBATCH"));
});

test("invalid requests and shell injection cannot produce runnable templates", () => {
  for (const [key, value] of [["cpus", "0"], ["cpus", "193"], ["cpus", "1.5"], ["cpus", "4;id"], ["memory", ""], ["memory", "769"], ["gpus", "0"], ["gpus", "5"], ["time", "00:00:00"], ["time", "01:60:00"], ["time", "01:00:00\nwhoami"], ["account", "lab;id"], ["account", "lab\n#SBATCH --exclusive"]]) {
    const result = buildUsage(profile, { ...usageDefaults, [key]: value });
    assert.ok(result.error, `${key}: ${value}`);
    assert.equal(result.code, undefined);
  }
  assert.ok(buildUsage({ ...profile, id: "h200-8" }, usageDefaults).error);
  assert.ok(buildUsage(profile, usageDefaults, "unknown").error);
});
