export function clusterInventory(profiles) {
  const configurations = profiles.filter(p => p.group?.startsWith("ICER"));
  const compute = configurations.filter(p => p.sourceKey !== "development");
  const development = configurations.filter(p => p.sourceKey === "development");
  const count = entries => entries.reduce((total, p) => total + p.nodes.length, 0);
  return {
    configurations,
    groups: [...new Set(configurations.map(p => p.group))].map(name => ({ name, profiles: configurations.filter(p => p.group === name) })),
    totalNodes: count(configurations), computeNodes: count(compute), developmentNodes: count(development),
    physicalCores: compute.reduce((total, p) => total + p.cores * p.nodes.length, 0),
    physicalGpus: compute.reduce((total, p) => total + (p.gpuCount || 0) * p.nodes.length, 0)
  };
}
