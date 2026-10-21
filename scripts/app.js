import { prepareProfiles, sidebarSubtitle } from "./profiles.js";
import { buildUsage, usageDefaults } from "./usage.js";
const $ = (selector) => document.querySelector(selector);
const state = { profiles: [], current: null, sidebarMode: readSidebarMode(), diagramView: "simple", local: { integrated: true, npu: false, discrete: false } };

let componentCopy = {};
let hardware = {};
let usageMode = "slurm";
let usageValues = { ...usageDefaults };
let generatedUsage = "";

function setMachineTab(tab) {
  const enabled = state.current?.id === "h200-4";
  const usage = enabled && tab === "usage";
  $("#machine-tabs").hidden = !enabled;
  $("#inspector").hidden = usage;
  $("#usage-panel").hidden = !usage;
  $("#specs-tab").setAttribute("aria-selected", String(!usage));
  $("#usage-tab").setAttribute("aria-selected", String(usage));
  $("#specs-tab").tabIndex = usage ? -1 : 0;
  $("#usage-tab").tabIndex = usage ? 0 : -1;
  if (enabled) {
    $("#inspector").setAttribute("role", "tabpanel");
    $("#inspector").setAttribute("aria-labelledby", "specs-tab");
  } else {
    $("#inspector").removeAttribute("role");
    $("#inspector").removeAttribute("aria-labelledby");
  }
  if (usage) renderUsage();
}

function renderUsage() {
  const field = (key, label, attributes) => {
    const wholeResource = usageValues.wholeNode && ["cpus", "memory", "gpus"].includes(key);
    const displayValue = wholeResource ? { cpus: state.current.cores, memory: "All available", gpus: state.current.gpuCount }[key] : usageValues[key];
    if (wholeResource) attributes = key === "memory" ? 'type="text" disabled' : `${attributes} disabled`;
    const numeric = attributes.includes('type="number"');
    const adjust = (delta, symbol) => `<button type="button" data-adjust="${key}" data-delta="${delta}" aria-label="${delta < 0 ? "Decrease" : "Increase"} ${label}" ${wholeResource ? "disabled" : ""}>${symbol}</button>`;
    return `<div class="resource-field"><label for="resource-${key}">${label}</label><div class="${numeric ? "resource-stepper" : "resource-input"}">${numeric ? adjust(-1, "−") : ""}<input id="resource-${key}" name="${key}" value="${esc(displayValue)}" ${attributes}>${numeric ? adjust(1, "+") : ""}</div></div>`;
  };
  $("#usage-panel").innerHTML = `<div class="resource-builder"><span class="usage-kicker">YOUR WORKSPACE</span><h2>Configure your resources</h2><p>One Genoa + Hopper compute node · request only what your program can use.</p><form id="resource-form"><div class="resource-fields">${field("cpus", "CPU cores", 'type="number" min="1" max="192" step="1" required')}${field("memory", "System RAM (GiB)", 'type="number" min="1" max="768" step="1" required')}${field("gpus", "H200 GPUs", 'type="number" min="1" max="4" step="1" required')}${field("time", "Wall time (HH:MM:SS)", 'type="text" required')}${field("account", "Account (optional)", 'type="text" placeholder="Your Slurm account"')}</div></form><p class="resource-hint">RAM is CPU memory, not GPU memory. Each whole H200 provides 141 GB of GPU memory; GPU memories do not automatically combine. This template uses one task; your application must support multiple CPU cores or GPUs.</p><div class="usage-modes" role="group" aria-label="How to run"><button type="button" data-usage-mode="slurm" aria-pressed="${usageMode === "slurm"}"><strong>Slurm job</strong><span>Submit a script and let it run</span></button><button type="button" data-usage-mode="interactive" aria-pressed="${usageMode === "interactive"}"><strong>Interactive</strong><span>Open a shell and work live</span></button></div></div><div id="usage-output"></div>`;
  updateUsage();
  $("#resource-form").insertAdjacentHTML("afterend", `<details class="whole-node-control" ${usageValues.wholeNode ? "open" : ""}><summary>Advanced · whole-node request</summary><div class="whole-node-options"><button type="button" id="whole-node" aria-pressed="${usageValues.wholeNode}">Whole node <span aria-hidden="true">${usageValues.wholeNode ? "✓" : "+"}</span></button><p>Exclusive access · 192 CPU cores · 4 H200 GPUs · all scheduler-available RAM (--mem=0).</p><p class="whole-node-warning"><strong>This can take a while.</strong> Reserving an entire node can mean a much longer queue wait. Only request it if your workload needs the whole machine.</p></div></details>`);
}

