#!/usr/bin/env python3
"""Convert the installed Wulfram II resources into browser-ready assets.

The source formats were checked against the game's Ghidra project:

* bitmap kind 3 stores square mip levels smallest-first after a 3-byte header
* model coordinates and UVs are signed 16.16 fixed-point values
* a shape blob contains a string table followed by two packed model records
* land files are text heightfields and state files are text entity records

No artistic substitutions are made: PNG pixels and model vertices come directly
from ``../wulfram-debug``. Run from the repository root.
"""

from __future__ import annotations

import argparse
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
    "spaceship_1",
    "spaceship_2",
)

# Neutral, Team 1, and Team 2 material names from the original client's
# TeamTilemap_BuildRemapTable. Shape faces can reference any member of a row;
# the renderer selects the matching team tile at runtime.
TEAM_MATERIAL_VARIANTS = (
    ("ventpannel2G", "ventpannel2R", "ventpannel2"),
    ("ventpannelG", "ventpannelR", "ventpannel"),
    ("back holesG", "back holesR", "back holes"),
    ("s2topG", "s2topR", "s2top"),
    ("s1legsG", "s1legsR", "s1legs"),
    ("s1sideG", "s1sideR", "s1side"),
    ("s1wingsG", "s1wingsR", "s1wings"),
    ("s1bottomsG", "s1bottomsR", "s1bottoms"),
    ("ramp2G", "ramp2R", "ramp2"),
    ("ramp1G", "ramp1R", "ramp1"),
    ("padtankG", "padtankR", "padtankB"),
    ("p2stacksG", "p2stacksR", "p2stacks"),
    ("p2sqrfrontG", "p2sqrfrontR", "p2sqrfront"),
    ("p2sidetwangerG", "p2sidetwangerR", "p2sidetwanger"),
    ("p2rooffrntG", "p2rooffrntR", "p2rooffrnt"),
    ("p2frontrtG", "p2frontrtR", "p2frontrt"),
    ("p2frontlftG", "p2frontlftR", "p2frontlft"),
    ("p2ramp1G", "p2ramp1R", "p2ramp1"),
    ("p2ramp2G", "p2ramp2R", "p2ramp2"),
    ("cargosdG", "cargosdR", "cargosd"),
    ("cargotopsG", "cargotopsR", "cargotops"),
    ("mine1", "mine1R", "mine1"),
    ("caltrop", "caltropR", "caltrop"),
    ("gn1", "red_crest", "blue_crest"),
    ("Msentry1G", "Msentry1R", "Msentry1"),
    ("Msentry3G", "Msentry3R", "Msentry3"),
    ("ms2G", "ms2R", "ms2"),
    ("Ms1G", "Ms1R", "Ms1"),
    ("gn1", "pulsered", "pulseblue"),
)

TEAM_MATERIAL_BY_NAME = {}
for neutral, team1, team2 in TEAM_MATERIAL_VARIANTS:
    variants = {"neutral": neutral, "team1": team1, "team2": team2}
    for name in (neutral, team1, team2):
        # The client scans in insertion order; gn1 appears in two rows.
        TEAM_MATERIAL_BY_NAME.setdefault(name, variants)

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

BASE_CORE_TOKENS = {"e", "f", "r", "S", "s", "g", "E", "L", "p", "o", "d"}
BASE_CLUSTER_DISTANCE = 375.0
BASE_AUXILIARY_DISTANCE = 250.0
BASE_MINIMUM_CORE_UNITS = 4

