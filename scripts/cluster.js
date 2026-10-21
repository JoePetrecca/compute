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

// One world-space drawing; shelves pack configurations without replacing any nodes.
export function clusterLayout(inventory) {
  const width = 7600, margin = 36, gap = 24, tileWidth = 148, tileHeight = 104;
  const order = ["ICER · CPU", "ICER · GPU", "ICER · Data Machine", "ICER · Superchips", "ICER · Development"];
  let y = margin;
  const groups = [...inventory.groups].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).map(group => {
    const top = y;
    let x = margin * 2, shelfY = top + 88, shelfHeight = 0;
    const configurations = group.profiles.map(profile => {
      const columns = Math.min(24, Math.max(3, Math.ceil(Math.sqrt(profile.nodes.length) * 1.6)));
      const blockWidth = columns * tileWidth + 24;
      const blockHeight = Math.ceil(profile.nodes.length / columns) * tileHeight + 88;
      if (x + blockWidth > width - margin * 2) {
        x = margin * 2;
        shelfY += shelfHeight + gap;
        shelfHeight = 0;
      }
      const block = { profile, x, y: shelfY, width: blockWidth, height: blockHeight,
        nodes: profile.nodes.map((name, index) => ({ name, x: x + 12 + index % columns * tileWidth, y: shelfY + 70 + Math.floor(index / columns) * tileHeight, width: tileWidth - 8, height: tileHeight - 8 })) };
      x += blockWidth + gap;
      shelfHeight = Math.max(shelfHeight, blockHeight);
      return block;
    });
    y = shelfY + shelfHeight + margin;
    const result = { name: group.name, x: margin, y: top, width: width - margin * 2, height: y - top, configurations };
    y += gap;
    return result;
  });
  return { width, height: y + margin, groups };
}

export function fitCluster(width, height, worldWidth, worldHeight) {
  const scale = Math.min((Math.max(width, 1) - 24) / worldWidth, (Math.max(height, 1) - 24) / worldHeight);
  const safeScale = Math.max(0.001, scale);
  return { scale: safeScale, x: (width - worldWidth * safeScale) / 2, y: (height - worldHeight * safeScale) / 2 };
}

export function zoomCluster(transform, point, factor, min = 0.01, max = 8) {
  const scale = Math.min(max, Math.max(min, transform.scale * factor));
  const ratio = scale / transform.scale;
  return { scale, x: point.x - (point.x - transform.x) * ratio, y: point.y - (point.y - transform.y) * ratio };
}
