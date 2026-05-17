import { VectorProgram } from "../core/VectorProgram";
import type { SceneKind, VectorCommand } from "../core/types";
import { drawText } from "./vectorText";

const scenePrograms: Record<SceneKind, VectorProgram> = {
  calibration: new VectorProgram(),
  arcade: new VectorProgram(),
  text: new VectorProgram(),
  lissajous: new VectorProgram(),
  stress: new VectorProgram(),
  storage: new VectorProgram(),
};

export function buildScene(kind: SceneKind, time: number): VectorProgram {
  const program = scenePrograms[kind] ?? scenePrograms.calibration;
  program.commands.length = 0;
  switch (kind) {
    case "calibration":
      return calibrationScene(program, time);
    case "arcade":
      return arcadeScene(program, time);
    case "text":
      return textScene(program, time);
    case "lissajous":
      return lissajousScene(program, time);
    case "stress":
      return stressScene(program, time);
    case "storage":
      return storageScene(program, time);
    default:
      return calibrationScene(program, time);
  }
}

function calibrationScene(p: VectorProgram, time: number) {
  appendCommands(p, CALIBRATION_PREFIX);
  for (let i = 0; i < 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    const wobble = Math.sin(time * 1.4 + i) * 0.003;
    p.moveTo(Math.cos(a) * (0.18 + wobble), Math.sin(a) * (0.18 + wobble)).lineTo(
      Math.cos(a + 0.06) * 0.18,
      Math.sin(a + 0.06) * 0.18,
      0.5,
    );
  }
  appendCommands(p, CALIBRATION_SUFFIX);
  return p;
}

function arcadeScene(p: VectorProgram, time: number) {
  appendCommands(p, ARCADE_FRAME);
  const blockCount = 9;
  for (let i = 0; i < blockCount; i += 1) {
    const x = -0.75 + i * 0.19;
    const y = 0.45 + Math.sin(time * 1.7 + i * 0.74) * 0.18;
    const hue = i % 3;
    p.color(hue === 0 ? 1 : 0.2, hue === 1 ? 1 : 0.35, hue === 2 ? 1 : 0.28);
    rect(p, x, y, 0.12, 0.08, 0.86);
  }
  p.color(0.25, 1, 0.32);
  const shipX = Math.sin(time * 1.2) * 0.55;
  p.moveTo(shipX, -0.62).lineTo(shipX - 0.12, -0.45, 0.95).lineTo(shipX, -0.5, 0.62).lineTo(shipX + 0.12, -0.45, 0.95).lineTo(shipX, -0.62, 0.95);
  p.color(1, 0.2, 0.18);
  for (let s = 0; s < 5; s += 1) {
    const x = Math.sin(time * (1.4 + s * 0.11) + s) * 0.78;
    const y = ((time * (0.28 + s * 0.04) + s * 0.17) % 1.6) - 0.8;
    p.moveTo(x, y - 0.05).lineTo(x, y + 0.05, 0.9).dwell(0.25);
  }
  p.color(0.95, 0.85, 0.25);
  const a = time * 1.1;
  wireCube(p, Math.cos(a) * 0.34, Math.sin(a * 0.7) * 0.16, 0.19, a);
  return p;
}

function textScene(p: VectorProgram, time: number) {
  appendCommands(p, TEXT_STATIC);
  p.color(1, 0.28, 0.24);
  const sweep = -0.92 + ((time * 0.42) % 1.84);
  p.moveTo(sweep, -0.42).lineTo(sweep + 0.24, -0.42, 0.96).dwell(0.5);
  p.color(0.42, 1, 0.48);
  for (let i = 0; i < 18; i += 1) {
    const x = -0.86 + i * 0.1;
    p.moveTo(x, -0.68).lineTo(x + 0.04, -0.58 + Math.sin(time * 2 + i) * 0.04, 0.38 + i / 40);
  }
  return p;
}

function lissajousScene(p: VectorProgram, time: number) {
  p.color(0.25, 1, 0.42);
  let first = true;
  for (let i = 0; i <= 720; i += 1) {
    const t = (i / 720) * Math.PI * 2;
    const x = Math.sin(t * 3 + time * 0.9) * 0.74;
    const y = Math.sin(t * 4 + time * 1.23 + Math.sin(time) * 0.7) * 0.58;
    if (first) {
      p.moveTo(x, y);
      first = false;
    } else {
      const colorShift = (Math.sin(t * 2 + time) + 1) / 2;
      p.lineTo(x, y, 0.42 + colorShift * 0.44, [0.2 + colorShift * 0.4, 1, 0.38 + colorShift * 0.55]);
    }
  }
  p.color(0.2, 0.65, 1);
  p.moveTo(-0.92, 0).lineTo(0.92, 0, 0.15);
  p.moveTo(0, -0.72).lineTo(0, 0.72, 0.15);
  return p;
}

