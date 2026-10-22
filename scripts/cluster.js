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

// Bottom-left packing lets short blocks fill gaps beside taller neighbors.
function packBlocks(blocks, limit, gap) {
  const placed = [];
  for (const block of [...blocks].sort((a, b) => b.height - a.height || b.width - a.width)) {
    const xs = [0, ...placed.map(p => p.x + p.width + gap)];
    const ys = [0, ...placed.map(p => p.y + p.height + gap)];
    let best;
    for (const y of ys) for (const x of xs) {
      if (x + block.width > limit) continue;
      if (placed.some(p => x < p.x + p.width + gap && x + block.width + gap > p.x && y < p.y + p.height + gap && y + block.height + gap > p.y)) continue;
      if (!best || y < best.y || y === best.y && x < best.x) best = { x, y };
    }
    placed.push({ ...block, ...best });
  }
  return { blocks: placed, width: Math.max(0, ...placed.map(p => p.x + p.width)), height: Math.max(0, ...placed.map(p => p.y + p.height)) };
}

function compactBlocks(blocks, gap, aspect) {
  if (!blocks.length) return { blocks: [], width: 0, height: 0 };
  const minimum = Math.max(...blocks.map(b => b.width));
  const maximum = blocks.reduce((sum, b) => sum + b.width + gap, 0);
  let best, bestScore = Infinity;
  for (let step = 0; step <= 24; step++) {
    const layout = packBlocks(blocks, minimum + (maximum - minimum) * step / 24, gap);
    const score = layout.width * layout.height * (1 + 0.3 * Math.abs(Math.log(layout.width / layout.height / aspect)));
    if (score < bestScore) { best = layout; bestScore = score; }
  }
  return best;
}

// Pack both configurations and family islands; bounds follow the actual content.
export function clusterLayout(inventory) {
  const margin = 6, gap = 8, tileWidth = 138, tileHeight = 90;
  const order = ["ICER · CPU", "ICER · GPU", "ICER · Data Machine", "ICER · Superchips", "ICER · Development"];
  const families = [];
  for (const category of [...inventory.groups].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))) {
    for (const profile of category.profiles) {
      const label = category.name === "ICER · Development" ? "Development" : profile.label.split(" · ")[0];
      let family = families.find(group => group.name === category.name && group.label === label);
      if (!family) { family = { name: category.name, label, profiles: [] }; families.push(family); }
      family.profiles.push(profile);
    }
  }
  const islands = families.map(group => {
    const blocks = group.profiles.map(profile => {
      const count = profile.nodes.length;
      const ideal = Math.sqrt(count * 1.2);
      let columns = 1, score = Infinity;
      for (let candidate = 1; candidate <= Math.min(count, 20); candidate++) {
        const waste = candidate * Math.ceil(count / candidate) / count;
        const value = waste + 0.2 * Math.abs(Math.log(candidate / ideal));
        if (value < score) { columns = candidate; score = value; }
      }
      return { profile, columns, width: columns * tileWidth + 4, height: Math.ceil(count / columns) * tileHeight + 38 };
    });
    const packed = compactBlocks(blocks, 6, 1.5);
    return { name: group.name, label: group.label, configurations: packed.blocks, width: packed.width + 12, height: packed.height + 34 };
  });
  const packed = compactBlocks(islands, gap, 1.8);
  const groups = packed.blocks.map(group => {
    const x = group.x + margin, y = group.y + margin;
    const configurations = group.configurations.map(block => {
      const bx = x + 6 + block.x, by = y + 28 + block.y;
      return { ...block, x: bx, y: by, nodes: block.profile.nodes.map((name, index) => ({
        name, x: bx + 2 + index % block.columns * tileWidth, y: by + 36 + Math.floor(index / block.columns) * tileHeight,
        width: tileWidth - 2, height: tileHeight - 2
      })) };
    });
    return { ...group, x, y, configurations };
  });
  return { width: packed.width + margin * 2, height: packed.height + margin * 2, groups };
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
