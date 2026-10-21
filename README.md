# Compute Atlas

An interactive visual reference for local hardware, lab machines, and ICER cluster configurations.

Visit the published site at [JoePetrecca.github.io/compute](https://JoePetrecca.github.io/compute/).

## Run locally

Serve the project directory with a local web server, then open the reported address in a modern browser:

```sh
python3 -m http.server
```

The browser loads individual computer profiles from `data/computers/`, so opening `index.html` directly from the filesystem will not work.

## Project structure

- `data/computers/` — one JSON file per computer profile
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