function updateUsage() {
  const result = buildUsage(state.current, usageValues, usageMode);
  generatedUsage = result.code || "";
  const batch = usageMode === "slurm";
  const development = !batch ? `<section class="dev-route"><span class="usage-kicker">JUST TRYING SOMETHING?</span><h3>Quick development · shared node</h3><p>From an ICER gateway, connect with:</p><pre><code>ssh dev-amd24-h200</code></pre><p>This does not reserve the resources selected above. The development node is shared: two hours of aggregate CPU time or GPU access time, and an 80% node-memory cap for processes. Use the reserved session above for longer work or guaranteed allocations.</p></section>` : "";
  const steps = batch
    ? '<li><strong>Save your script</strong><span>Copy into <code>hopper.sbatch</code> on ICER.</span></li><li><strong>Make it yours</strong><span>Replace the example program and add your environment setup.</span></li><li><strong>Submit from a gateway</strong><span><code>sbatch hopper.sbatch</code></span></li>'
    : '<li><strong>Connect to ICER</strong><span>Open a terminal on an ICER gateway.</span></li><li><strong>Request your session</strong><span>Paste the command and wait for allocation before running your program.</span></li><li><strong>Finish cleanly</strong><span>Type <code>exit</code> to release the reserved session.</span></li>';
  $("#usage-output").innerHTML = `
    <section class="generated-job">
      <div class="usage-code-heading"><div><span class="usage-kicker">${batch ? "BATCH WORKFLOW" : "RESERVED WORKSPACE"}</span><h3>${batch ? "Your Slurm script" : "Reserved interactive session"}</h3></div><button type="button" class="secondary" id="copy-usage" ${result.error ? "disabled" : ""}>${batch ? "Copy script" : "Copy command"} <span aria-hidden="true">⧉</span></button></div>
      ${result.error ? `<p class="usage-error" role="alert">${esc(result.error)}</p>` : `<div class="usage-terminal"><div class="terminal-title"><span aria-hidden="true">● ● ●</span>${batch ? "hopper.sbatch" : "ICER gateway · bash"}</div><pre><code>${esc(result.code)}</code></pre></div>`}
      <p id="copy-status" role="status"></p>
      <ol class="usage-steps">${steps}</ol>
    </section>
    ${development}
    <details class="usage-policy"><summary>Before you run · resource limits &amp; access</summary><p>The <code>nfh</code> constraint targets the four-GPU H200 configuration. Requests queue; they do not guarantee immediate availability. Slurm CPUs follow site scheduling configuration. RAM is an inventory ceiling, not a guarantee of allocatable memory; time, account, partition, and access policies may further restrict requests. This is a template, not a submitted or cluster-tested job.</p></details>
    <div class="usage-sources"><a href="https://docs.icer.msu.edu/Requesting_GPUs/" target="_blank" rel="noopener">GPU requests ↗</a><a href="https://docs.icer.msu.edu/Job_Constraints/" target="_blank" rel="noopener">Constraints ↗</a><a href="https://docs.icer.msu.edu/development_nodes/" target="_blank" rel="noopener">Development rules ↗</a></div>`;
}

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function readSidebarMode() {
  try { return localStorage.getItem("compute-sidebar-mode") === "specs" ? "specs" : "workload"; }
  catch { return "workload"; }
}
function setSidebarMode(mode) {
  if (!["workload", "specs"].includes(mode)) return;
  state.sidebarMode = mode;
  try { localStorage.setItem("compute-sidebar-mode", mode); } catch { /* Storage may be unavailable. */ }
  renderList();
}
function subline(p) { return sidebarSubtitle(p, state.sidebarMode); }

