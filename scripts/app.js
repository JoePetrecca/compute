const profileFiles = ["intel", "amd", "moria", "grace-hopper", "acm"];
const $ = (selector) => document.querySelector(selector);
const state = { profiles: [], current: null, local: { integrated: true, npu: false, discrete: false } };

const componentCopy = {
  cpu: ["CPU", "Runs code, prepares data, and handles general computation. More cores help work that can run in parallel; they do not speed up every task automatically."],
  gpu: ["GPU", "Runs supported parallel workloads such as training, inference, simulation, and rendering. The application needs a compatible GPU software path."],
  memory: ["System memory", "Holds the data and working state used by the CPU. Capacity determines how much can fit at once; capacity alone does not determine speed."],
  vram: ["GPU memory", "Holds models and data used by the GPU. It is a separate physical pool from ordinary system memory on these systems."],
  npu: ["AI accelerator", "Efficiently runs supported neural-network inference. It is not a general replacement for a GPU or automatic acceleration for arbitrary code."],
  interconnect: ["Processor connection", "This is the path data follows between processors. The link improves supported communication, but does not make every memory pool equally fast."],
  discrete: ["Separate GPU", "An additional processor with its own GPU memory for compatible parallel workloads."]
};

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function subline(p) { return p.gpu ? `${p.cores ? `${p.cores} cores · ` : ""}${p.gpuCount}× ${p.gpu}` : p.cores ? `${p.cores} cores · ${p.memory}` : "Configurable local machine"; }

async function loadProfiles() {
  const profiles = await Promise.all(profileFiles.map(async (file) => {
    const response = await fetch(`data/computers/${file}.json`);
    if (!response.ok) throw new Error(`Could not load ${file}`);
    return response.json();
  }));
  state.profiles = profiles;
  renderList();
  choose(profiles[0].id);
}

function renderList() {
  const query = $("#search").value.trim().toLowerCase();
  const visible = state.profiles.filter((p) => [p.label, p.group, p.cpu, p.gpu, p.nodeRange].filter(Boolean).join(" ").toLowerCase().includes(query));
  const groups = [...new Set(visible.map((p) => p.group))];
  $("#computer-list").innerHTML = visible.length ? groups.map((group) => `<section><h2 class="group-title">${esc(group)}</h2>${visible.filter((p) => p.group === group).map((p) => `<button class="computer" data-id="${esc(p.id)}" aria-current="${p.id === state.current?.id}"><strong>${esc(p.label)}</strong><small>${esc(subline(p))}</small></button>`).join("")}</section>`).join("") : '<p class="loading">No matching computers.</p>';
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
}

function part(kind, x, y, width, height, title, subtitle, extra = "") {
  return `<g class="part" data-part="${kind}" tabindex="0" role="button" aria-label="${esc(title)}"><rect class="${kind === "memory" || kind === "vram" ? "memory" : kind === "npu" ? "accelerator" : kind === "gpu" || kind === "discrete" ? "gpu" : "cpu"}-box" x="${x}" y="${y}" width="${width}" height="${height}" rx="18"/>${extra}<text class="label" x="${x + width / 2}" y="${y + height / 2 - 4}" text-anchor="middle">${esc(title)}</text><text class="sub" x="${x + width / 2}" y="${y + height / 2 + 24}" text-anchor="middle">${esc(subtitle)}</text></g>`;
}
function wire(path, label, x, y) { return `<path class="wire" d="${path}"/>${label ? `<g class="part" data-part="interconnect" tabindex="0" role="button"><rect x="${x - 75}" y="${y - 18}" width="150" height="28" fill="transparent"/><text class="wire-label" x="${x}" y="${y}" text-anchor="middle">${esc(label)}</text></g>` : ""}`; }