CURATED_BASE_TEMPLATES = (
    {
        "id": "curated-base-in-a-box",
        "name": "Base in a Box",
        "description": "A deployed powered repair pad surrounded by a circular twelve-crate starter base.",
        "curated": True,
        "sourceMap": "Curated",
        "sourceState": "built-in",
        "sourceTeam": 1,
        "sourceWorldSize": [5600, 5600],
        "sourceAnchor": [2800, 2800],
        "unitCount": 14,
        "footprint": {"width": 210, "height": 210},
        "units": [
            {"token": "r", "offset": [0, 0], "groundOffset": 0, "rotation": [0, 0, 0], "active": 1},
            {"token": "e", "offset": [0, -55], "groundOffset": 0, "rotation": [0, 0, 0], "active": 1},
            {"token": "c", "subtype": "e", "offset": [105, 0], "groundOffset": 0, "rotation": [0, 0, 0], "active": 1},
            {"token": "c", "subtype": "e", "offset": [90.933, 52.5], "groundOffset": 0, "rotation": [0, 0, 0.523598775598], "active": 1},
            {"token": "c", "subtype": "f", "offset": [52.5, 90.933], "groundOffset": 0, "rotation": [0, 0, 1.047197551197], "active": 1},
            {"token": "c", "subtype": "p", "offset": [0, 105], "groundOffset": 0, "rotation": [0, 0, 1.570796326795], "active": 1},
            {"token": "c", "subtype": "p", "offset": [-52.5, 90.933], "groundOffset": 0, "rotation": [0, 0, 2.094395102393], "active": 1},
            {"token": "c", "subtype": "p", "offset": [-90.933, 52.5], "groundOffset": 0, "rotation": [0, 0, 2.617993877991], "active": 1},
            {"token": "c", "subtype": "g", "offset": [-105, 0], "groundOffset": 0, "rotation": [0, 0, 3.14159265359], "active": 1},
            {"token": "c", "subtype": "g", "offset": [-90.933, -52.5], "groundOffset": 0, "rotation": [0, 0, 3.665191429188], "active": 1},
            {"token": "c", "subtype": "g", "offset": [-52.5, -90.933], "groundOffset": 0, "rotation": [0, 0, 4.188790204786], "active": 1},
            {"token": "c", "subtype": "s", "offset": [0, -105], "groundOffset": 0, "rotation": [0, 0, 4.712388980385], "active": 1},
            {"token": "c", "subtype": "s", "offset": [52.5, -90.933], "groundOffset": 0, "rotation": [0, 0, 5.235987755983], "active": 1},
            {"token": "c", "subtype": "s", "offset": [90.933, -52.5], "groundOffset": 0, "rotation": [0, 0, 5.759586531581], "active": 1},
        ],
    },
)


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
    if not payload:
        raise ValueError("empty bitmap")
    kind = payload[0]
    base_kind = kind & 0x7F
    if base_kind == 1:
        if len(payload) < 9:
            raise ValueError("short kind-1 bitmap")
        _, width, height = struct.unpack_from("<BHH", payload)
        if not width or not height or len(payload) < 9 + width * height:
            raise ValueError("invalid kind-1 bitmap header")
        pixels = payload[9 : 9 + width * height]
    elif base_kind == 3:
        if len(payload) < 3:
            raise ValueError("short kind-3 bitmap")
        exponent = struct.unpack_from("<H", payload, 1)[0]
        width = height = 1 << exponent
        # Tex_SerializeToStream (0x498370) writes the entire mip block. The
        # full-size level follows 1x1, 2x2, ..., (width/2)x(height/2), as used by
        # TexCache_CreateChunkFromBitmap (0x497ed0) and the mip offset table.
        offset = 3 + (width * height - 1) // 3
        if len(payload) < offset + width * height:
            raise ValueError("short kind-3 top mip")
        pixels = payload[offset : offset + width * height]
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
    # Shipped maps also place building, wall, and other base/sky art on terrain.
    required = {"backface"}
    for tagmap in MAPS_ROOT.rglob("tagmap2"):
        for line in tagmap.read_text(encoding="cp1252").splitlines():
            if line.startswith("+"):
                required.update(line[1:].split()[1::3])
            elif line.strip():
                required.add(line.strip())
    for archive_path in sorted((SOURCE / "data" / "bitmaps").glob("*.zip")):
        with zipfile.ZipFile(archive_path) as archive:
            for name in sorted(required.intersection(archive.namelist()) - manifest.keys()):
                image = decode_bitmap(archive.read(name), palette)
                filename = safe_name(name) + ".png"
                image.save(destination / filename, optimize=True)
                manifest[name] = {
                    "url": f"/assets/textures/terrain/{filename}",
                    "width": image.width,
                    "height": image.height,
                    "average": average_color(image),
                }
    for name in sorted(required - manifest.keys()):
        print(f"warning: terrain bitmap {name!r} is unavailable", file=sys.stderr)
    return manifest


def extract_terrain_masks() -> dict[str, dict]:
    """Decode the source mask bytes, not palette colors (0x49c7d0)."""
    destination = PUBLIC / "textures" / "masks"
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with zipfile.ZipFile(BASE_ARCHIVE) as archive:
        for family in range(1, 5):
            for frame in range(1, 15):
                name = f"{family}template{frame:03d}"
                image = decode_bitmap(archive.read(name), [(i, i, i) for i in range(256)])
                filename = name + ".png"
                image.save(destination / filename, optimize=True)
                manifest[name] = {"url": f"/assets/textures/masks/{filename}",
                                  "width": image.width, "height": image.height,
                                  "average": average_color(image)}
    return manifest


