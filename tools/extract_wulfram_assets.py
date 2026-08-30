#!/usr/bin/env python3
"""Convert the installed Wulfram II resources into browser-ready assets.

The source formats were checked against the game's Ghidra project:

* bitmap kind 3 stores every square mip level after a 3-byte header
* model coordinates and UVs are signed 16.16 fixed-point values
* a shape blob contains a string table followed by two packed model records
* land files are text heightfields and state files are text entity records

No artistic substitutions are made: PNG pixels and model vertices come directly
from ``../wulfram-debug``. Run from the repository root.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import statistics
import struct
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / ".." / "wulfram-debug").resolve()
PUBLIC = ROOT / "public" / "assets"
PALETTE_PATH = SOURCE / "data" / "palette0"
LANDSCAPE_ARCHIVE = SOURCE / "data" / "bitmaps" / "landscape.zip"
BASE_ARCHIVE = SOURCE / "data" / "bitmaps" / "base.zip"
SHAPES_ARCHIVE = SOURCE / "data" / "shapes.zip"
MAPS_ROOT = SOURCE / "data" / "maps"

MODEL_NAMES = (
    "cargo",
    "uplinkred",
    "uplinkblue",
    "energy_1",
    "energy_2",
    "refuel_1",
    "refuel_2",
    "repair_1",
    "repair_2",
    "flak_turret_1",
    "flak_turret_2",
    "gun_turret_1",
    "gun_turret_2",
    "missile_launcher_1",
    "missile_launcher_2",
    "skypump_1",
    "skypump_2",
    "darklight_1",
    "darklight_2",
)

ENTITY_NAMES = {
    "i": "Mine",
    "c": "Cargo Box",
    "u": "Uplink",
    "h": "Supply Ship",
    "e": "Power Cell",
    "f": "Refuel Pad",
    "r": "Repair Pad",
    "S": "Shield",
    "s": "Flak Turret",
    "g": "Gun Turret",
    "E": "Heavy Missile Silo",
    "L": "Missile Launcher",
    "p": "Skypump",
    "o": "Portal",
    "d": "Darklight",
    "b": "Spy Bug",
    "*": "Decoration",
}

CARGO_NAMES = {
    "e": "Power Cell",
    "f": "Refuel Pad",
    "r": "Repair Pad",
    "h": "Shield",
    "s": "Flak Turret",
    "g": "Gun Turret",
    "M": "Heavy Missile Silo",
    "L": "Missile Launcher",
    "p": "Skypump",
    "o": "Portal",
    "d": "Darklight",
    "b": "Spy Bug",
}


class ShapeReader:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.offset = 0

    def remaining(self) -> int:
        return len(self.payload) - self.offset

    def read(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.payload):
            raise ValueError(f"shape underflow at {self.offset}, wanted {size} bytes")
        value = self.payload[self.offset:end]
        self.offset = end
        return value

    def u16(self) -> int:
        return struct.unpack("<H", self.read(2))[0]

    def i32(self) -> int:
        return struct.unpack("<i", self.read(4))[0]

    def fixed(self) -> float:
        return self.i32() / 65536.0

    def cstring(self) -> str:
        end = self.payload.find(b"\0", self.offset)
        if end < 0:
            raise ValueError(f"unterminated shape string at {self.offset}")
        value = self.payload[self.offset:end].decode("cp1252")
        self.offset = end + 1
        return value


def safe_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "asset"
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:7]
    return f"{slug}-{digest}"


def load_palette() -> list[tuple[int, int, int]]:
    raw = PALETTE_PATH.read_bytes()
    if len(raw) != 768:
        raise ValueError(f"palette0 should contain 768 bytes, got {len(raw)}")
    return [tuple(raw[index : index + 3]) for index in range(0, 768, 3)]


def decode_bitmap(payload: bytes, palette: list[tuple[int, int, int]], transparent: bool = False) -> Image.Image:
    kind = payload[0]
    base_kind = kind & 0x7F
    if base_kind == 1:
        if len(payload) < 9:
            raise ValueError("short kind-1 bitmap")
        _, width, height, reserved = struct.unpack_from("<BHHI", payload)
        if reserved != 0 or len(payload) < 9 + width * height:
            raise ValueError("invalid kind-1 bitmap header")
        pixels = payload[9 : 9 + width * height]
    elif base_kind == 3:
        if len(payload) < 3:
            raise ValueError("short kind-3 bitmap")
        exponent = struct.unpack_from("<H", payload, 1)[0]
        width = height = 1 << exponent
        if len(payload) < 3 + width * height:
            raise ValueError("short kind-3 top mip")
        pixels = payload[3 : 3 + width * height]
    else:
        raise ValueError(f"unsupported bitmap kind {kind}")

    rgba = bytearray(width * height * 4)
    for index, palette_index in enumerate(pixels):
        red, green, blue = palette[palette_index]
        offset = index * 4
        alpha = 0 if transparent and palette_index == 0 else 255
        rgba[offset : offset + 4] = bytes((red, green, blue, alpha))
    return Image.frombytes("RGBA", (width, height), bytes(rgba))


def average_color(image: Image.Image) -> str:
    sample = image.convert("RGB").resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    return "#%02x%02x%02x" % sample


def parse_model(reader: ShapeReader) -> dict:
    vertices = [
        [round(reader.fixed(), 6), round(reader.fixed(), 6), round(reader.fixed(), 6)]
        for _ in range(reader.u16())
    ]
    faces = []
    for _ in range(reader.u16()):
        material = reader.u16()
        vertex_count = reader.u16()
        if vertex_count < 3:
            raise ValueError(f"invalid face vertex count {vertex_count}")
        corners = []
        for _ in range(vertex_count):
            corners.append(
                {
                    "vertex": reader.u16(),
                    "uv": [round(reader.fixed(), 6), round(reader.fixed(), 6)],
                }
            )
        faces.append({"material": material, "corners": corners})

    named_vectors = {}
    for _ in range(reader.u16()):
        name = reader.cstring()
        named_vectors[name] = [round(reader.fixed(), 6) for _ in range(3)]
    return {"vertices": vertices, "faces": faces, "namedVectors": named_vectors}


def parse_shape(payload: bytes) -> dict:
    reader = ShapeReader(payload)
    name = reader.cstring()
    materials = [reader.cstring() for _ in range(reader.u16())]
    collision = parse_model(reader)
    render = parse_model(reader)
    model = render if render["faces"] else collision

    by_material: dict[int, dict[str, list[float]]] = defaultdict(lambda: {"positions": [], "uvs": []})
    for face in model["faces"]:
        corners = face["corners"]
        for triangle_index in range(1, len(corners) - 1):
            for corner in (corners[0], corners[triangle_index], corners[triangle_index + 1]):
                vertex_index = corner["vertex"]
                if vertex_index >= len(model["vertices"]):
                    raise ValueError(f"{name}: vertex {vertex_index} is out of range")
                by_material[face["material"]]["positions"].extend(model["vertices"][vertex_index])
                by_material[face["material"]]["uvs"].extend(corner["uv"])

    flat = [coordinate for vertex in model["vertices"] for coordinate in vertex]
    bounds = {
        "min": [round(min(flat[axis::3]), 5) for axis in range(3)],
        "max": [round(max(flat[axis::3]), 5) for axis in range(3)],
    }
    return {
        "name": name,
        "materials": materials,
        "meshes": [
            {
                "materialIndex": material_index,
                "positions": values["positions"],
                "uvs": values["uvs"],
            }
            for material_index, values in sorted(by_material.items())
        ],
        "bounds": bounds,
        "namedVectors": model["namedVectors"],
        "source": {
            "renderVertices": len(model["vertices"]),
            "renderFaces": len(model["faces"]),
            "collisionVertices": len(collision["vertices"]),
            "collisionFaces": len(collision["faces"]),
        },
    }


def write_json(path: Path, value: object, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, separators=(",", ":") if compact else None, indent=None if compact else 2) + "\n",
        encoding="utf-8",
    )


def extract_terrain_textures(palette: list[tuple[int, int, int]]) -> dict[str, dict]:
    destination = PUBLIC / "textures" / "terrain"
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with zipfile.ZipFile(LANDSCAPE_ARCHIVE) as archive:
        for name in archive.namelist():
            image = decode_bitmap(archive.read(name), palette)
            filename = safe_name(name) + ".png"
            image.save(destination / filename, optimize=True)
            manifest[name] = {
                "url": f"/assets/textures/terrain/{filename}",
                "width": image.width,
                "height": image.height,
                "average": average_color(image),
            }
    return manifest


def extract_models(palette: list[tuple[int, int, int]]) -> tuple[dict[str, dict], dict[str, dict]]:
    model_destination = PUBLIC / "models"
    material_destination = PUBLIC / "textures" / "materials"
    model_destination.mkdir(parents=True, exist_ok=True)
    material_destination.mkdir(parents=True, exist_ok=True)
    models = {}
    required_materials = set()

    with zipfile.ZipFile(SHAPES_ARCHIVE) as archive:
        available = set(archive.namelist())
        for name in MODEL_NAMES:
            if name not in available:
                print(f"warning: shape {name!r} is unavailable", file=sys.stderr)
                continue
            model = parse_shape(archive.read(name))
            required_materials.update(model["materials"])
            filename = safe_name(name) + ".json"
            models[name] = {
                "url": f"/assets/models/{filename}",
                "bounds": model["bounds"],
                "vertices": model["source"]["renderVertices"],
                "faces": model["source"]["renderFaces"],
            }
            write_json(model_destination / filename, model, compact=True)

    materials = {}
    with zipfile.ZipFile(BASE_ARCHIVE) as archive:
        available = set(archive.namelist())
        for name in sorted(required_materials, key=str.casefold):
            if name not in available:
                print(f"warning: material bitmap {name!r} is unavailable", file=sys.stderr)
                continue
            image = decode_bitmap(archive.read(name), palette)
            filename = safe_name(name) + ".png"
            image.save(material_destination / filename, optimize=True)
            materials[name] = {
                "url": f"/assets/textures/materials/{filename}",
                "width": image.width,
                "height": image.height,
                "average": average_color(image),
            }
    return models, materials


@dataclass
class LandMap:
    width: int
    height: int
    world_width: float
    world_height: float
    texture_ids: list[int]
    heights: list[float]


def parse_land(path: Path) -> LandMap:
    lines = path.read_text(encoding="ascii", errors="strict").splitlines()
    width, height = (int(value) for value in lines[0].split("x", 1))
    world_width, world_height = (float(value) for value in lines[1].split("x", 1))
    if len(lines) < 2 + width * height:
        raise ValueError(f"{path}: incomplete heightfield")
    texture_ids = []
    heights = []
    for line in lines[2 : 2 + width * height]:
        texture, elevation = line.split()[:2]
        texture_ids.append(int(texture))
        heights.append(float(elevation))
    return LandMap(width, height, world_width, world_height, texture_ids, heights)


def sample_terrain_height(land: LandMap, world_x: float, world_y: float) -> float:
    x = max(0.0, min(land.width - 1.0, world_x / land.world_width * (land.width - 1)))
    y = max(0.0, min(land.height - 1.0, world_y / land.world_height * (land.height - 1)))
    x0, y0 = int(math.floor(x)), int(math.floor(y))
    x1, y1 = min(x0 + 1, land.width - 1), min(y0 + 1, land.height - 1)
    tx, ty = x - x0, y - y0
    h00 = land.heights[y0 * land.width + x0]
    h10 = land.heights[y0 * land.width + x1]
    h01 = land.heights[y1 * land.width + x0]
    h11 = land.heights[y1 * land.width + x1]
    if (x0 ^ y0) & 1:
        if tx + ty <= 1:
            return h00 + tx * (h10 - h00) + ty * (h01 - h00)
        return h11 + (1 - tx) * (h01 - h11) + (1 - ty) * (h10 - h11)
    if tx <= ty:
        return h00 + tx * (h11 - h00) + (ty - tx) * (h01 - h00)
    return h00 + ty * (h11 - h00) + (tx - ty) * (h10 - h00)


def normalize_angle(value: float) -> float:
    return (value + math.pi) % (2 * math.pi) - math.pi


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def parse_state(path: Path) -> list[dict]:
    records = []
    for raw_line in path.read_text(encoding="ascii", errors="replace").splitlines():
        parts = raw_line.split()
        if not parts:
            continue
        if parts[0] == "c":
            if len(parts) != 10:
                continue
            token, subtype, numeric = "c", parts[1], parts[2:]
        elif parts[0] == "*":
            # Decorations carry an extra resource name and flags. They are counted
            # but excluded from base-placement statistics.
            records.append({"token": "*", "raw": raw_line})
            continue
        else:
            if len(parts) != 9:
                continue
            token, subtype, numeric = parts[0], None, parts[1:]
        try:
            team = int(numeric[0])
            values = [float(value) for value in numeric[1:7]]
            active = int(numeric[7])
        except (ValueError, IndexError):
            continue
        records.append(
            {
                "token": token,
                "subtype": subtype,
                "team": team,
                "position": values[:3],
                "rotation": values[3:6],
                "active": active,
            }
        )
    return records


def analyze_maps() -> dict:
    state_paths = sorted(
        path
        for path in MAPS_ROOT.glob("*/state*")
        if path.is_file() and path.stat().st_size and re.fullmatch(r"state\d*", path.name)
    )
    state_paths.extend(
        path for path in MAPS_ROOT.glob("*/bigstate") if path.is_file() and path.stat().st_size
    )
    token_counts = Counter()
    rotations: dict[str, list[list[float]]] = defaultdict(list)
    offsets: dict[str, list[float]] = defaultdict(list)
    powered_distances = []
    cell_distances = []
    record_count = 0
    analyzed_files = 0
    powered_tokens = {"f", "r", "s", "g", "E", "L", "o"}

    for state_path in state_paths:
        land_path = state_path.parent / "land"
        if not land_path.exists():
            continue
        try:
            land = parse_land(land_path)
            records = parse_state(state_path)
        except (OSError, ValueError):
            continue
        analyzed_files += 1
        record_count += len(records)
        for record in records:
            token = record["token"]
            token_counts[f"c {record['subtype']}" if token == "c" else token] += 1
            if "position" not in record:
                continue
            if token in {"g", "s"}:
                rotations[token].append([normalize_angle(value) for value in record["rotation"]])
                ground = sample_terrain_height(land, record["position"][0], record["position"][1])
                offset = record["position"][2] - ground
                if abs(offset) < 80:
                    offsets[token].append(offset)

        for team in (1, 2):
            cells = [r for r in records if r.get("token") == "e" and r.get("team") == team]
            structures = [r for r in records if r.get("token") in powered_tokens and r.get("team") == team]
            for structure in structures:
                if not cells:
                    continue
                sx, sy = structure["position"][:2]
                powered_distances.append(min(math.hypot(sx - c["position"][0], sy - c["position"][1]) for c in cells))
            for index, cell in enumerate(cells):
                for other in cells[index + 1 :]:
                    cell_distances.append(math.hypot(cell["position"][0] - other["position"][0], cell["position"][1] - other["position"][1]))

    turret_defaults = {}
    for token, label in (("g", "Gun Turret"), ("s", "Flak Turret")):
        samples = rotations[token]
        turret_defaults[token] = {
            "name": label,
            "sampleCount": len(samples),
            "heightSampleCount": len(offsets[token]),
            "heightOffset": round(statistics.median(offsets[token]), 3) if offsets[token] else 0,
            "pitch": round(statistics.median(row[0] for row in samples), 6) if samples else 0,
            "roll": round(statistics.median(row[1] for row in samples), 6) if samples else 0,
            "yawCircularMean": round(
                math.atan2(
                    statistics.mean(math.sin(row[2]) for row in samples),
                    statistics.mean(math.cos(row[2]) for row in samples),
                )
                % (2 * math.pi),
                6,
            )
            if samples
            else 0,
            "medianTiltDegrees": round(
                math.degrees(statistics.median(math.hypot(row[0], row[1]) for row in samples)), 2
            )
            if samples
            else 0,
        }

    # The client receives the true radii in the BEHAVIOR packet; static maps do
    # not contain them. Old states also include intentionally unpowered or stale
    # structures, so use the dense placement cluster instead of the global p95.
    powered_cluster = [distance for distance in powered_distances if distance <= 600]
    cluster_p75 = percentile(powered_cluster, 0.75)
    service_radius = max(300, round((cluster_p75 + 25) / 25) * 25) if powered_cluster else 300
    backup_candidates = [distance for distance in cell_distances if distance <= 150]
    inferred_backup = round(percentile(backup_candidates, 0.9) / 10) * 10 if backup_candidates else 100
    backup_radius = max(80, min(150, inferred_backup))
    return {
        "source": {
            "mapsRoot": "../wulfram-debug/data/maps",
            "stateFiles": analyzed_files,
            "records": record_count,
            "method": "Ghidra-verified state parser plus robust statistics over shipped maps",
        },
        "entityTokens": ENTITY_NAMES,
        "cargoTokens": CARGO_NAMES,
        "tokenCounts": dict(sorted(token_counts.items())),
        "turretDefaults": turret_defaults,
        "powerCell": {
            "serviceRadius": service_radius,
            "backupRadius": backup_radius,
            "poweredDistanceSamples": len(powered_distances),
            "nearestPoweredP50": round(percentile(powered_distances, 0.5), 2),
            "nearestPoweredP95": round(percentile(powered_distances, 0.95), 2),
            "denseClusterSamples": len(powered_cluster),
            "denseClusterP75": round(cluster_p75, 2),
            "note": "Offline defaults inferred from the dense shipped-placement cluster; the original client receives server-specific values in BEHAVIOR.",
            "ghidraRule": {
                "primaryOverlapBlockDistance": "2 * serviceRadius + 10",
                "backupProbeDistance": "backupRadius - 10",
                "poweredItemProbeDistance": "serviceRadius - 10",
            },
        },
    }


def copy_demo_map() -> dict:
    source = MAPS_ROOT / "crossroads"
    destination = PUBLIC / "demo" / "crossroads"
    destination.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ("land", "state", "tagmap", "tagmap2"):
        candidate = source / name
        if candidate.exists():
            shutil.copy2(candidate, destination / name)
            copied.append(name)
    return {"name": "Crossroads", "baseUrl": "/assets/demo/crossroads", "files": copied}


def main() -> None:
    for required in (PALETTE_PATH, LANDSCAPE_ARCHIVE, BASE_ARCHIVE, SHAPES_ARCHIVE, MAPS_ROOT):
        if not required.exists():
            raise SystemExit(f"Required Wulfram source asset is missing: {required}")

    palette = load_palette()
    texture_manifest = extract_terrain_textures(palette)
    model_manifest, material_manifest = extract_models(palette)
    analysis = analyze_maps()
    demo = copy_demo_map()

    logo_source = SOURCE / "emjoii" / "wulfram2-logo-transparent.png"
    if logo_source.exists():
        shutil.copy2(logo_source, PUBLIC / "wulfram2-logo.png")

    manifest = {
        "provenance": {
            "source": "../wulfram-debug",
            "palette": "data/palette0",
            "terrainArchive": "data/bitmaps/landscape.zip",
            "materialArchive": "data/bitmaps/base.zip",
            "shapeArchive": "data/shapes.zip",
            "conversion": "Palette decode and 16.16 fixed-point model unpacking only",
        },
        "terrainTextures": texture_manifest,
        "materials": material_manifest,
        "models": model_manifest,
        "demo": demo,
    }
    write_json(PUBLIC / "manifest.json", manifest, compact=True)
    write_json(PUBLIC / "map-analysis.json", analysis)
    print(
        f"Extracted {len(texture_manifest)} terrain textures, {len(material_manifest)} model materials, "
        f"and {len(model_manifest)} models."
    )
    print(json.dumps(analysis["turretDefaults"], indent=2))
    print(json.dumps(analysis["powerCell"], indent=2))


if __name__ == "__main__":
    main()
