import { expandNodes } from "./profiles.js";

export const usageDefaults = { cpus: "4", memory: "32", gpus: "1", time: "01:00:00", account: "", wholeNode: false, workload: "custom" };
export const graceEnvironment = "source /cvmfs/software.eessi.io/versions/2023.06/init/bash && module use /opt/modules/all";

export function graceSetup(workload) {
  return `${graceEnvironment}\nmodule purge\n${workload === "cuda-sample" ? "module load CUDA-Samples\n\n# NVIDIA sample programs supplied by ICER\nmatrixMul\nmatrixMulCUBLAS" : "# Load your ARM-compatible project dependencies here.\n# For code compiled on Grace, load Compiled AFTER those dependencies:\nmodule load Compiled\n\n# Replace this with your actual ARM executable.\n./your_arm_program"}`;
}

function nodeConstraint(profile, nodes) {
  const prefix = nodes[0]?.split("-")[0];
  return profile.cpu === "NVIDIA Grace" ? "NOAUTO:grace" : prefix === "vim" ? "NOAUTO:vim" : ["skl", "nvl"].includes(prefix) ? "intel18" : prefix;
}

function compactNodes(nodes) {
  const groups = new Map();
  for (const node of [...new Set(nodes)].sort()) {
    const match = node.match(/^(.*-)(\d+)$/);
    if (!match) continue;
    const key = `${match[1]}|${match[2].length}`;
    if (!groups.has(key)) groups.set(key, { prefix: match[1], width: match[2].length, numbers: [] });
    groups.get(key).numbers.push(Number(match[2]));
  }
  return [...groups.values()].map(({ prefix, width, numbers }) => {
    const ranges = [];
    const pad = n => String(n).padStart(width, "0");
    for (let i = 0; i < numbers.length; i++) {
      const start = numbers[i];
      while (i + 1 < numbers.length && numbers[i + 1] === numbers[i] + 1) i++;
      ranges.push(start === numbers[i] ? pad(start) : `${pad(start)}-${pad(numbers[i])}`);
    }
    return numbers.length === 1 ? `${prefix}${ranges[0]}` : `${prefix}[${ranges.join(",")}]`;
  }).join(",");
}

export function usageConfig(profile, profiles = []) {
  if (!profile?.group?.startsWith("ICER")) return null;
  const development = profile.sourceKey === "development";
  if (development) return { development: true, target: profile, devNode: profile.id, wholeNode: false };
  const target = profile;
  const nodes = target.nodes?.length ? target.nodes : expandNodes(target.nodeRange);
  const dataMachine = target.group === "ICER · Data Machine";
  const grace = target.cpu === "NVIDIA Grace";
  const constraint = nodeConstraint(target, nodes);
  const memory = target.memory.match(/^([\d.]+)\s*(GB|TB)$/);
  if (!nodes.length || !memory || !constraint) return null;
  const maxMemory = Math.floor(Number(memory[1]) * (memory[2] === "TB" ? 1000 : 1));
  const gpuType = target.mig ? "a100_slice" : target.gpu === "GH200" ? "" : target.gpu?.toLowerCase();
  const devNode = development ? profile.id : grace || dataMachine ? null : target.gpu === "H200" ? "dev-amd24-h200" : ["V100", "V100S"].includes(target.gpu) ? "dev-amd20-v100" : target.gpu ? null : target.cpu.includes("EPYC 9") ? "dev-amd24" : target.cpu.includes("EPYC") ? "dev-amd20" : "dev-intel18";
  const anyNode = nodes.length > 1 && profiles.some(p => p.id === profile.id);
  const allowed = new Set(nodes);
  const excludedNodes = anyNode ? profiles.filter(p => p.group?.startsWith("ICER") && p.sourceKey !== "development").flatMap(p => {
    const candidates = p.nodes?.length ? p.nodes : expandNodes(p.nodeRange);
    return nodeConstraint(p, candidates) === constraint ? candidates.filter(node => !allowed.has(node)) : [];
  }) : [];
  const exclude = compactNodes(excludedNodes);
  const notes = ["Any node lets the scheduler choose one node in this configuration; a particular node pins that host and may mean a longer queue wait. Requests always use --nodes=1, never the whole node range.", "Any-node filtering uses this atlas's static inventory: the configuration's constraint plus exclusions for other listed configurations sharing it. Recheck the request if ICER changes node membership or hardware."];
  if (devNode && !development) notes.push("The suggested development node is for general workflow testing, not a guarantee of matching processors, GPU architecture, or memory. Rebuild or retest on the target hardware when needed.");
  if (grace) notes.push("Requires ARM64/aarch64-compatible software and environments. Non-owner jobs must be less than four hours; supplying an account name does not establish buy-in authorization. Initialize the Grace module environment after allocation; load your project's dependencies and then Compiled for locally compiled code.");
  if (dataMachine) notes.push("Data Machine account membership is required. CPU requests use scheduler CPU units and must be in pairs; these are not a physical-core count. Local NVMe is temporary: stage inputs and save results before the job ends. Burst-buffer setup is not generated here; consult the Data Machine guide.");
  if (target.mig) notes.push("Request allocatable 10 GB A100 MIG slices, not physical GPUs. Slice count follows the published inventory; live partitioning must be verified. Multiple slices do not automatically combine memory or provide full-card performance. Whole-node requests are disabled for this profile.");
  if (target.note) notes.push(target.note);
  return { target, development, dataMachine, grace, nodes, constraint, maxMemory, gpuType, devNode, notes, anyNode, excludedNodes, exclude,
    cpuStep: dataMachine ? 2 : 1, maxCpus: target.cores,
    maxGpus: target.mig ? target.gpuCount * target.slicesPerGpu : target.gpuCount || 0,
    wholeNode: !target.mig, filename: target.id === "h200-4" ? "hopper.sbatch" : `${target.id}.sbatch` };
}