function stressScene(p: VectorProgram, time: number) {
  for (let i = 0; i < 96; i += 1) {
    const a = i * 2.399 + time * 0.22;
    const b = i * 1.271 - time * 0.35;
    const r = 0.12 + (i % 17) * 0.045;
    const x = Math.cos(a) * r;
    const y = Math.sin(b) * r * 0.82;
    const x2 = Math.cos(a + 1.7) * (0.2 + (i % 11) * 0.055);
    const y2 = Math.sin(b + 2.2) * (0.16 + (i % 13) * 0.044);
    p.color(i % 3 === 0 ? 1 : 0.25, i % 3 === 1 ? 1 : 0.35, i % 3 === 2 ? 1 : 0.28);
    p.moveTo(x, y).lineTo(x2, y2, 0.35 + (i % 9) * 0.06).dwell(i % 12 === 0 ? 0.2 : 0);
  }
  return p;
}

function storageScene(p: VectorProgram, time: number) {
  appendCommands(p, STORAGE_STATIC);
  const progress = Math.min(1, time * 0.075);
  const points = 80;
  p.moveTo(-0.78, -0.36);
  for (let i = 0; i < points * progress; i += 1) {
    const x = -0.78 + (i / points) * 1.56;
    const y = -0.36 + Math.sin(i * 0.22) * 0.14 + Math.cos(i * 0.09) * 0.18;
    p.lineTo(x, y, 0.52);
  }
  for (let i = 0; i < Math.floor(12 * progress); i += 1) {
    const x = -0.72 + i * 0.12;
    p.moveTo(x, 0.1).lineTo(x + 0.08, 0.2 + Math.sin(i + time) * 0.04, 0.44);
  }
  return p;
}

function rect(p: VectorProgram, x: number, y: number, w: number, h: number, intensity: number) {
  p.moveTo(x, y).lineTo(x + w, y, intensity).lineTo(x + w, y + h, intensity).lineTo(x, y + h, intensity).lineTo(x, y, intensity);
}

function cross(p: VectorProgram, x: number, y: number) {
  p.moveTo(x - 0.04, y).lineTo(x + 0.04, y, 0.7);
  p.moveTo(x, y - 0.04).lineTo(x, y + 0.04, 0.7);
}

const CUBE_POINTS: Array<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-0.55, -0.55],
  [1.45, -0.55],
  [1.45, 1.45],
  [-0.55, 1.45],
];

const CUBE_EDGES: Array<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const cubeX = new Float32Array(CUBE_POINTS.length);
const cubeY = new Float32Array(CUBE_POINTS.length);

function wireCube(p: VectorProgram, cx: number, cy: number, size: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i < CUBE_POINTS.length; i += 1) {
    const x = CUBE_POINTS[i][0];
    const y = CUBE_POINTS[i][1];
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    cubeX[i] = cx + rx * size;
    cubeY[i] = cy + ry * size * 0.76;
  }
  for (const [a, b] of CUBE_EDGES) {
    p.moveTo(cubeX[a], cubeY[a]).lineTo(cubeX[b], cubeY[b], 0.72);
  }
}

function appendCommands(program: VectorProgram, commands: VectorCommand[]) {
  program.commands.push(...commands);
}

function staticCommands(build: (program: VectorProgram) => void): VectorCommand[] {
  const program = new VectorProgram();
  build(program);
  return program.commands;
}

const CALIBRATION_PREFIX = staticCommands((p) => {
  p.color(0.35, 1, 0.38).intensity(0.72);
  rect(p, -0.92, -0.72, 1.84, 1.44, 0.88);
  rect(p, -0.78, -0.58, 1.56, 1.16, 0.46);
  for (let i = -8; i <= 8; i += 1) {
    const x = i / 10;
    p.moveTo(x, -0.72).lineTo(x, 0.72, i === 0 ? 0.92 : 0.25);
  }
  for (let j = -6; j <= 6; j += 1) {
    const y = j / 10;
    p.moveTo(-0.92, y).lineTo(0.92, y, j === 0 ? 0.92 : 0.25);
  }
});

const CALIBRATION_SUFFIX = staticCommands((p) => {
  cross(p, -0.82, -0.62);
  cross(p, 0.82, -0.62);
  cross(p, -0.82, 0.62);
  cross(p, 0.82, 0.62);
  p.color(1, 0.25, 0.2);
  p.moveTo(-0.16, 0).lineTo(0.16, 0, 0.95);
  p.color(0.25, 0.45, 1);
  p.moveTo(0, -0.16).lineTo(0, 0.16, 0.95);
  p.color(0.44, 1, 0.5);
  drawText(p, "XY CAL", -0.26, -0.88, 0.12, 0.55);
});

const ARCADE_FRAME = staticCommands((p) => {
  p.color(0.25, 0.95, 1);
  rect(p, -0.92, -0.76, 1.84, 1.52, 0.32);
});

const TEXT_STATIC = staticCommands((p) => {
  p.color(0.36, 1, 0.45);
  drawText(p, "VECTOR MONITOR", -0.74, 0.38, 0.14, 0.86);
  p.color(1, 0.58, 0.16);
  drawText(p, "Z INTENSITY  DWELL  DECAY", -0.86, 0.08, 0.095, 0.56);
  p.color(0.34, 0.62, 1);
  drawText(p, "BLANKED MOVES LEAK WHEN TUNED", -0.88, -0.16, 0.074, 0.44);
});

const STORAGE_STATIC = staticCommands((p) => {
  p.color(0.5, 1, 0.42);
  rect(p, -0.88, -0.68, 1.76, 1.36, 0.28);
  drawText(p, "TEK STORAGE MODE", -0.72, 0.45, 0.11, 0.58);
});
