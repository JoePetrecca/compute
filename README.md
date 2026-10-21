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