async function loadProfiles() {
  const loadJson = async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  };
  const [copy, reference, profileFiles] = await Promise.all([loadJson("data/components.json"), loadJson("data/hardware.json"), loadJson("data/computers.json")]);
  componentCopy = copy;
  hardware = reference;
  const profiles = await Promise.all(profileFiles.map(async (file) => {
    const response = await fetch(`data/computers/${file}.json`);
    if (!response.ok) throw new Error(`Could not load ${file}`);
    return response.json();
  }));
  state.profiles = prepareProfiles(profiles, hardware);
  $("#profile-count").textContent = `${state.profiles.length} configurations · Oct 2026`;
  renderList();
  choose(profiles[0].id);
}

function renderList() {
  document.querySelectorAll("[data-sidebar-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sidebarMode === state.sidebarMode)));
  const query = $("#search").value.trim().toLowerCase();
  const visible = state.profiles.filter((p) => [p.label, p.secondaryLabel, p.group, p.cpu, p.gpu, p.memory, p.cluster, p.nodeRange, sidebarSubtitle(p, "workload"), sidebarSubtitle(p, "specs"), ...p.nodes].filter(Boolean).join(" ").toLowerCase().includes(query));
  const groups = [...new Set(visible.map((p) => p.group))];
  $("#computer-list").innerHTML = visible.length ? groups.map((group) => `<section data-group="${esc(group)}" class="${group === "ICER · Superchips" ? "superchip-group" : ""}"><h2 class="group-title">${esc(group === "ICER · Superchips" ? "Superchips" : group)}</h2>${visible.filter((p) => p.group === group).map((p) => `<button class="computer" data-id="${esc(p.id)}" aria-current="${p.id === state.current?.id}"><span class="profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3M19 9h3m-3 6h3"/></svg></span><span><strong>${esc(p.label)}</strong>${p.secondaryLabel ? `<small class="profile-subname">${esc(p.secondaryLabel)}</small>` : ""}<small>${esc(subline(p))}</small></span></button>`).join("")}</section>`).join("") : '<p class="loading">No matching computers.</p>';
}

function choose(id) {
  state.current = state.profiles.find((p) => p.id === id);
  const p = state.current;
  $("#computer-group").textContent = p.group;
  $("#computer-name").textContent = p.label;
  $("#computer-summary").textContent = p.description;
  $("#architecture").textContent = p.architecture;
  $("#controls").hidden = !p.localOptions;
  renderList();
  renderDiagram();
  showInspector();
  setMachineTab("specs");
}

function part(kind, x, y, width, height, title, subtitle, extra = "") {
  const type = kind === "memory" || kind === "vram" ? "memory" : kind === "npu" ? "accelerator" : kind === "gpu" || kind === "discrete" ? "gpu" : "cpu";
  const icon = type === "accelerator" ? "npu" : type;
  const top = y + (height - 105) / 2;
  return `<g class="part" data-part="${kind}" tabindex="0" role="button" aria-label="${esc(title)}"><rect class="${type}-box" x="${x}" y="${y}" width="${width}" height="${height}" rx="18"/>${extra}<image class="component-icon" href="assets/icons/${icon}.svg" x="${x + width / 2 - 36}" y="${top}" width="72" height="48" aria-hidden="true"/><text class="label" x="${x + width / 2}" y="${top + 75}" text-anchor="middle">${esc(title)}</text><text class="sub" x="${x + width / 2}" y="${top + 101}" text-anchor="middle">${esc(subtitle)}</text></g>`;
}
function wire(path, label, x, y, kind = "interconnect") { return `<path class="wire" d="${path}"/>${label ? `<g class="part" data-part="${kind}" tabindex="0" role="button" aria-label="Explain ${esc(label)}"><rect x="${x - 75}" y="${y - 18}" width="150" height="28" fill="transparent"/><text class="wire-label" x="${x}" y="${y}" text-anchor="middle">${esc(label)} ⓘ</text></g>` : ""}`; }

function localDiagram(p) {
  const blocks = [["cpu", "CPU", p.cpu]];
  if (state.local.integrated) blocks.push(["gpu", "GPU", "Integrated"]);
  if (state.local.npu) blocks.push(["npu", "NPU", "AI accelerator"]);
  const width = 490 / blocks.length;
  let diagram = `<rect class="frame" x="40" y="60" width="600" height="250" rx="25"/><text class="wire-label" x="70" y="90">${esc(p.cpu)} processor</text>`;
  blocks.forEach(([kind, title, subtitle], index) => { diagram += part(kind, 70 + index * (width + 8), 125, width, 130, title, subtitle); });
  diagram += wire("M640 190H720", "", 0, 0) + part("memory", 720, 125, 210, 130, "RAM", "Working data");
  if (state.local.discrete) diagram += wire("M360 310V390H650", "PCIe", 500, 382) + part("discrete", 650, 360, 280, 120, "Separate GPU", "Parallel work") + part("vram", 70, 360, 280, 120, "VRAM", "GPU data") + wire("M350 420H650", "", 0, 0);
  else diagram += '<text class="wire-label" x="500" y="420" text-anchor="middle">One local machine</text>';
  return diagram;
}
function serverDiagram(p) {
  if (p.sockets === 2 && state.diagramView === "detailed") return dualCpuDiagram(p);
  if (!p.gpu) return part("cpu", 80, 160, 340, 190, "CPU", `${p.cores} cores`) + wire("M420 255H575", "", 0, 0) + part("memory", 575, 160, 350, 190, p.memory, "System RAM");
  let diagram = part("cpu", 100, 50, 330, 150, "CPU", `${p.cores} cores`) + wire("M430 125H590", "", 0, 0) + part("memory", 590, 50, 300, 150, p.memory, "System RAM") + wire("M265 200V270H500V300", "PCIe", 500, 263);
  diagram += gpuBank(p, 300);
  return diagram;
}
function gpuBankHeight(p) { return Math.ceil(p.gpuCount / 4) * 140 + 55 + (p.nvlink ? 30 : 0); }
function gpuBank(p, top) {
  const columns = Math.min(p.gpuCount, 4), width = 820 / columns;
  let diagram = `<rect class="frame" x="55" y="${top}" width="890" height="${gpuBankHeight(p)}" rx="25"/><text class="wire-label" x="80" y="${top + 25}">${p.gpuCount} × ${esc(p.gpu)}${p.mig ? " · physical GPUs, each partitioned into slices" : " · conceptual layout"}</text>`;
  for (let i = 0; i < p.gpuCount; i++) diagram += part("gpu", 90 + (i % columns) * width, top + 40 + Math.floor(i / columns) * 140, width - 20, 125, p.gpu, p.mig ? "7 × 10 GB slices" : `GPU ${i + 1} · ${p.vram}`);
  if (p.nvlink) {
    const y = top + gpuBankHeight(p) - 15;
    diagram += wire(`M110 ${y - 17}H890`, `NVLink: ${p.nvlink}`, 500, y, "gpu-interconnect");
  }
  return diagram;
}
function dualCpuDiagram(p) {
  let diagram = `<g class="part" data-part="cpu" tabindex="0" role="button" aria-label="CPU subsystem: two sockets, ${p.cores} physical cores"><rect class="cpu-subsystem" x="45" y="40" width="550" height="280" rx="25"/></g>`
    + `<text class="subsystem-title" x="70" y="75">CPU · 2 ${p.layout === "grace-grace" ? "processors" : "sockets"} · ${p.cores} cores total</text>`
    + part("cpu-0", 75, 110, 210, 180, "CPU 1", `${p.coresPerSocket} cores`)
    + part("cpu-1", 355, 110, 210, 180, "CPU 2", `${p.coresPerSocket} cores`)
    + wire("M285 200H355", "", 0, 0)
    + `<g class="part fabric-link" data-part="cpu-interconnect" tabindex="0" role="button" aria-label="${esc(p.cpuLink || "Infinity Fabric")} CPU-to-CPU connection"><rect x="301" y="113" width="38" height="174" rx="10"/><text transform="translate(325 200) rotate(-90)" text-anchor="middle">${esc(p.cpuLink || "Infinity Fabric")} ⓘ</text></g>`
    + `<rect class="memory-subsystem" x="680" y="40" width="285" height="280" rx="25"/><text class="subsystem-title" x="700" y="75">RAM · ${esc(p.memory)} total</text>`
    + wire("M285 120V95H635V130H705 M565 260H705", "", 0, 0)
    + part("memory", 705, 85, 235, 110, "RAM", "CPU 1 attached")
    + part("memory", 705, 205, 235, 110, "RAM", "CPU 2 attached");
  if (p.gpu) {
    diagram += wire("M320 320V365H500V400", "PCIe", 500, 385) + gpuBank(p, 400);
  } else {
    diagram += `<text class="wire-label" x="500" y="365" text-anchor="middle">${esc(p.cpu)} · one machine, two physical ${p.layout === "grace-grace" ? "processors" : "CPU sockets"}</text>`;
  }
  diagram += `<text class="wire-label" x="500" y="${p.gpu ? 400 + gpuBankHeight(p) + 25 : 405}" text-anchor="middle">Local RAM per CPU · remote access over ${p.cpuLink === "NVLink-C2C" ? "NVLink-C2C" : "xGMI"} · exact memory split not specified</text>`;
  return diagram;
}
function graceDiagram(p) {
  return `<rect class="frame" x="70" y="55" width="860" height="500" rx="25"/><text class="wire-label" x="100" y="88">Grace Hopper Superchip</text>${part("cpu", 115, 130, 300, 165, "Grace CPU", "72 cores")}${part("gpu", 585, 130, 300, 165, "Hopper GPU", "GH200")}${wire("M415 212H585", "NVLink-C2C", 500, 192)}${wire("M265 295V385 M735 295V385", "", 0, 0)}${part("memory", 115, 385, 300, 125, p.memory, "CPU memory")}${part("vram", 585, 385, 300, 125, p.vram, "GPU memory")}`;
}
function superchipGradients() {
  return '<defs><linearGradient id="grace-blue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bcd9fa"/><stop offset=".3" stop-color="#eff7ff"/><stop offset=".48" stop-color="#d7eaff"/><stop offset="1" stop-color="#a8cbee"/></linearGradient><linearGradient id="hopper-purple" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d5c1f4"/><stop offset=".3" stop-color="#faf5ff"/><stop offset=".48" stop-color="#eadcff"/><stop offset="1" stop-color="#c6abe9"/></linearGradient><linearGradient id="memory-green" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bcdfc7"/><stop offset=".3" stop-color="#f0fff4"/><stop offset=".48" stop-color="#d9f1e0"/><stop offset="1" stop-color="#a8d2b6"/></linearGradient><linearGradient id="superchip-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7df"/><stop offset=".45" stop-color="#fffdf7"/><stop offset="1" stop-color="#f7ebcd"/></linearGradient></defs>';
}
function renderDiagram() {
  const p = state.current;
  $("#diagram-view-controls").hidden = p.sockets !== 2;
  document.querySelectorAll("[data-diagram-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.diagramView === state.diagramView)));
  let drawing = p.layout === "local" ? localDiagram(p) : p.layout === "grace-hopper" ? graceDiagram(p) : serverDiagram(p);
  const detailed = p.sockets === 2 && state.diagramView === "detailed";
  const superchip = p.group === "ICER · Superchips";
  if (p.layout === "grace-grace") drawing = (detailed ? '<rect class="frame" x="20" y="15" width="965" height="410" rx="28"/>' : '<rect class="frame" x="45" y="80" width="910" height="430" rx="28"/><text class="subsystem-title" x="75" y="120">Grace–Grace CPU Superchip</text>') + drawing;
  const height = p.gpu && p.layout !== "grace-hopper" ? (detailed ? 400 : 300) + gpuBankHeight(p) + 45 : detailed && !p.gpu ? 430 : 620;
  const topologyNote = p.layout === "grace-hopper"
    ? "Conceptual layout · Grace CPU ↔ Hopper GPU uses coherent NVLink-C2C; not an exact wiring map."
    : p.gpu
      ? `${p.gpu === "L40S" ? "PCIe · no NVLink." : p.nvlink === "Yes" ? "GPU-to-GPU NVLink documented." : "GPU connections are schematic."} Exact wiring and PCIe peer-access support are unverified; no direct-link or switch topology is implied.`
      : "Conceptual layout · exact memory attachment and interconnect wiring are not verified.";
  $("#diagram").innerHTML = `<svg class="${superchip ? "superchip-diagram" : ""}" viewBox="0 0 1000 ${height}" role="img" aria-label="${esc(p.label)} architecture diagram">${superchip ? superchipGradients() : ""}${drawing}</svg><p class="topology-note">${esc(topologyNote)}</p>`;
}

function showInspector(kind) {
  if (kind) setMachineTab("specs");
  const p = state.current;
  const componentKind = kind?.startsWith("cpu-") && kind !== "cpu-interconnect" ? "cpu" : kind;
  const copy = kind ? { ...componentCopy[componentKind], ...p.components?.[componentKind] } : { title: `${p.label} · machine overview`, text: p.description, tidbit: p.tidbit, goodFor: p.goodFor, limitations: p.limitations };
  if (componentKind === "cpu" && kind !== "cpu") copy.title = `CPU ${Number(kind.slice(-1)) + 1} · ${p.cpu}`;
  if (!copy) return;
  const facts = componentFacts(p, kind);
  $("#inspector").innerHTML = `<div class="inspector-heading"><p class="eyebrow">${kind ? "Component details" : "Machine specifications"}</p>${kind ? '<button class="overview-button" id="back-to-overview">Machine overview ↗</button>' : ""}</div><div class="inspector-summary"><h2>${esc(kind ? copy.title : p.label)}</h2></div><dl class="component-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><div class="workload-guidance"><section><h3>Good for</h3><p>${esc(copy.goodFor)}</p></section><section><h3>Not good for</h3><p>${esc(copy.limitations)}</p></section></div>`;
  document.querySelectorAll("[data-part]").forEach((part) => {
    part.classList.toggle("selected", part.dataset.part === kind);
    part.setAttribute("aria-pressed", String(part.dataset.part === kind));
  });
}

function componentFacts(p, kind) {
  if (kind === "cpu-0" || kind === "cpu-1") return [["Processor", p.cpu], ["Physical cores · this chip", p.coresPerSocket], ...(p.id === "moria" ? [["Hardware threads · this chip", p.threadsPerSocket]] : []), ["Cache · this chip", p.cachePerSocket]];
  if (kind === "cpu-interconnect") return [["Connection", p.cpuLink === "NVLink-C2C" ? "NVLink-C2C" : "Infinity Fabric · xGMI"], ["Connects", "CPU 1 ↔ CPU 2"], ["Purpose", "Coherent data and remote-memory access"], ["Physical link count", "Schematic; not an exact wiring map"]];
  if (kind === "cpu") return [["Processor type", p.cpuSpecs?.type || p.cpu], ["Physical cores", p.cpuSpecs?.cores || "Model-dependent"], ...(p.id === "moria" ? [["Thread capability", p.cpuSpecs.threads]] : []), ["Cache", p.cpuSpecs?.cache || "Model-dependent"]];
  if (kind === "gpu" || kind === "discrete") return [["Processor", p.gpu || (kind === "gpu" ? "Integrated GPU" : "Not specified")], ["Physical GPU count", p.gpuCount || "Model-dependent"], ["Memory per physical GPU", p.vram || (kind === "gpu" ? "Shared system RAM" : "Model-dependent")], ...gpuBandwidthFacts(p), ...(p.mig ? [["Allocatable slice", `${p.sliceMemory} · ${p.slicesPerGpu} slices per GPU`]] : []), ["Host data path", p.interconnect || (kind === "discrete" ? "PCIe" : "On-processor")], ...(p.gpuForm ? [["GPU module / card", p.gpuForm]] : []), ...(p.nvlink ? [["GPU-to-GPU NVLink", p.nvlink]] : []), ...(hardware.gpus[p.gpu] ? [["CUDA compute capability", hardware.gpus[p.gpu].capability]] : [])];
  if (kind === "gpu-interconnect") return [["GPU-to-GPU NVLink", p.nvlink], ["GPU count", p.gpuCount], ["Automatic memory pooling", "No"], ["Topology", "Verify on allocated node"]];
  if (kind === "memory") return [["Capacity", p.memory], ["Used by", p.layout === "grace-hopper" ? "Grace CPU / coherent access" : "CPU and host applications"], ["Scope", "Per machine / node"]];
  if (kind === "vram") return [["Capacity per GPU", p.vram || "Model-dependent"], ["Memory type", p.layout === "grace-hopper" ? "HBM (high-bandwidth memory)" : "Dedicated GPU memory"], ...(p.layout === "grace-hopper" ? [["Memory access", "Cache-coherent CPU–GPU access; physically separate memory with different speeds"]] : [["Automatic pooling", "No"]])];
  if (kind === "interconnect") return p.layout === "grace-hopper" ? [["Link", "NVLink-C2C"], ["Connects", "Grace CPU ↔ Hopper GPU"], ["Peak link bandwidth", "900 GB/s aggregate (450 GB/s each direction)"], ["Memory arrangement", "Physically separate, coherently accessible memory"], ["Address space", "Unified CPU–GPU address space with supported software and memory models"]] : [["Link", "PCIe"], ["Generation / lanes", "Not specified here"], ...(p.id === "moria" ? [["GPU-to-GPU NVLink", "Not supported by RTX A4000"]] : [])];
  if (kind === "npu") return [["Device", "Model-dependent NPU"], ["Primary role", "Supported AI inference"], ["Runtime support", "Required"]];
  return [["Processor type", p.cpuSpecs?.type || p.cpu], ["Physical cores", p.cpuSpecs?.cores || "Model-dependent"], ...(p.id === "moria" ? [["Thread capability", p.cpuSpecs.threads]] : []), ["Cache", p.cpuSpecs?.cache || "Model-dependent"], ["System memory", p.memory], ["GPUs", p.gpu ? `${p.gpuCount} × ${p.gpu}` : p.localOptions ? "Configurable example" : "No compute GPU"], ...(p.ssd ? [["Published local storage", p.ssd]] : []), ...(p.nodeRange ? [["Node names", p.nodeRange]] : []), ...(p.nodeCount ? [["Nodes in this group", p.nodeCount]] : [])];
}
function gpuBandwidthFacts(p) {
  const gpu = hardware.gpus[p.gpu];
  return gpu?.memoryBandwidth ? [["GPU memory type", gpu.memoryType], ["Peak local memory bandwidth", gpu.memoryBandwidth], ["V100 / V100S comparison", gpu.bandwidthComparison]] : [];
}
function details() {
  const p = state.current;
  const fields = [["Processor", p.cpu], ["Architecture", p.architecture], ...(p.cores ? [["Physical CPU cores", p.cores]] : []), ...(p.id === "moria" ? [["Scheduler CPU slots", p.threads]] : []), ["Memory", p.memory], ...(p.gpu ? [["GPUs", `${p.gpuCount} × ${p.gpu}`], ["Memory per physical GPU", p.vram]] : []), ...(p.mig ? [["Memory per allocated slice", p.sliceMemory]] : []), ...(p.nodeRange ? [["Node names", p.nodeRange], ["Node count", p.nodeCount]] : []), ...(p.ssd ? [["Published local storage", p.ssd]] : []), ...(p.interconnect ? [["Host connection", p.interconnect]] : []), ...(p.nvlink ? [["GPU-to-GPU NVLink", p.nvlink]] : []), ...(p.group.startsWith("ICER") ? [["Inventory reviewed", p.reviewed], ["Resource scope", "Per node; not a live allocation or availability check"]] : [])];
  fields.push(...gpuBandwidthFacts(p));
  $("#dialog-title").textContent = p.label;
  $("#dialog-content").innerHTML = `<dl class="details-grid">${fields.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>${p.note ? `<p class="dialog-note">${esc(p.note)}</p>` : ""}${p.source?.url ? `<a class="source-link" href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.label)} ↗</a>` : `<p class="dialog-note">${esc(p.source?.label || "")}</p>`}`;
  $("#details-dialog").showModal();
  const specSource = hardware.gpus[p.gpu]?.specSource;
  if (specSource) $("#dialog-content").innerHTML += `<p><a class="source-link" href="${esc(specSource)}" target="_blank" rel="noopener">NVIDIA V100 / V100S specifications ↗</a></p>`;
}

