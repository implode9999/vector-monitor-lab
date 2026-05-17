import type { BeamSample, MonitorParams, VectorCommand } from "./types";
import { tintForPreset } from "./presets";
import { createVectorTransform, transformVectorPointInto, type VectorTransformContext } from "./vectorGeometry";

export type SampleBuffer = {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  intensity: Float32Array;
  size: Float32Array;
  pointEnergy: Float32Array;
  count: number;
  intensitySum: number;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Cursor = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
  previousAngle: number;
  continuousLine: boolean;
};

type SamplingContext = VectorTransformContext & {
  jitter: number;
  jitterTimeA: number;
  jitterTimeB: number;
};

export function createSampleBuffer(maxSamples: number): SampleBuffer {
  return {
    x: new Float32Array(maxSamples),
    y: new Float32Array(maxSamples),
    r: new Float32Array(maxSamples),
    g: new Float32Array(maxSamples),
    b: new Float32Array(maxSamples),
    intensity: new Float32Array(maxSamples),
    size: new Float32Array(maxSamples),
    pointEnergy: new Float32Array(maxSamples),
    count: 0,
    intensitySum: 0,
  };
}

export function sampleCommands(commands: VectorCommand[], params: MonitorParams, time: number): BeamSample[] {
  const buffer = createSampleBuffer(params.vectorBudget);
  sampleCommandsInto(commands, params, time, buffer);
  const samples: BeamSample[] = new Array(buffer.count);
  for (let i = 0; i < buffer.count; i += 1) {
    samples[i] = {
      x: buffer.x[i],
      y: buffer.y[i],
      r: buffer.r[i],
      g: buffer.g[i],
      b: buffer.b[i],
      intensity: buffer.intensity[i],
      size: buffer.size[i],
    };
  }
  return samples;
}

export function sampleCommandsInto(commands: VectorCommand[], params: MonitorParams, time: number, buffer: SampleBuffer): SampleBuffer {
  const tint = tintForPreset(params.preset);
  const cursor: Cursor = { x: 0, y: 0, r: tint[0], g: tint[1], b: tint[2], intensity: 1, previousAngle: 0, continuousLine: false };
  const speedFactor = lerp(1.9, 0.78, clamp(params.slewRate));
  const budget = Math.min(params.vectorBudget, buffer.x.length);
  const densityScale = estimateDensityScale(commands, params, speedFactor, budget);
  const transform = createVectorTransform(params);
  const context: SamplingContext = {
    ...transform,
    jitter: params.jitter,
    jitterTimeA: time * 4.1,
    jitterTimeB: time,
  };

  buffer.count = 0;
  buffer.intensitySum = 0;

  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const command = commands[commandIndex];
    if (buffer.count >= budget) {
      break;
    }

    if (command.type === "color") {
      [cursor.r, cursor.g, cursor.b] = command.color;
      continue;
    }

    if (command.type === "intensity") {
      cursor.intensity = command.intensity;
      continue;
    }

    if (command.type === "move") {
      if (params.blankingLeakage > 0 || params.retraceVisibility > 0) {
        addLineSamples(buffer, budget, cursor, command.x, command.y, params, context, speedFactor, densityScale, true);
      }
      cursor.x = command.x;
      cursor.y = command.y;
      cursor.continuousLine = false;
      continue;
    }

    if (command.type === "dwell") {
      const dwellSamples = Math.max(1, Math.round(command.duration * 18 * densityScale));
      const stationaryClamp = params.spotKiller > 0 ? 1 - params.spotKiller * 0.82 : 1;
      const intensity = cursor.intensity * params.beamIntensity * params.dwellGain * stationaryClamp;
      const size = params.beamWidth * (1.2 + params.bloom);
      const dwellColor = phosphorColor(params.preset, cursor.r, cursor.g, cursor.b);
      for (let i = 0; i < dwellSamples && buffer.count < budget; i += 1) {
        pushTransformedSample(buffer, cursor.x, cursor.y, dwellColor.r, dwellColor.g, dwellColor.b, intensity, size, context, i, 1.25, 0.35);
      }
      continue;
    }

    addLineSamples(buffer, budget, cursor, command.x, command.y, params, context, speedFactor, densityScale, false, command.intensity, command.color);
    cursor.previousAngle = Math.atan2(command.y - cursor.y, command.x - cursor.x);
    cursor.continuousLine = true;
    cursor.x = command.x;
    cursor.y = command.y;
  }

  return buffer;
}

