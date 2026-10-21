export function expandNodes(range = "") {
  const match = range.replaceAll("–", "-").match(/^([^[]+)\[([^\]]+)\]$/);
  if (!match) return range ? [range] : [];
  return match[2].split(",").flatMap((section) => {
    const [first, last = first] = section.split("-");
    return Array.from({ length: Number(last) - Number(first) + 1 }, (_, index) => match[1] + String(Number(first) + index).padStart(first.length, "0"));
  });
}

export function prepareProfiles(rawProfiles, hardware) {
  return rawProfiles.map((raw) => {
    const parent = raw.inherit ? rawProfiles.find((profile) => profile.id === raw.inherit) : {};
    const p = { ...parent, ...raw };
    p.layout ||= "server";
    p.architecture ||= "x86-64";
    p.source ||= hardware.sources[p.sourceKey];
    p.reviewed = hardware.reviewed;
    p.nodes = expandNodes(p.nodeRange);
    p.nodeCount ||= p.nodes.length;
    const cpu = hardware.cpus[p.cpu];
    if (cpu) {
      const sockets = p.cores / cpu.coresPerSocket;
      p.coresPerSocket ||= cpu.coresPerSocket;
      p.cachePerSocket ||= cpu.cachePerSocket;
      p.cpuSpecs ||= { type: `${sockets} × ${p.cpu} · ${cpu.generation}`, cores: `${p.cores} total · ${cpu.coresPerSocket} per CPU`, cache: `${cpu.cachePerSocket} per CPU` };
      if (p.cpu.startsWith("AMD EPYC") && sockets === 2) p.sockets = 2;
    }
    if (p.cpu === "NVIDIA Grace") p.cpuSpecs ||= { type: `${p.cores === 144 ? "2 × " : ""}NVIDIA Grace · Arm Neoverse V2`, cores: p.cores === 144 ? "144 total · 72 per CPU" : "72", cache: "1 MB L2 per core · 117 MB L3 per CPU" };
    if (p.sockets === 2 && p.cpu.startsWith("AMD")) p.cpuLink = "Infinity Fabric";
    p.description ||= `${p.nodeRange} · ${p.cores} physical cores · ${p.memory} RAM${p.gpu ? ` · ${p.gpuCount} × ${p.gpu}` : ""}.`;
    const gpu = hardware.gpus[p.gpu];
    p.interconnect ||= p.gpu ? "PCIe" : undefined;
    p.goodFor ||= gpu?.goodFor || "Parallel CPU simulations, numerical analysis, preprocessing, and independent batch jobs that fit the node’s memory.";
    p.limitations ||= gpu?.limitations || "GPU-only workloads and expecting serial code to use every CPU core. Request enough RAM for the working set; extra capacity alone does not guarantee more speed.";
    p.components = { ...p.components };
    p.components.cpu = { goodFor: "Parallel CPU analysis, data preparation, numerical libraries, and independent tasks.", limitations: p.architecture === "ARM64" ? "x86-only binaries; use ARM64-compatible dependencies. Serial work cannot use all cores automatically." : "Serial bottlenecks and code requiring instructions unavailable on this CPU.", ...p.components.cpu };
    if (gpu) p.components.gpu = { title: `${p.gpu} · ${gpu.architecture}`, goodFor: gpu.goodFor, limitations: gpu.limitations, ...p.components.gpu };
    if (p.mig) p.components.gpu = { title: "A100 · partitioned GPU", goodFor: p.goodFor, limitations: p.limitations };
    if (p.sockets === 2 && !p.components["cpu-interconnect"]) {
      p.components["cpu-interconnect"] = { title: p.cpuLink, goodFor: "Coherent data exchange between the two processors and access to memory attached to either CPU.", limitations: "Remote memory can be slower than local memory. The grouped enclosure represents two physical processors, not one chip." };
    }
    if (p.nvlink) {
      p.components["gpu-interconnect"] = { title: "GPU-to-GPU connection", goodFor: p.nvlink === "Yes" ? "Exchanging data in explicitly parallel multi-GPU workloads using NVLink." : "Independent GPU tasks and communication that fits the available PCIe topology.", limitations: "Does not automatically combine GPU memory. Actual links, routing, peer access, and partitioning must be checked on the allocated node." };
    }
    if (p.sourceKey === "development") {
      p.goodFor = "Compiling, debugging, and short CPU or GPU tests before submitting scheduled compute jobs.";
      p.limitations = "Long-running production jobs or monopolizing a shared node. ICER enforces a two-hour aggregate CPU-time limit, a two-hour GPU-time limit, and an 80% memory cap.";
      for (const key of ["cpu", "gpu"]) if (p.components[key]) p.components[key] = { ...p.components[key], goodFor: `Short development tests. ${p.components[key].goodFor}`, limitations: p.limitations };
      p.note ||= "Shared development resources: two hours of aggregate CPU usage or GPU access time; processes exceeding the 80% memory cap are killed. Full-node capacity is not a private allocation.";
    }
    return p;
  });
}