$("#search").addEventListener("input", renderList);
$("#machine-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-machine-tab]");
  if (button) setMachineTab(button.dataset.machineTab);
});
$("#machine-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tab = event.key === "Home" ? "specs" : event.key === "End" ? "usage" : $("#usage-panel").hidden ? "usage" : "specs";
  setMachineTab(tab);
  $(tab === "usage" ? "#usage-tab" : "#specs-tab").focus();
});
$("#usage-panel").addEventListener("submit", (event) => event.preventDefault());
$("#usage-panel").addEventListener("input", (event) => {
  const input = event.target;
  if (Object.hasOwn(usageDefaults, input.name)) {
    usageValues[input.name] = input.value;
    updateUsage();
  }
});
$("#usage-panel").addEventListener("click", async (event) => {
  if (event.target.closest("#whole-node")) {
    usageValues.wholeNode = !usageValues.wholeNode;
    renderUsage();
    $("#whole-node").focus();
  }
  const adjust = event.target.closest("[data-adjust]");
  if (adjust && !usageValues.wholeNode) {
    const input = $(`#resource-${adjust.dataset.adjust}`);
    const current = Number(input.value);
    input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), (Number.isFinite(current) ? current : Number(input.min)) + Number(adjust.dataset.delta))));
    usageValues[input.name] = input.value;
    updateUsage();
  }
  const mode = event.target.closest("[data-usage-mode]");
  if (mode) {
    usageMode = mode.dataset.usageMode;
    renderUsage();
    $(`[data-usage-mode="${usageMode}"]`).focus();
  }
  if (event.target.closest("#copy-usage") && generatedUsage) {
    try {
      await navigator.clipboard.writeText(generatedUsage);
      $("#copy-status").textContent = "Copied.";
    } catch { $("#copy-status").textContent = "Clipboard unavailable. Select and copy the code above."; }
  }
});
$("#sidebar-mode-controls").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sidebar-mode]");
  if (button) setSidebarMode(button.dataset.sidebarMode);
});
$("#diagram-view-controls").addEventListener("click", (event) => {
  const button = event.target.closest("[data-diagram-view]");
  if (!button || !["simple", "detailed"].includes(button.dataset.diagramView)) return;
  state.diagramView = button.dataset.diagramView;
  renderDiagram();
  showInspector();
});
$("#computer-list").addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (button) choose(button.dataset.id); });
$("#diagram").addEventListener("click", (event) => { const target = event.target.closest("[data-part]"); if (target) showInspector(target.dataset.part); });
$("#diagram").addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-part]")) { event.preventDefault(); showInspector(event.target.dataset.part); } });
[["#integrated-gpu", "integrated"], ["#npu", "npu"], ["#discrete-gpu", "discrete"]].forEach(([selector, key]) => $(selector).addEventListener("change", (event) => { state.local[key] = event.target.checked; renderDiagram(); }));
$("#details-button").addEventListener("click", details);
$("#close-dialog").addEventListener("click", () => $("#details-dialog").close());
$("#inspector").addEventListener("click", (event) => { if (event.target.closest("#back-to-overview")) showInspector(); });

loadProfiles().catch((error) => { $("#computer-list").innerHTML = `<p class="loading">Unable to load the computer profiles. Run this site through a web server. (${esc(error.message)})</p>`; });