export function usageValuesFor(profile, profiles = []) {
  const config = usageConfig(profile, profiles);
  if (config?.development) return { ...usageDefaults };
  if (config?.grace) return { ...usageDefaults, cpus: config.maxGpus ? "72" : "4", memory: "10", time: "03:00:00", targetNode: config.anyNode ? "any" : config.nodes[0], workload: config.maxGpus ? "cuda-sample" : "custom" };
  return { ...usageDefaults, ...(config ? { cpus: String(Math.min(4, config.maxCpus)), memory: String(Math.min(32, config.maxMemory)), account: config.dataMachine ? "data-machine" : "", targetNode: config.anyNode ? "any" : config.nodes[0] } : {}) };
}

export function buildUsage(profile, values, mode = "slurm", profiles = []) {
  const config = usageConfig(profile, profiles);
  if (!config) return { error: "Usage instructions are available for supported ICER configurations only." };
  if (config.development) {
    if (mode !== "interactive") return { error: "Development nodes use interactive SSH access, not Slurm reservations." };
    if (!/^dev-[A-Za-z0-9-]+$/.test(config.devNode)) return { error: "Invalid development-node hostname." };
    return { code: `ssh ${config.devNode}` };
  }
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
  if (!(node === "any" && config.anyNode) && (!config.nodes.includes(node) || !/^[A-Za-z0-9-]+$/.test(node))) return { error: "Choose Any node or one particular node from this configuration." };
  if (!["slurm", "interactive"].includes(mode)) return { error: "Choose Slurm or Interactive." };
  if (config.grace && (!["custom", "cuda-sample"].includes(values.workload ?? "custom") || (!config.maxGpus && values.workload === "cuda-sample"))) return { error: "Choose a program template supported by this Grace configuration." };
  const cpus = wholeNode ? config.maxCpus : Number(values.cpus);
  const targeting = node === "any" ? (config.exclude ? [`--exclude=${config.exclude}`] : []) : [`--nodelist=${node}`];
  const options = ["--nodes=1", "--ntasks=1", ...(wholeNode ? ["--exclusive"] : []), `--cpus-per-task=${cpus}`, wholeNode ? "--mem=0" : `--mem=${Number(values.memory)}G`, ...(config.maxGpus ? [`--gpus=${config.gpuType ? `${config.gpuType}:` : ""}${wholeNode ? config.maxGpus : Number(values.gpus)}`] : []), `--constraint=${config.constraint}`, ...targeting, `--time=${values.time}`, ...(account ? [`--account=${account}`] : [])];
  const program = config.grace
    ? graceSetup(values.workload).replace(graceEnvironment, `${graceEnvironment} || exit $?`).replace(/^(matrixMul(?:CUBLAS)?|\.\/your_arm_program)$/gm, `srun --cpus-per-task=${cpus} $1`)
    : `# Load your project's modules and activate its environment here.\n# Replace the example below with your actual program.\nsrun --cpus-per-task=${cpus} python your_program.py`;
  return { code: mode === "interactive"
    ? `srun ${options.map(option => /^[A-Za-z0-9_:=./-]+$/.test(option) ? option : `'${option.replaceAll("'", "'\\''")}'`).join(" \\\n  ")} \\\n  --pty /bin/bash`
    : `#!/bin/bash\n#SBATCH --job-name=${config.target.id}\n#SBATCH --output=${config.target.id}-%j.out\n${options.map(option => `#SBATCH ${option}`).join("\n")}\n\nset -e\n${program}\n` };
}
