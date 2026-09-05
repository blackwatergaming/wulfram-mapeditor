"""Check the actual terrain sampling GLSL on a GPU against independent source-art composites.

Requires Pillow and moderngl. Run from any directory with
``python tools/verify-terrain-render.py``. This checks shader sampling, not browser UI integration.
"""
import json
import math
from pathlib import Path
import re
import struct
import subprocess

import moderngl
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "public/assets/manifest.json").read_text(encoding="utf-8"))
assets = manifest["terrainTextures"]
slots = {name: index + 1 for index, name in enumerate(assets)}
columns = math.ceil(math.sqrt(len(slots) + 1))
rows = math.ceil((len(slots) + 1) / columns)

# Each entry describes the expected background, then overlays in original file
# order. The cases cover all four mask families, four-way transitions, distinct
# rows, tile phase, and ignored land padding.
cases = [
    (3, [("canyon003", 15)]),
    (1, [("Bdt001", 1), ("4sand001", 2), ("megadirt001", 4), ("20bush001", 8)]),
    (2, [("4granite001", 1), ("4sand001", 14)]),
    (3, [("20bush001", 1), ("canyon001", 2), ("4sand001", 4), ("Bdt001", 8)]),
    (4, [("5ice001", 3), ("1snow001", 12)]),
    (1, [("wallmetal1", 15)]),
]
tags = [layers[0][0] if len(layers) == 1 else "+" + " ".join(
    f"0template {name} {15 ^ mask}" for name, mask in layers
) for _, layers in cases]
terrain = {"width": 4, "height": 3, "textureIds": list(range(6)) + [999] * 6, "tagmap2": tags}
script = """
import fs from 'node:fs';
import { buildTerrainCellLayers } from './lib/terrain-textures.ts';
const { terrain, slots } = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(Array.from(buildTerrainCellLayers(terrain, new Map(Object.entries(slots))))));
"""
packed = json.loads(subprocess.run(
    ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
    cwd=ROOT, input=json.dumps({"terrain": terrain, "slots": slots}),
    text=True, capture_output=True, check=True,
).stdout)


def load_asset(asset):
    return Image.open(ROOT / "public" / asset["url"].lstrip("/")).convert("RGBA")


source_images = {name: load_asset(assets[name]) for _, layers in cases for name, _ in layers}
atlas = Image.new("RGBA", (columns * 128, rows * 128), (91, 70, 56, 255))
for name, image in source_images.items():
    slot = slots[name]
    atlas.paste(image, ((slot % columns) * 128, (slot // columns) * 128))

# Original executable table 0x577008, independent of the implementation's export.
mask_by_frame = [0, 1, 3, 2, 5, 10, 4, 12, 8, 14, 13, 11, 7, 9, 6, 15]
mask_images = {}
mask_atlas = Image.new("RGBA", (16 * 128, 4 * 128), (0, 0, 0, 255))
for family in range(1, 5):
    mask_atlas.paste((255, 255, 255, 255), (15 * 128, (family - 1) * 128, 16 * 128, family * 128))
    for frame in range(1, 15):
        image = load_asset(manifest["terrainMasks"][f"{family}template{frame:03d}"])
        mask = mask_by_frame[frame]
        mask_images[family, mask] = image.convert("L")
        mask_atlas.paste(image, (mask * 128, (family - 1) * 128))

expected = Image.new("RGBA", (384, 256))
for cell, (family, layers) in enumerate(cases):
    tile = source_images[layers[0][0]].copy()
    for name, mask in layers[1:]:
        tile = Image.composite(source_images[name], tile, mask_images[family, mask])
    expected.paste(tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM), (cell % 3 * 128, cell // 3 * 128))

shader = re.search(r"const terrainSamplingShader = `(.*?)`;", (ROOT / "lib/terrain-material.ts").read_text(encoding="utf-8"), re.S).group(1)
context = moderngl.create_standalone_context(require=330)
program = context.program(vertex_shader="""#version 330
in vec2 position;
out vec2 vMapUv;
void main() { vMapUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }
""", fragment_shader="""#version 330
#define texture2D texture
in vec2 vMapUv;
out vec4 color;
uniform sampler2D map;
""" + shader + "\nvoid main() { color = terrainColor(vMapUv); }")
source_texture = context.texture(atlas.size, 4, atlas.tobytes())
mask_texture = context.texture(mask_atlas.size, 4, mask_atlas.tobytes())
cell_texture = context.texture((3, 2), 4, struct.pack(f"<{len(packed)}f", *packed), dtype="f4")
for unit, (texture, name) in enumerate([(source_texture, "map"), (mask_texture, "terrainMasks"), (cell_texture, "terrainCells")]):
    texture.filter = (moderngl.NEAREST, moderngl.NEAREST)
    texture.repeat_x = texture.repeat_y = False
    texture.use(unit)
    program[name].value = unit
program["terrainGrid"].value = (3, 2)
program["terrainAtlasGrid"].value = (columns, rows)
vertex_buffer = context.buffer(struct.pack("<8f", -1, -1, 1, -1, -1, 1, 1, 1))
vao = context.simple_vertex_array(program, vertex_buffer, "position")
framebuffer = context.simple_framebuffer(expected.size, components=4)
framebuffer.use()
vao.render(moderngl.TRIANGLE_STRIP)
actual = Image.frombytes("RGBA", expected.size, framebuffer.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
output = ROOT / "outputs/texture-mapping"
output.mkdir(parents=True, exist_ok=True)
actual.save(output / "gpu-actual.png")
expected.save(output / "gpu-expected.png")
if actual.tobytes() != expected.tobytes():
    differences = [(i, a, b) for i, (a, b) in enumerate(zip(actual.tobytes(), expected.tobytes())) if a != b]
    raise AssertionError(f"{len(differences)} differing channels; first: {differences[:10]}")
print(f"PASS: all {expected.width * expected.height:,} GPU pixels match original source/mask composites ({context.info['GL_RENDERER']}).")
context.release()