def extract_skyboxes(palette: list[tuple[int, int, int]]) -> dict[str, dict]:
    """Keep all 32 original tiles per sky in an atlas with one-pixel gutters."""
    destination = PUBLIC / "textures" / "skies"
    destination.mkdir(parents=True, exist_ok=True)
    labels = {
        "2litesky": "Light sky", "2starset": "Starset", "2starysky": "Starry sky",
        "2weird": "Weird", "aurora": "Aurora", "bluesky": "Blue sky",
        "bluestar": "Blue star", "rainsky": "Rain sky", "stormsky": "Storm sky",
        "sunset": "Sunset", "yellowsky": "Yellow sky",
    }
    manifest = {}
    with zipfile.ZipFile(SOURCE / "data" / "bitmaps" / "skies.zip") as archive:
        for name, label in labels.items():
            atlas = Image.new("RGBA", (520, 1040))
            horizon = Image.new("RGBA", (128, 16))
            for index in range(32):
                tile = decode_bitmap(archive.read(f"{name}{index + 1:03d}"), palette)
                if tile.size != (128, 128):
                    raise ValueError(f"Unexpected sky tile size: {name}{index + 1:03d}")
                x, y = (index % 4) * 130, (index // 4) * 130
                # Duplicate border texels so bilinear sampling never reaches another tile.
                atlas.paste(tile, (x + 1, y + 1))
                atlas.paste(tile.crop((0, 0, 128, 1)), (x + 1, y))
                atlas.paste(tile.crop((0, 127, 128, 128)), (x + 1, y + 129))
                atlas.paste(atlas.crop((x + 1, y, x + 2, y + 130)), (x, y))
                atlas.paste(atlas.crop((x + 128, y, x + 129, y + 130)), (x + 129, y))
                if index < 16:
                    rotation = (2, 1, 0, 3)[index // 4]
                    for pixel in range(128):
                        uv = ((pixel, 127), (127, pixel), (pixel, 0), (0, pixel))[rotation]
                        horizon.putpixel((pixel, index), tile.getpixel(uv))
            filename = safe_name(name) + ".png"
            atlas.save(destination / filename, optimize=True)
            manifest[name] = {
                "label": label, "url": f"/assets/textures/skies/{filename}",
                "width": atlas.width, "height": atlas.height,
                "average": average_color(atlas), "horizon": average_color(horizon),
            }
    return manifest


def extract_model_materials(required_materials: set[str], palette: list[tuple[int, int, int]]):
    destination = PUBLIC / "textures" / "materials"
    destination.mkdir(parents=True, exist_ok=True)
    required_materials = set(required_materials)
    materials = {}
    with zipfile.ZipFile(BASE_ARCHIVE) as archive:
        available = set(archive.namelist())
        for name in list(required_materials):
            variants = TEAM_MATERIAL_BY_NAME.get(name)
            if variants:
                required_materials.update(candidate for candidate in variants.values() if candidate in available)
        for name in sorted(required_materials, key=str.casefold):
            if name not in available:
                print(f"warning: material bitmap {name!r} is unavailable", file=sys.stderr)
                continue
            image = decode_bitmap(archive.read(name), palette)
            filename = safe_name(name) + ".png"
            image.save(destination / filename, optimize=True)
            materials[name] = {
                "url": f"/assets/textures/materials/{filename}",
                "width": image.width, "height": image.height, "average": average_color(image),
            }
    # Every available member must resolve, including shapes already using red/gray art.
    variants = {name: row for name, row in TEAM_MATERIAL_BY_NAME.items() if name in materials}
    return materials, variants


def extract_models(
    palette: list[tuple[int, int, int]],
) -> tuple[dict[str, dict], dict[str, dict], dict[str, dict[str, str]]]:
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

    materials, material_variants = extract_model_materials(required_materials, palette)
    return models, materials, material_variants


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
    footprint_snap_labels = {
        "c": "Cargo Box",
        "d": "Darklight",
        "e": "Power Cell",
        "f": "Refuel Pad",
        "g": "Gun Turret",
        "r": "Repair Pad",
        "s": "Flak Turret",
        "L": "Missile Launcher",
        "p": "Skypump",
        "u": "Uplink",
    }

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
            if token in footprint_snap_labels:
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

    placement_defaults = {
        token: {
            "name": label,
            "sampleCount": len(offsets[token]),
            "heightOffset": round(statistics.median(offsets[token]), 3) if offsets[token] else 0,
            "snapMargin": 0.25,
            "method": "model-bounds footprint plane, terrain-grid peak clearance, then bottom margin",
        }
        for token, label in footprint_snap_labels.items()
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
        "placementDefaults": placement_defaults,
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


def extract_base_templates() -> dict:
    templates = [dict(template) for template in CURATED_BASE_TEMPLATES]
    source_states = 0
    source_units = 0

    for state_path in sorted(MAPS_ROOT.glob("*/state"), key=lambda path: str(path).casefold()):
        if not state_path.is_file() or not state_path.stat().st_size:
            continue
        land_path = state_path.parent / "land"
        if not land_path.exists():
            continue
        try:
            land = parse_land(land_path)
            records = [record for record in parse_state(state_path) if "position" in record]
        except (OSError, ValueError):
            continue
        source_states += 1
        source_units += len(records)

        for team in sorted({record["team"] for record in records if record["team"] > 0}):
            core_indices = [
                index
                for index, record in enumerate(records)
                if record["team"] == team and record["token"] in BASE_CORE_TOKENS
            ]
            parents = {index: index for index in core_indices}

            def find(index: int) -> int:
                while parents[index] != index:
                    parents[index] = parents[parents[index]]
                    index = parents[index]
                return index

            def union(left: int, right: int) -> None:
                left_root, right_root = find(left), find(right)
                if left_root != right_root:
                    parents[right_root] = left_root

            for offset, left_index in enumerate(core_indices):
                left = records[left_index]["position"]
                for right_index in core_indices[:offset]:
                    right = records[right_index]["position"]
                    if math.hypot(left[0] - right[0], left[1] - right[1]) <= BASE_CLUSTER_DISTANCE:
                        union(left_index, right_index)

            component_map: dict[int, list[int]] = defaultdict(list)
            for index in core_indices:
                component_map[find(index)].append(index)
            components = [
                {"core": indices, "members": list(indices)}
                for indices in component_map.values()
                if len(indices) >= BASE_MINIMUM_CORE_UNITS
                and any(records[index]["token"] == "e" for index in indices)
            ]
            if not components:
                continue

            # Cargo, uplinks, supply ships, and mines are attached to only their
            # nearest powered component so one source entity never appears twice.
            core_index_set = set(core_indices)
            for index, record in enumerate(records):
                if index in core_index_set or record["team"] != team or record["token"] == "*":
                    continue
                nearest_component = None
                nearest_distance = math.inf
                x, y = record["position"][:2]
                for component_index, component in enumerate(components):
                    distance = min(
                        math.hypot(x - records[core_index]["position"][0], y - records[core_index]["position"][1])
                        for core_index in component["core"]
                    )
                    if distance < nearest_distance:
                        nearest_component = component_index
                        nearest_distance = distance
                if nearest_component is not None and nearest_distance <= BASE_AUXILIARY_DISTANCE:
                    components[nearest_component]["members"].append(index)

            components.sort(
                key=lambda component: (
                    statistics.mean(records[index]["position"][1] for index in component["core"]),
                    statistics.mean(records[index]["position"][0] for index in component["core"]),
                )
            )
            map_name = state_path.parent.name
            map_slug = re.sub(r"[^a-z0-9]+", "-", map_name.lower()).strip("-") or "map"
            for base_number, component in enumerate(components, start=1):
                member_indices = sorted(set(component["members"]))
                positions = [records[index]["position"] for index in member_indices]
                minimum_x = min(position[0] for position in positions)
                maximum_x = max(position[0] for position in positions)
                minimum_y = min(position[1] for position in positions)
                maximum_y = max(position[1] for position in positions)
                center_x = (minimum_x + maximum_x) / 2
                center_y = (minimum_y + maximum_y) / 2
                units = []
                for index in member_indices:
                    record = records[index]
                    x, y, z = record["position"]
                    unit = {
                        "token": record["token"],
                        "offset": [round(x - center_x, 6), round(y - center_y, 6)],
                        "groundOffset": round(z - sample_terrain_height(land, x, y), 6),
                        "rotation": [round(value, 12) for value in record["rotation"]],
                        "active": record["active"],
                    }
                    if record.get("subtype") is not None:
                        unit["subtype"] = record["subtype"]
                    units.append(unit)
                templates.append(
                    {
                        "id": f"{map_slug}-team-{team}-base-{base_number}",
                        "name": f"{map_name.replace('_', ' ').title()} · Team {team} · Base {base_number}",
                        "sourceMap": map_name,
                        "sourceState": state_path.name,
                        "sourceTeam": team,
                        "sourceWorldSize": [land.world_width, land.world_height],
                        "sourceAnchor": [round(center_x, 6), round(center_y, 6)],
                        "unitCount": len(units),
                        "footprint": {
                            "width": round(maximum_x - minimum_x, 3),
                            "height": round(maximum_y - minimum_y, 3),
                        },
                        "units": units,
                    }
                )

    return {
        "format": "wulfram-base-template-library",
        "version": 1,
        "source": {
            "mapsRoot": "../wulfram-debug/data/maps",
            "stateFiles": source_states,
            "records": source_units,
            "method": "Powered connected components with nearby logistics attached to the nearest base",
            "clusterDistance": BASE_CLUSTER_DISTANCE,
            "auxiliaryDistance": BASE_AUXILIARY_DISTANCE,
            "minimumCoreUnits": BASE_MINIMUM_CORE_UNITS,
            "curatedTemplates": len(CURATED_BASE_TEMPLATES),
        },
        "templates": templates,
    }


def copy_demo_map() -> dict:
    source = MAPS_ROOT / "crossroads"
    destination = PUBLIC / "demo" / "crossroads"
    destination.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ("land", "state", "tagmap", "tagmap2", "start_script"):
        candidate = source / name
        if candidate.exists():
            shutil.copy2(candidate, destination / name)
            copied.append(name)
    return {"name": "Crossroads", "baseUrl": "/assets/demo/crossroads", "files": copied}


def main() -> None:
    global SOURCE, PALETTE_PATH, LANDSCAPE_ARCHIVE, BASE_ARCHIVE, SHAPES_ARCHIVE, MAPS_ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE, help="Wulfram installation or resource checkout")
    parser.add_argument("--textures-only", action="store_true", help="Regenerate texture assets without changing models or maps")
    args = parser.parse_args()
    SOURCE = args.source.resolve()
    PALETTE_PATH = SOURCE / "data" / "palette0"
    LANDSCAPE_ARCHIVE = SOURCE / "data" / "bitmaps" / "landscape.zip"
    BASE_ARCHIVE = SOURCE / "data" / "bitmaps" / "base.zip"
    SHAPES_ARCHIVE = SOURCE / "data" / "shapes.zip"
    MAPS_ROOT = SOURCE / "data" / "maps"
    for required in (PALETTE_PATH, LANDSCAPE_ARCHIVE, BASE_ARCHIVE, SHAPES_ARCHIVE, MAPS_ROOT):
        if not required.exists():
            raise SystemExit(f"Required Wulfram source asset is missing: {required}")

    palette = load_palette()
    texture_manifest = extract_terrain_textures(palette)
    mask_manifest = extract_terrain_masks()
    sky_manifest = extract_skyboxes(palette)
    if args.textures_only:
        manifest = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))
        required_materials = set()
        for asset in manifest["models"].values():
            model = json.loads((ROOT / "public" / asset["url"].lstrip("/")).read_text(encoding="utf-8"))
            required_materials.update(model["materials"])
        manifest["materials"], manifest["materialVariants"] = extract_model_materials(required_materials, palette)
        manifest["terrainTextures"] = texture_manifest
        manifest["terrainMasks"] = mask_manifest
        manifest["skyboxes"] = sky_manifest
        manifest["provenance"]["textureConversion"] = "Smallest-first mip chain; original full-resolution pixels and binary transition masks"
        manifest["provenance"]["skyArchive"] = "data/bitmaps/skies.zip"
        write_json(PUBLIC / "manifest.json", manifest, compact=True)
        print(f"Extracted {len(texture_manifest)} terrain textures, {len(manifest['materials'])} model materials, {len(mask_manifest)} masks, and {len(sky_manifest)} skies.")
        return
    model_manifest, material_manifest, material_variants = extract_models(palette)
    analysis = analyze_maps()
    base_templates = extract_base_templates()
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
        "terrainMasks": mask_manifest,
        "skyboxes": sky_manifest,
        "materials": material_manifest,
        "materialVariants": material_variants,
        "models": model_manifest,
        "baseTemplates": {
            "url": "/assets/base-templates.json",
            "count": len(base_templates["templates"]),
        },
        "demo": demo,
    }
    write_json(PUBLIC / "manifest.json", manifest, compact=True)
    write_json(PUBLIC / "map-analysis.json", analysis)
    write_json(PUBLIC / "base-templates.json", base_templates, compact=True)
    print(
        f"Extracted {len(texture_manifest)} terrain textures, {len(material_manifest)} model materials, "
        f"and {len(model_manifest)} models."
    )
    print(f"Extracted {len(base_templates['templates'])} base templates.")
    print(json.dumps(analysis["turretDefaults"], indent=2))
    print(json.dumps(analysis["powerCell"], indent=2))


if __name__ == "__main__":
    main()
