# Git map source format

`wulfram-map-source` v1 is the canonical, reviewable representation stored in
[`blackwatergaming/wulfram-maps`](https://github.com/blackwatergaming/wulfram-maps).
Each map occupies `maps/<slug>/` and contains six UTF-8, LF-terminated
text files:

| File             | Purpose                                                                    | Diff behavior               |
| ---------------- | -------------------------------------------------------------------------- | --------------------------- |
| `map.json`       | Name, dimensions, validation settings, and revision timestamp              | Normal formatted JSON       |
| `terrain.tsv`    | `x`, `y`, texture index, and elevation for every vertex                    | One terrain vertex per line |
| `entities.jsonl` | Original token/subtype, team, transform, active flag, and stable editor ID | One base unit per line      |
| `base-layouts.json` | All named base states, per-layout validation, and user metadata          | Formatted JSON; one object per layout |
| `tagmap.txt`     | Original primary texture tag map                                           | One tag per line            |
| `tagmap2.txt`    | Original secondary texture tag map                                         | One tag per line            |

Terrain rows are row-major and must cover every coordinate exactly once. Entity
order is retained because it is also the order used by the original `state`
writer. `entities.jsonl` is the active-layout compatibility projection;
`base-layouts.json` is authoritative for every named state. Numeric values retain
the precision accepted by the original writers.
The metadata schema is checked in at
[`public/schemas/wulfram-map-source-v1.schema.json`](../public/schemas/wulfram-map-source-v1.schema.json).

The text source is authoritative. Compiled `land`, `state`, `tagmap`, `tagmap2`,
new-server `base-layout.json`/`base-layouts.json`, and editor backup files are deterministic release
artifacts and are not committed to the maps repository.

## Local workflow

With `wulfram-mapeditor` and `wulfram-maps` as sibling checkouts:

```bash
npm run dev
npm run maps:list
npm run maps:compile -- --all
npm run maps:publish -- crossroads
npm run maps:release -- v1.0.0
```

The development command starts both the editor and its loopback-only repository
service. The editor map selector can load, save, and explicitly publish maps.
Saving from Base Builder writes only `entities.jsonl` and `base-layouts.json`;
saving from Terrain Editor writes only `map.json`, `terrain.tsv`, and the tag maps.
Byte-for-byte isolation tests enforce both boundaries.
`maps:release` verifies a clean source checkout, compiles every map, pushes the
tag, and creates a GitHub Release containing per-map ZIPs, a collection ZIP, and
SHA-256 checksums. Git and GitHub credentials remain in the local processes and
are never sent to browser code.
