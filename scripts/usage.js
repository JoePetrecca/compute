export const usageDefaults = { cpus: "4", memory: "32", gpus: "1", time: "01:00:00", account: "", wholeNode: false };

export function buildUsage(profile, values, mode = "slurm") {
  if (profile.id !== "h200-4") return { error: "This prototype is available on Genoa · Hopper · 4 GPUs only." };
  const integer = (value, max) => /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= max;
  const wholeNode = values.wholeNode === true;
  if (!wholeNode && !integer(values.cpus, profile.cores)) return { error: `Choose 1–${profile.cores} CPU cores.` };
  if (!wholeNode && !integer(values.memory, 768)) return { error: "Choose 1–768 GiB of system RAM. Scheduler-available memory may be lower." };
  if (!wholeNode && !integer(values.gpus, profile.gpuCount)) return { error: `Choose 1–${profile.gpuCount} whole GPUs.` };
  if (!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(values.time) || !/[1-9]/.test(values.time)) return { error: "Enter a positive wall time as HH:MM:SS, for example 01:00:00." };
  const account = String(values.account).trim();
  if (account && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(account)) return { error: "Use only letters, numbers, underscores, and hyphens in the account name." };
  if (!["slurm", "interactive"].includes(mode)) return { error: "Choose Slurm or Interactive." };
  const options = ["--nodes=1", "--ntasks=1", ...(wholeNode ? ["--exclusive"] : []), `--cpus-per-task=${wholeNode ? profile.cores : Number(values.cpus)}`, wholeNode ? "--mem=0" : `--mem=${Number(values.memory)}G`, `--gpus=h200:${wholeNode ? profile.gpuCount : Number(values.gpus)}`, "--constraint=nfh", `--time=${values.time}`, ...(account ? [`--account=${account}`] : [])];
  return { code: mode === "interactive"
    ? `srun ${options.join(" \\\n  ")} \\\n  --pty /bin/bash`
    : `#!/bin/bash\n#SBATCH --job-name=hopper-job\n#SBATCH --output=hopper-%j.out\n${options.map(option => `#SBATCH ${option}`).join("\n")}\n\n# Load your project's modules and activate its environment here.\n# Replace the example below with your actual program.\nsrun python your_program.py\n` };
}
