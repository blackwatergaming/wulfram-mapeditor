import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.argv[2] ?? process.env.WULFRAM_FORGE_REMOTE_DEBUGGING_PORT ?? 9223);
const screenshotPath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
if (!target) throw new Error(`No WebView2 page target found on port ${port}.`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const events = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  } else if (message.method) {
    events.push(message);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

const frameProbeExpression = `new Promise((resolve) => {
  const samples = [];
  let previous = performance.now();
  const start = previous;
  const step = (now) => {
    samples.push(now - previous);
    previous = now;
    if (now - start < 1000) requestAnimationFrame(step);
    else {
      const sorted = samples.slice(1).sort((a, b) => a - b);
      const averageMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
      resolve({ frames: sorted.length, averageMs, fps: 1000 / averageMs, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, worstMs: sorted.at(-1) ?? 0 });
    }
  };
  requestAnimationFrame(step);
})`;

await Promise.all([
  send('Runtime.enable'),
  send('Log.enable'),
  send('Network.enable'),
  send('Page.enable'),
  send('Performance.enable'),
]);

let repositoryTest;
if (process.env.WULFRAM_FORGE_REPOSITORY_TEST === '1') {
  const before = await evaluate(`(() => {
    const select = document.querySelector('.repository-controls select');
    return { options: select?.options?.length ?? 0, slug: select?.value ?? '' };
  })()`);
  await evaluate(`(() => { document.querySelector('[title="Load selected Git source"]')?.click(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  repositoryTest = await evaluate(`(() => ({
    ...${JSON.stringify(before)},
    mapName: document.querySelector('.map-title input')?.value,
    status: document.querySelector('.statusbar > span')?.textContent?.trim(),
  }))()`);
}

let placementTest;
if (process.env.WULFRAM_FORGE_PREVIEW_TEST === '1') {
  await evaluate(`(() => {
    document.querySelector('.mode-switch button:nth-child(2)')?.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await evaluate(`(() => {
    const select = document.querySelector('.template-select');
    if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return false;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const viewportPoint = await evaluate(`(() => {
    const rect = document.querySelector('.terrain-viewport').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.52, y: rect.top + rect.height * 0.58 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: viewportPoint.x, y: viewportPoint.y });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  placementTest = await evaluate(`(() => ({
    mode: document.querySelector('.mode-switch button[aria-selected="true"]')?.textContent?.trim(),
    template: document.querySelector('.template-select')?.selectedOptions?.[0]?.textContent?.trim(),
    badge: document.querySelector('.placement-preview-badge')?.textContent?.trim(),
  }))()`);
}

let repositoryWizardTest;
if (process.env.WULFRAM_FORGE_WIZARD_TEST === '1') {
  await evaluate(`(() => { document.querySelector('[aria-label="Repository setup and diagnostics"]')?.click(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 3500));
  repositoryWizardTest = await evaluate(`(() => {
    const dialog = document.querySelector('.repository-wizard');
    const rect = dialog?.getBoundingClientRect();
    return {
      open: Boolean(dialog),
      title: dialog?.querySelector('[data-slot="dialog-title"]')?.textContent?.trim(),
      checks: [...(dialog?.querySelectorAll('.diagnostic-row') ?? [])].map((row) => ({ className: row.className, text: row.textContent?.trim() })),
      branch: dialog?.querySelector('.repository-branch-panel > div strong')?.textContent?.trim(),
      branches: [...(dialog?.querySelectorAll('.repository-branch-panel select option') ?? [])].map((option) => option.textContent),
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollHeight: dialog.scrollHeight } : null,
      withinViewport: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
    };
  })()`);
  if (process.env.WULFRAM_FORGE_DRAG_TEST === '1' || process.env.WULFRAM_FORGE_ESCAPE_TEST === '1') {
    await evaluate(`(() => { document.querySelector('.repository-wizard [data-slot="dialog-close"]')?.click(); return true; })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

let unitDragTest;
if (process.env.WULFRAM_FORGE_DRAG_TEST === '1') {
  await evaluate(`(() => {
    window.prompt = () => 'Shift Drag Test';
    window.confirm = () => true;
    [...document.querySelectorAll('.top-actions button')].find((button) => button.textContent?.includes('New'))?.click();
    document.querySelector('.mode-switch button:nth-child(2)')?.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const point = await evaluate(`(() => {
    const rect = document.querySelector('.terrain-viewport').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.48, y: rect.top + rect.height * 0.54, moveX: rect.left + rect.width * 0.61, moveY: rect.top + rect.height * 0.61 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const placed = await evaluate(`(() => ({ status: document.querySelector('.statusbar > span')?.textContent?.trim(), units: document.querySelector('.stage-stats span:nth-child(3)')?.textContent?.trim() }))()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.moveX, y: point.moveY, button: 'left', buttons: 1, modifiers: 8 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.moveX, y: point.moveY, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  unitDragTest = await evaluate(`(() => ({
    placed: ${JSON.stringify(placed)},
    status: document.querySelector('.statusbar > span')?.textContent?.trim(),
    selected: document.querySelector('.inspector-heading h2')?.textContent?.trim(),
    position: [...document.querySelectorAll('.inspector .number-grid.three input')].slice(0, 3).map((input) => input.value),
  }))()`);
}

let escapePlacementTest;
if (process.env.WULFRAM_FORGE_ESCAPE_TEST === '1') {
  await evaluate(`(() => { document.querySelector('.mode-switch button:nth-child(2)')?.click(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await new Promise((resolve) => setTimeout(resolve, 120));
  escapePlacementTest = await evaluate(`(() => ({
    activeCatalog: document.querySelectorAll('.catalog-item.active').length,
    activeTemplate: document.querySelectorAll('.template-select option:checked').length ? document.querySelector('.template-select')?.value : '',
    previewBadge: document.querySelector('.placement-preview-badge')?.textContent?.trim(),
    status: document.querySelector('.statusbar > span')?.textContent?.trim(),
  }))()`);
}

let heightmapDialogTest;
if (process.env.WULFRAM_FORGE_HEIGHTMAP_TEST === '1') {
  await evaluate(`(async () => {
    const manifest = await fetch('/assets/manifest.json').then((response) => response.json());
    const asset = Object.values(manifest.terrainTextures)[0];
    const blob = await fetch(asset.url).then((response) => response.blob());
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'heightmap-test.png', { type: 'image/png' }));
    const input = document.querySelector('input[accept="image/*"]');
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const beforeApply = await evaluate(`(() => {
    const dialog = document.querySelector('.heightmap-dialog');
    const rect = dialog?.getBoundingClientRect();
    return {
      open: Boolean(dialog),
      title: dialog?.querySelector('[data-slot="dialog-title"]')?.textContent?.trim(),
      controls: [...(dialog?.querySelectorAll('input') ?? [])].map((input) => ({ type: input.type, value: input.value, ariaLabel: input.ariaLabel })),
      presets: [...(dialog?.querySelectorAll('.heightmap-presets button') ?? [])].map((button) => button.textContent?.trim()),
      withinViewport: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
    };
  })()`);
  await evaluate(`(() => { document.querySelector('.heightmap-presets button')?.click(); [...document.querySelectorAll('.heightmap-dialog button')].find((button) => button.textContent?.includes('Apply heightmap'))?.click(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  heightmapDialogTest = await evaluate(`(() => ({
    beforeApply: ${JSON.stringify(beforeApply)},
    closed: !document.querySelector('.heightmap-dialog'),
    status: document.querySelector('.statusbar > span')?.textContent?.trim(),
  }))()`);
}

const layout = await evaluate(`(() => {
  const selectors = ['.editor-shell', '.topbar', '.workspace', '.tool-rail', '.stage-column', '.stage-toolbar', '.terrain-viewport', '.inspector'];
  return {
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, screenWidth: screen.width, screenHeight: screen.height },
    document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    elements: Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight }];
    })),
    canvases: [...document.querySelectorAll('canvas')].map((canvas) => ({ width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight })),
    images: { total: document.images.length, complete: [...document.images].filter((image) => image.complete && image.naturalWidth > 0).length },
  };
})()`);

const textureProbe = await evaluate(`(async () => {
  const manifest = await fetch('/assets/manifest.json').then((response) => response.json());
  const [name, asset] = Object.entries(manifest.terrainTextures)[0];
  const response = await fetch(asset.url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const pixel = [...context.getImageData(0, 0, 1, 1).data];
  bitmap.close();
  return { name, url: asset.url, status: response.status, contentType: response.headers.get('content-type'), width: canvas.width, height: canvas.height, pixel };
})()`);

const frameTiming = await evaluate(frameProbeExpression);
let cameraFrameTiming;
if (process.env.WULFRAM_FORGE_CAMERA_TEST === '1') {
  await evaluate(`(() => { document.querySelector('.terrain-viewport canvas')?.focus(); return true; })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
  cameraFrameTiming = await evaluate(frameProbeExpression);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
}

const metrics = await send('Performance.getMetrics');
if (screenshotPath) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
}

const relevantEvents = events
  .filter((event) => event.method === 'Log.entryAdded' || event.method === 'Runtime.exceptionThrown' || event.method === 'Network.loadingFailed')
  .map((event) => ({ method: event.method, params: event.params }));

console.log(JSON.stringify({ target: { title: target.title, url: target.url }, repositoryTest, placementTest, repositoryWizardTest, unitDragTest, escapePlacementTest, heightmapDialogTest, layout, textureProbe, frameTiming, cameraFrameTiming, metrics: metrics.metrics, events: relevantEvents, screenshotPath }, null, 2));
socket.close();
