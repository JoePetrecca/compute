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

## Usage-tab prototype

Select **Genoa · Hopper · 4 GPUs**, then **How to use this computer**. The centered builder generates a single-node, single-task Slurm script or reserved interactive shell command with CPU, system RAM, whole-GPU, wall-time, and optional account settings. The `nfh` feature constraint selects the four-GPU H200 node family. Interactive mode separately explains SSH access to the shared `dev-amd24-h200` node; SSH does not reserve the builder's resources.

Templates live in `scripts/usage.js`. They are not submitted automatically or tested against a live allocation. Inventory ceilings are not guarantees of scheduler-available resources; account, partition, and time policies still apply. Replace the program/environment placeholders before submitting a batch script. Request syntax follows ICER's [GPU requests](https://docs.icer.msu.edu/Requesting_GPUs/) and [job constraints](https://docs.icer.msu.edu/Job_Constraints/) documentation.
