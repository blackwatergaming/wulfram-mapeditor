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

The editor imports or exports this JSON on its own and also includes `base-layout.json` in every original-format map ZIP.
