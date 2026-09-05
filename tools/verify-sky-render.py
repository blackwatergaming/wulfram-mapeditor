"""Compile the actual Three.js sky shader on a GPU and render all shipped skies.

Requires Pillow and moderngl. This verifies shader/asset integration, not browser UI.
"""
import json
from pathlib import Path
import struct
import subprocess

import moderngl
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
script = """
import * as THREE from 'three';
import { createSkybox } from './lib/skybox.ts';
const sky = createSkybox({ url: '' }, 5600, 5600, () => new Promise(() => {}), () => {});
const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
sky.mesh.material.onBeforeCompile(shader, null);
const expand = (text) => text.replace(/#include <([\\w]+)>/g, (_, name) => expand(THREE.ShaderChunk[name]));
const camera = new THREE.PerspectiveCamera(75, 2, 0.01, 500);
camera.lookAt(-1, 0.45, 0);
camera.updateMatrixWorld(true);
const geometry = sky.mesh.geometry;
console.log(JSON.stringify({
  vertex: expand(shader.vertexShader), fragment: expand(shader.fragmentShader),
  colorSpace: THREE.ShaderChunk.colorspace_pars_fragment,
  positions: Array.from(geometry.attributes.position.array),
  uvs: Array.from(geometry.attributes.uv.array), indices: Array.from(geometry.index.array),
  view: camera.matrixWorldInverse.elements, projection: camera.projectionMatrix.elements,
}));
sky.dispose();
"""
data = json.loads(subprocess.run(
    ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
    cwd=ROOT, text=True, capture_output=True, check=True,
).stdout)
context = moderngl.create_standalone_context(require=330)
defines = """#version 330
#define USE_MAP
#define MAP_UV uv
#define NUM_CLIPPING_PLANES 0
#define UNION_CLIPPING_PLANES 0
#define texture2D texture
"""
vertex_prefix = """
#define attribute in
#define varying out
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
in vec3 position;
in vec2 uv;
"""
fragment_prefix = """
#define varying in
out vec4 probeColor;
#define gl_FragColor probeColor
""" + data["colorSpace"] + "\nvec4 linearToOutputTexel(vec4 color) { return sRGBTransferOETF(color); }\n"
program = context.program(
    vertex_shader=defines + vertex_prefix + data["vertex"],
    fragment_shader=defines + fragment_prefix + data["fragment"],
)
pack = lambda values: struct.pack(f"<{len(values)}f", *values)
positions = context.buffer(pack(data["positions"]))
uvs = context.buffer(pack(data["uvs"]))
indices = context.buffer(struct.pack(f"<{len(data['indices'])}I", *data["indices"]))
vao = context.vertex_array(program, [(positions, "3f", "position"), (uvs, "2f", "uv")], indices)
program["projectionMatrix"].write(pack(data["projection"]))
program["viewMatrix"].write(pack(data["view"]))
program["mapTransform"].write(pack([1, 0, 0, 0, 1, 0, 0, 0, 1]))
program["map"].value = 0
program["diffuse"].value = (1, 1, 1)
program["opacity"].value = 1
context.enable(moderngl.DEPTH_TEST)
context.depth_func = "<="
manifest = json.loads((ROOT / "public/assets/manifest.json").read_text(encoding="utf-8"))
framebuffer = context.simple_framebuffer((400, 200), components=4)
framebuffer.use()
sheet = Image.new("RGB", (1200, 900), "#101214")
draw = ImageDraw.Draw(sheet)
for index, (name, asset) in enumerate(manifest["skyboxes"].items()):
    source = Image.open(ROOT / "public" / asset["url"].lstrip("/")).convert("RGBA")
    texture = context.texture(source.size, 4, source.tobytes(), internal_format=0x8C43)
    texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
    texture.repeat_x = texture.repeat_y = False
    texture.use(0)
    rgb = tuple(int(asset["horizon"][i:i+2], 16) / 255 for i in (1, 3, 5))
    framebuffer.clear(*rgb, 1, depth=1)
    vao.render()
    image = Image.frombytes("RGBA", (400, 200), framebuffer.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if len(set(image.get_flattened_data())) < 100:
        raise AssertionError(f"Sky did not render: {name}")
    if context.error != "GL_NO_ERROR":
        raise AssertionError(f"GPU error rendering {name}")
    x, y = index % 3 * 400, index // 3 * 225
    sheet.paste(image, (x, y))
    draw.text((x + 8, y + 204), f"{asset['label']} ({name})", fill="white")
    texture.release()
output = ROOT / "outputs/texture-mapping/skybox-preview.png"
output.parent.mkdir(parents=True, exist_ok=True)
sheet.save(output)
print(f"PASS: actual Three.js sky shader compiled; all {len(manifest['skyboxes'])} skies rendered ({context.info['GL_RENDERER']}).")
print(output)
context.release()
