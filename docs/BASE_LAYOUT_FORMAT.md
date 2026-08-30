# Wulfram base-layout JSON v1

`wulfram-base-layout` is the new-server, JSON-native equivalent of the original `state` file. It preserves every gameplay value needed for a lossless state/JSON round trip while giving server tooling stable field names.

```json
{
  "$schema": "https://raw.githubusercontent.com/blackwatergaming/wulfram-mapeditor/main/public/schemas/wulfram-base-layout-v1.schema.json",
  "format": "wulfram-base-layout",
  "version": 1,
  "map": {
    "name": "Crossroads",
    "coordinateSystem": "wulfram-world-xy-z-up",
    "worldSize": { "x": 5600, "y": 5600 }
  },
  "layout": {
    "id": "competitive-night",
    "name": "Competitive night",
    "metadata": {
      "mode": "ranked",
      "lighting": "night"
    }
  },
  "validation": {
    "serviceRadius": 300,
    "backupRadius": 80,
    "maxSlopeDegrees": 22,
    "minSpacing": 8
  },
  "units": [
    {
      "id": "gun-1",
      "stateToken": "g",
      "type": "gun",
      "team": 1,
      "position": [1200, 900, 37.131],
      "rotationRadians": [0, 0, 1.570796326795],
      "active": true
    }
  ]
}
```

Cargo boxes use `stateToken: "c"` plus `cargoToken`, matching the two-token prefix in the original format. Coordinates are Wulfram world X/Y with Z up; rotations are radians and retain the original X/Y/Z ordering. Validation radii travel with the layout because the original client receives those values from the server at runtime.

The editor imports or exports this JSON on its own and also includes `base-layout.json` in every original-format map ZIP. The `layout` object is optional when reading older v1 files and is always written by current builds.

## Multiple layouts on one terrain

`base-layouts.json` uses `wulfram-base-layout-collection` v1. It stores an `activeLayoutId` plus one or more named layout objects, each containing `id`, `name`, string-valued `metadata`, `entities`, `validation`, and `updatedAt`. This is the authoritative multi-state file in Git source and compiled packages; the original `state`, `entities.jsonl`, and individual `base-layout.json` files remain active-layout compatibility projections.

The Base Builder can create, duplicate, delete, switch, rename, and annotate layouts. Original maps containing `state`, `state1`, `state2`, `db_state`, or `bigstate` import each file as a separate layout with its source filename retained in metadata. See the checked-in [collection schema](../public/schemas/wulfram-base-layout-collection-v1.schema.json).