function localDiagram(p) {
  const blocks = [["cpu", "CPU", p.cpu]];
  if (state.local.integrated) blocks.push(["gpu", "GPU", "Integrated"]);
  if (state.local.npu) blocks.push(["npu", "AI accelerator", "Supported models"]);
  const width = 490 / blocks.length;
  let diagram = `<rect class="frame" x="40" y="60" width="600" height="250" rx="25"/><text class="wire-label" x="70" y="90">${esc(p.cpu)} processor</text>`;
  blocks.forEach(([kind, title, subtitle], index) => { diagram += part(kind, 70 + index * (width + 8), 125, width, 130, title, subtitle); });
  diagram += wire("M640 190H720", "", 0, 0) + part("memory", 720, 125, 210, 130, "RAM", "Working data");
  if (state.local.discrete) diagram += wire("M360 310V390H650", "PCIe", 500, 382) + part("discrete", 650, 360, 280, 120, "Separate GPU", "Parallel work") + part("vram", 70, 360, 280, 120, "VRAM", "GPU data") + wire("M350 420H650", "", 0, 0);
  else diagram += '<text class="wire-label" x="500" y="420" text-anchor="middle">One local machine</text>';
  return diagram;
}
function serverDiagram(p) {
  if (!p.gpu) return part("cpu", 80, 160, 340, 190, "CPU", `${p.cores} cores`) + wire("M420 255H575", "", 0, 0) + part("memory", 575, 160, 350, 190, p.memory, "System RAM");
  let diagram = part("cpu", 100, 50, 330, 150, "CPU", `${p.cores} cores`) + wire("M430 125H590", "", 0, 0) + part("memory", 590, 50, 300, 150, p.memory, "System RAM") + wire("M265 200V270H500V300", "PCIe", 500, 263);
  diagram += `<rect class="frame" x="55" y="300" width="890" height="240" rx="25"/><text class="wire-label" x="80" y="333">${p.gpuCount} × ${esc(p.gpu)}</text>`;
  for (let i = 0; i < p.gpuCount; i++) diagram += part("gpu", 90 + i * (820 / p.gpuCount), 360, 780 / p.gpuCount, 135, p.gpu, `GPU ${i + 1} · ${p.vram}`);
  return diagram;
}
function graceDiagram(p) {
  return `<rect class="frame" x="70" y="55" width="860" height="500" rx="25"/><text class="wire-label" x="100" y="88">Grace Hopper Superchip</text>${part("cpu", 115, 130, 300, 165, "Grace CPU", "72 cores")}${part("gpu", 585, 130, 300, 165, "Hopper GPU", "GH200")}${wire("M415 212H585", "NVLink-C2C", 500, 192)}${wire("M265 295V385 M735 295V385", "", 0, 0)}${part("memory", 115, 385, 300, 125, p.memory, "CPU memory")}${part("vram", 585, 385, 300, 125, p.vram, "GPU memory")}`;
}
function renderDiagram() {
  const p = state.current;
  const drawing = p.layout === "local" ? localDiagram(p) : p.layout === "grace-hopper" ? graceDiagram(p) : serverDiagram(p);
  $("#diagram").innerHTML = `<svg viewBox="0 0 1000 600" role="img" aria-label="${esc(p.label)} architecture diagram">${drawing}</svg>`;
}

function showInspector(kind) {
  if (!kind) { $("#inspector").innerHTML = '<p class="eyebrow">Select a component</p><h2>Explore the diagram</h2><p>Click a CPU, GPU, memory pool, or connection to see what it represents.</p>'; return; }
  const [title, text] = componentCopy[kind] || componentCopy.cpu;
  $("#inspector").innerHTML = `<p class="eyebrow">Component guide</p><h2>${esc(title)}</h2><p>${esc(text)}</p>`;
}
function details() {
  const p = state.current;
  const fields = [["Processor", p.cpu], ["Architecture", p.architecture], ...(p.cores ? [["Physical CPU cores", p.cores]] : []), ...(p.threads ? [["Scheduler CPU slots", p.threads]] : []), ["Memory", p.memory], ...(p.gpu ? [["GPUs", `${p.gpuCount} × ${p.gpu}`], ["GPU memory", p.vram]] : []), ...(p.nodeRange ? [["Node names", p.nodeRange]] : []), ...(p.interconnect ? [["Connection", p.interconnect]] : [])];
  $("#dialog-title").textContent = p.label;
  $("#dialog-content").innerHTML = `<dl class="details-grid">${fields.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>${p.note ? `<p class="dialog-note">${esc(p.note)}</p>` : ""}${p.source?.url ? `<a class="source-link" href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.label)} ↗</a>` : `<p class="dialog-note">${esc(p.source?.label || "")}</p>`}`;
  $("#details-dialog").showModal();
}

$("#search").addEventListener("input", renderList);
$("#computer-list").addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (button) choose(button.dataset.id); });
$("#diagram").addEventListener("click", (event) => { const target = event.target.closest("[data-part]"); if (target) showInspector(target.dataset.part); });
$("#diagram").addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-part]")) { event.preventDefault(); showInspector(event.target.dataset.part); } });
[["#integrated-gpu", "integrated"], ["#npu", "npu"], ["#discrete-gpu", "discrete"]].forEach(([selector, key]) => $(selector).addEventListener("change", (event) => { state.local[key] = event.target.checked; renderDiagram(); }));
$("#details-button").addEventListener("click", details);
$("#close-dialog").addEventListener("click", () => $("#details-dialog").close());

loadProfiles().catch((error) => { $("#computer-list").innerHTML = `<p class="loading">Unable to load the computer profiles. Run this site through a web server. (${esc(error.message)})</p>`; });
