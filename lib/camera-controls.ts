export interface CameraInput {
  panForward: number;
  panRight: number;
  yaw: number;
  tilt: number;
  zoom: number;
}

const CAMERA_CONTROL_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyQ',
  'KeyE',
  'Equal',
  'Minus',
  'NumpadAdd',
  'NumpadSubtract',
  'PageUp',
  'PageDown',
]);

function axis(codes: ReadonlySet<string>, positive: string[], negative: string[]) {
  const positiveDown = positive.some((code) => codes.has(code));
  const negativeDown = negative.some((code) => codes.has(code));
  return Number(positiveDown) - Number(negativeDown);
}

export function isCameraControlCode(code: string) {
  return CAMERA_CONTROL_CODES.has(code);
}

export function cameraInputFromCodes(codes: ReadonlySet<string>): CameraInput {
  return {
    panForward: axis(codes, ['KeyW'], ['KeyS']),
    panRight: axis(codes, ['KeyD'], ['KeyA']),
    yaw: axis(codes, ['ArrowRight'], ['ArrowLeft']),
    tilt: axis(codes, ['ArrowUp'], ['ArrowDown']),
    zoom: axis(codes, ['KeyQ', 'Equal', 'NumpadAdd', 'PageUp'], ['KeyE', 'Minus', 'NumpadSubtract', 'PageDown']),
  };
}
