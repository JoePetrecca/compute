import { expandNodes } from "./profiles.js";

export const usageDefaults = { cpus: "4", memory: "32", gpus: "1", time: "01:00:00", account: "", wholeNode: false };

const developmentTargets = {
  "dev-amd24": "genoa-768", "dev-amd24-h200": "h200-4", "dev-amd20": "rome-996",
  "dev-amd20-v100": "v100s", "dev-intel18": "skl-367"
};

export function usageConfig(profile, profiles = []) {
  if (!profile?.group?.startsWith("ICER")) return null;
  const development = profile.sourceKey === "development";
  const target = development ? profiles.find(p => p.id === developmentTargets[profile.id]) : profile;
  if (!target) return null;
  const nodes = target.nodes?.length ? target.nodes : expandNodes(target.nodeRange);
  const dataMachine = target.group === "ICER · Data Machine";
  const grace = target.cpu === "NVIDIA Grace";
  const prefix = nodes[0]?.split("-")[0];
  const constraint = grace ? "NOAUTO:grace" : prefix === "vim" ? "NOAUTO:vim" : ["skl", "nvl"].includes(prefix) ? "intel18" : prefix;
  const memory = target.memory.match(/^([\d.]+)\s*(GB|TB)$/);
  if (!nodes.length || !memory || !constraint) return null;
  const maxMemory = Math.floor(Number(memory[1]) * (memory[2] === "TB" ? 1000 : 1));
  const gpuType = target.mig ? "a100_slice" : target.gpu === "GH200" ? "" : target.gpu?.toLowerCase();
  const devNode = development ? profile.id : grace || dataMachine ? null : target.gpu === "H200" ? "dev-amd24-h200" : ["V100", "V100S"].includes(target.gpu) ? "dev-amd20-v100" : target.gpu ? null : target.cpu.includes("EPYC 9") ? "dev-amd24" : target.cpu.includes("EPYC") ? "dev-amd20" : "dev-intel18";
  const notes = ["One target node is pinned from this configuration. A busy node can mean a longer wait; choose another listed node if appropriate."];
  if (development) notes.push(`The controls reserve resources on ${target.label}, not on the shared development node. Its CPU, RAM, and GPU configuration may differ from ${profile.id}.`);
  if (devNode && !development) notes.push("The suggested development node is for general workflow testing, not a guarantee of matching processors, GPU architecture, or memory. Rebuild or retest on the target hardware when needed.");
  if (grace) notes.push("Requires ARM64/aarch64-compatible software and environments. Non-owner jobs must be less than four hours; supplying an account name does not establish buy-in authorization. Initialize the Grace module environment after allocation; load your project's dependencies and then Compiled for locally compiled code.");
  if (dataMachine) notes.push("Data Machine account membership is required. CPU requests use scheduler CPU units and must be in pairs; these are not a physical-core count. Local NVMe is temporary: stage inputs and save results before the job ends. Burst-buffer setup is not generated here; consult the Data Machine guide.");
  if (target.mig) notes.push("Request allocatable 10 GB A100 MIG slices, not physical GPUs. Slice count follows the published inventory; live partitioning must be verified. Multiple slices do not automatically combine memory or provide full-card performance. Whole-node requests are disabled for this profile.");
  if (target.note) notes.push(target.note);
  return { target, development, dataMachine, grace, nodes, constraint, maxMemory, gpuType, devNode, notes,
    cpuStep: dataMachine ? 2 : 1, maxCpus: target.cores,
    maxGpus: target.mig ? target.gpuCount * target.slicesPerGpu : target.gpuCount || 0,
    wholeNode: !target.mig, filename: target.id === "h200-4" ? "hopper.sbatch" : `${target.id}.sbatch` };
}

export function usageValuesFor(profile, profiles = []) {
  const config = usageConfig(profile, profiles);
  return { ...usageDefaults, ...(config ? { cpus: String(Math.min(4, config.maxCpus)), memory: String(Math.min(32, config.maxMemory)), account: config.dataMachine ? "data-machine" : "", targetNode: config.nodes[0] } : {}) };
}

export function buildUsage(profile, values, mode = "slurm", profiles = []) {
  const config = usageConfig(profile, profiles);
  if (!config) return { error: "Usage instructions are available for supported ICER configurations only." };
  const integer = (value, max) => /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= max;
  const wholeNode = values.wholeNode === true;
  if (wholeNode && !config.wholeNode) return { error: "Whole-node requests are not supported for this MIG-slice profile." };
  if (!wholeNode && !integer(values.cpus, config.maxCpus)) return { error: `Choose 1–${config.maxCpus} ${config.dataMachine ? "scheduler CPUs" : "CPU cores"}.` };
  if (!wholeNode && Number(values.cpus) % config.cpuStep) return { error: "Data Machine CPU requests must be in pairs (2, 4, 6, …)." };
  if (!wholeNode && !integer(values.memory, config.maxMemory)) return { error: `Choose 1–${config.maxMemory} GiB of system RAM. This is an approximate inventory ceiling; scheduler-available memory may be lower.` };
  if (!wholeNode && config.maxGpus && !integer(values.gpus, config.maxGpus)) return { error: `Choose 1–${config.maxGpus} ${config.target.mig ? "MIG slices" : "whole GPUs"}.` };
  if (!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(values.time) || !/[1-9]/.test(values.time)) return { error: "Enter a positive wall time as HH:MM:SS, for example 01:00:00." };
  const account = String(values.account ?? "").trim();
  if (account && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(account)) return { error: "Use only letters, numbers, underscores, and hyphens in the account name." };
  if (config.dataMachine && account !== "data-machine") return { error: "Use the data-machine account; approved account membership is required." };
  if (config.grace && !account && Number(values.time.split(":")[0]) >= 4) return { error: "Grace non-owner jobs must be less than four hours. Shorten the time or supply your authorized buy-in account." };
  const node = values.targetNode ?? config.nodes[0];
  if (!config.nodes.includes(node) || !/^[A-Za-z0-9-]+$/.test(node)) return { error: "Choose one target node from this configuration." };
  if (!["slurm", "interactive"].includes(mode)) return { error: "Choose Slurm or Interactive." };
  const cpus = wholeNode ? config.maxCpus : Number(values.cpus);
  const options = ["--nodes=1", "--ntasks=1", ...(wholeNode ? ["--exclusive"] : []), `--cpus-per-task=${cpus}`, wholeNode ? "--mem=0" : `--mem=${Number(values.memory)}G`, ...(config.maxGpus ? [`--gpus=${config.gpuType ? `${config.gpuType}:` : ""}${wholeNode ? config.maxGpus : Number(values.gpus)}`] : []), `--constraint=${config.constraint}`, `--nodelist=${node}`, `--time=${values.time}`, ...(account ? [`--account=${account}`] : [])];
  const setup = config.grace ? "# Initialize the ARM-compatible Grace module environment.\nsource /cvmfs/software.eessi.io/versions/2023.06/init/bash\nmodule use /opt/modules/all\n# Load project dependencies, then Compiled for locally compiled programs.\n" : "";
  return { code: mode === "interactive"
    ? `srun ${options.join(" \\\n  ")} \\\n  --pty /bin/bash`
    : `#!/bin/bash\n#SBATCH --job-name=${config.target.id}\n#SBATCH --output=${config.target.id}-%j.out\n${options.map(option => `#SBATCH ${option}`).join("\n")}\n\n${setup}# Load your project's modules and activate its environment here.\n# Replace the example below with your actual program.\nsrun --cpus-per-task=${cpus} python your_program.py\n` };
}