function addLineSamples(
  buffer: SampleBuffer,
  budget: number,
  cursor: Cursor,
  toX: number,
  toY: number,
  params: MonitorParams,
  context: SamplingContext,
  speedFactor: number,
  densityScale: number,
  blanked: boolean,
  intensityOverride?: number,
  colorOverride?: [number, number, number],
  cornerBoost = 1,
) {
  const dx = toX - cursor.x;
  const dy = toY - cursor.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const sampleRate = blanked ? 34 : 88;
  const count = Math.max(2, Math.ceil(distance * sampleRate * speedFactor * densityScale));
  const retraceBoost = blanked ? params.retraceVisibility * (distance > 0.2 ? 0.58 : 0.28) : 0;
  const blankLeak = blanked ? params.blankingLeakage * 0.42 : 0;
  const baseIntensity = blanked ? Math.min(0.18, blankLeak + retraceBoost) : (intensityOverride ?? cursor.intensity) * params.beamIntensity * cornerBoost;
  const sourceR = colorOverride?.[0] ?? cursor.r;
  const sourceG = colorOverride?.[1] ?? cursor.g;
  const sourceB = colorOverride?.[2] ?? cursor.b;
  const color = phosphorColor(params.preset, sourceR, sourceG, sourceB);
  const velocityDim = lerp(1.28, 0.72, clamp(distance * 0.55));
  const intensity = baseIntensity * velocityDim;
  const size = params.beamWidth * (blanked ? 0.65 : 1 + params.bloom * 0.45);
  const invCount = 1 / count;
  const dwellAmount = clamp(params.dwellGain);
  const overlapGain = blanked ? 0 : params.cornerBrightening * (0.18 + dwellAmount * 0.82);
  const overlapScale = params.preset === "asteroids-bw" ? 0.92 : 0.58;
  const hasEndpointGlow = !blanked && overlapGain > 0;

  for (let i = 0; i <= count && buffer.count < budget; i += 1) {
    const t = i * invCount;
    const lag = params.deflectionLag * Math.sin(t * Math.PI) * 0.018;
    const ring = Math.sin((t + context.jitterTimeB * 0.22) * Math.PI * 6) * params.ringing * 0.012 * (1 - t);
    const x = lerp(cursor.x, toX, t) - dx * lag + dy * ring;
    const y = lerp(cursor.y, toY, t) - dy * lag - dx * ring;
    let pointEnergy = blanked ? 0.12 : 0;
    if (hasEndpointGlow) {
      const endpointDistance = Math.min(t, 1 - t);
      if (endpointDistance < 0.18) {
        const endpointFalloff = Math.pow(1 - endpointDistance / 0.18, 2.2);
        const sparkle = 0.82 + hashNoise(x * 47.3 + y * 91.7 + i * 11.13 + context.jitterTimeB * 18.0) * 0.36;
        pointEnergy += endpointFalloff * overlapGain * overlapScale * sparkle;
      }
    }
    pushTransformedSample(buffer, x, y, color.r, color.g, color.b, intensity, size, context, i, pointEnergy);
  }
}

function hashNoise(value: number) {
  return fract(Math.sin(value * 12.9898) * 43758.5453);
}

function fract(value: number) {
  return value - Math.floor(value);
}

function phosphorColor(preset: MonitorParams["preset"], r: number, g: number, b: number) {
  if (preset === "arcade-rgb") {
    return { r, g, b };
  }
  const tint = tintForPreset(preset);
  const luma = Math.max(0.08, r * 0.2126 + g * 0.7152 + b * 0.0722);
  return {
    r: tint[0] * luma,
    g: tint[1] * luma,
    b: tint[2] * luma,
  };
}

function estimateDensityScale(commands: VectorCommand[], params: MonitorParams, speedFactor: number, budget: number) {
  if (budget <= 0) {
    return 1;
  }

  let cursorX = 0;
  let cursorY = 0;
  let estimatedSamples = 0;
  const includeBlanking = params.blankingLeakage > 0 || params.retraceVisibility > 0;

  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i];
    if (command.type === "move") {
      if (includeBlanking) {
        estimatedSamples += estimateLineSampleCount(cursorX, cursorY, command.x, command.y, 34, speedFactor);
      }
      cursorX = command.x;
      cursorY = command.y;
      continue;
    }

    if (command.type === "line") {
      estimatedSamples += estimateLineSampleCount(cursorX, cursorY, command.x, command.y, 88, speedFactor);
      cursorX = command.x;
      cursorY = command.y;
      continue;
    }

    if (command.type === "dwell") {
      estimatedSamples += Math.max(1, Math.round(command.duration * 18));
    }
  }

  return estimatedSamples > budget ? clamp(budget / estimatedSamples, 0.08, 1) : 1;
}

function estimateLineSampleCount(fromX: number, fromY: number, toX: number, toY: number, sampleRate: number, speedFactor: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Math.max(2, Math.ceil(distance * sampleRate * speedFactor)) + 1;
}

function pushTransformedSample(
  buffer: SampleBuffer,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  intensity: number,
  size: number,
  context: SamplingContext,
  index: number,
  pointEnergy = 1,
  jitterScale = 1,
) {
  const noise =
    context.jitter === 0
      ? 0
      : context.jitter * jitterScale * Math.sin(index * 12.9898 + context.jitterTimeA) * Math.cos(index * 78.233 + context.jitterTimeB);
  const sampleIndex = buffer.count;
  transformVectorPointInto(x, y, context, tempPoint, noise);
  buffer.x[sampleIndex] = tempPoint.x;
  buffer.y[sampleIndex] = tempPoint.y;
  buffer.r[sampleIndex] = r;
  buffer.g[sampleIndex] = g;
  buffer.b[sampleIndex] = b;
  buffer.intensity[sampleIndex] = intensity;
  buffer.size[sampleIndex] = size;
  buffer.pointEnergy[sampleIndex] = pointEnergy;
  buffer.intensitySum += intensity;
  buffer.count = sampleIndex + 1;
}

const tempPoint = { x: 0, y: 0 };
