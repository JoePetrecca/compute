# Compute Atlas

An interactive visual reference for local hardware, lab machines, and ICER cluster configurations.

Visit the published site at [JoePetrecca.github.io/compute](https://JoePetrecca.github.io/compute/).

The sidebar’s **Workload / Specs** switch changes subtitles without renaming machines. The preference is saved in the browser when storage is available; search matches either subtitle style. A profile can provide an optional `workloadLabel` to override its default workload subtitle.

## Run locally

Serve the project directory with a local web server, then open the reported address in a modern browser:

```sh
python3 -m http.server
```

The browser loads individual computer profiles from `data/computers/`, so opening `index.html` directly from the filesystem will not work.

## Project structure

- `data/computers/` — one JSON file per computer profile
- `data/computers.json` — ordered list of profiles to load
- `data/hardware.json` — shared CPU/GPU specifications and inventory sources
- `data/components.json` — shared plain-language component explanations; profiles can override these with machine-specific `components` and add an introductory `tidbit`
- `scripts/app.js` — shared interface, interaction, and diagram rendering
- `styles/atlas.css` — shared visual design
- `Compute-Atlas.html` — the original full atlas, kept as an archive/reference

## Publish updates

Push changes to the repository’s default branch. GitHub Pages serves `index.html` from the repository root.

## Dual-socket diagram references

The blue CPU enclosure groups two physical sockets; it is not a single chip. Each socket has locally attached RAM, and coherent access to the other socket uses Infinity Fabric’s xGMI connection. The diagrams do not claim an exact RAM split, physical link count, NUMA-domain count, or GPU-to-socket mapping for these machines.

- [AMD EPYC 7003 Microarchitecture Overview](https://docs.amd.com/api/khub/documents/cdbcpYJAub6P1i3lB2DRJg/content), sections 2.4–2.7: I/O die, memory locality, and socket-to-socket xGMI. AMD documents three- or four-link motherboard configurations.
- [AMD EPYC 7002 VMware vSphere Tuning Guide](https://docs.amd.com/api/khub/documents/BNoWV64HQ1YTdnvUrEN6vQ/content): socket-to-socket xGMI and NUMA topology for the processor generation used by Moria.

## ICER inventory

Reviewed October 20, 2026 against ICER’s [cluster](https://docs.icer.msu.edu/Cluster_Resources/), [GPU](https://docs.icer.msu.edu/GPU_resources/), [Grace](https://docs.icer.msu.edu/Getting_Started_with_Grace_Hopper_and_Grace_Grace/), [Data Machine](https://docs.icer.msu.edu/Using_the_Data_Machine/), and [development-node](https://docs.icer.msu.edu/development_nodes/) pages. The atlas includes all configurations listed in those hardware tables, grouping nodes with identical listed resources. Values are static references, not current availability.

- Core counts are physical cores, not scheduler slot counts. Thread descriptions are restricted to Moria.
- Data Machine storage and memory follow its dedicated table. The general cluster table lists different disk figures for those same nodes and lists 2005 GB rather than the rounded 2 TB for its CPU nodes.
- Data Machine GPU partitioning follows the named-node table (nal-004–006 full cards, nal-007 partitioned); nearby prose conflicts with that table. Check the actual allocation before relying on a slice configuration.
- GPU memory is shown per physical card; the partitioned profile separately identifies 10 GB slices.
- CPU cache values are per processor unless otherwise labelled. Shared model metadata follows the processor specifications already referenced by the original atlas.
- Detailed socket diagrams are enabled for dual-socket AMD configurations and Grace–Grace. Intel systems retain aggregate diagrams rather than guessing socket link wiring.

## Checks

Run `node --test tests/*.test.mjs` to validate profile coverage, node ranges, physical-resource counts, both diagram views, component panels, and resource-request templates. These checks do not replace a visual browser review.

## HPCC overview

The **HPCC → The HPCC** sidebar entry assembles the represented ICER inventory into **one continuous SVG map**, with tightly packed, faintly colored islands for hardware families such as Milan and Rome. Large centered family names appear over faint node diagrams in the overview; zooming in fades those names out and brings configuration labels and individual nodes into full visibility. Both configurations and islands are packed to fill gaps, with map bounds fitted to the content. It reuses each configuration's Simple diagram through SVG symbols, so an eight-node configuration shows eight copies and a twenty-node configuration shows twenty. Labels are part of the image—not separate gallery cards.

Drag to pan, scroll or pinch to zoom, or use the zoom, Fit all, 100%, and Fullscreen controls. Keyboard controls are `+` / `-` for zoom, arrow keys for pan, and `0` or Home to fit everything. Hover a node for its name; individual configuration pages remain available in the sidebar. The map starts fitted to show the entire cluster and keeps diagrams sharp as you zoom.

The current snapshot represents **640 compute nodes plus 5 shared development nodes**, excluding Moria. Totals count physical CPU cores and physical GPUs on compute nodes; MIG slices are not counted as additional physical cards. This is not a live availability display, network topology map, or an inventory of unlisted gateways/storage infrastructure.

## Usage instructions

Every ICER configuration has a **How to use this computer** tab; Moria retains its specifications-only panel. Development pages are SSH-only, without resource selectors or batch submissions. On compute configurations, the centered builder generates a single-node, single-task Slurm script or reserved interactive shell command with CPU, system RAM, GPU/slice, wall-time, account, and target-node settings. Multi-node configurations default to **Any node in this configuration**, or you can select a particular host. Both choices request exactly **one** node, never the whole node range. Pinning a busy host can increase queue time. Custom settings are retained per profile during the page session.

Any-node mode omits `--nodelist` and uses the family's constraint plus `--exclude` for other configurations in that family, based on the atlas inventory. This preserves listed RAM, storage, and hardware variants; it does not blindly allow every node with the same CPU/GPU. Interactive exclusions are shell-quoted. The inventory is static: node additions or hardware changes require reviewing these filters. Specific-host mode uses a single `--nodelist` entry. Single-node configurations retain their one host; development pages remain SSH-only.

Request logic and Grace environment setup live in `scripts/usage.js`:

- Development pages show only SSH access, gateway/OnDemand instructions, and usage limits. SSH does not reserve resources. For scheduled allocations, use the separate compute-node pages. A100/L40S and Grace/Data Machine pages do not invent matching development hardware.
- CPU-only configurations omit GPU controls/directives. GPU profiles request the appropriate type; Grace Hopper follows ICER's untyped GPU request example under `NOAUTO:grace`.
- Grace and VIM use their documented `NOAUTO` constraints. Grace Hopper defaults to ICER's 72-CPU, 10-GiB, three-hour CUDA-sample example, with a selectable custom ARM executable template. Grace–Grace remains CPU-only. Grace batch scripts initialize EESSI and `/opt/modules/all`; interactive mode has a separate, copyable setup to run **after** allocation. Custom compiled-code templates load `Compiled` after project dependencies. The guide explains incompatible x86 conda environments, slow home/research storage, temporary `/tmp` staging, beta software support, and non-owner jobs under four hours. These requirements do not apply to the x86 H200 nodes.
- Data Machine requires approved `data-machine` account membership and even scheduler-CPU requests. MIG uses `a100_slice` and 10 GB slices, not full cards; whole-node requests are unavailable for that profile. Live MIG partitioning remains unverified.
- Whole-node requests are under Advanced with a queue warning, using `--exclusive` and `--mem=0`. Memory limits for custom requests are approximate inventory ceilings (published TB values use 1000 GB per TB), not guarantees of scheduler-available GiB.

Templates are not submitted automatically or tested against a live allocation; account, partition, and time policies still apply. Replace the program/environment placeholders before submitting. Request syntax follows ICER's [GPU requests](https://docs.icer.msu.edu/Requesting_GPUs/), [job constraints](https://docs.icer.msu.edu/Job_Constraints/), [job specifications](https://docs.icer.msu.edu/List_of_Job_Specifications/), [Grace](https://docs.icer.msu.edu/Getting_Started_with_Grace_Hopper_and_Grace_Grace/), and [Data Machine](https://docs.icer.msu.edu/Using_the_Data_Machine/) documentation.
