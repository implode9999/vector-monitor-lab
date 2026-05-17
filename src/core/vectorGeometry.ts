import type { MonitorParams } from "./types";

export const VECTOR_SCREEN_ASPECT = 4 / 3;

export type VectorTransformContext = {
  cos: number;
  sin: number;
  xGain: number;
  yGain: number;
  xOffset: number;
  yOffset: number;
  distortion: number;
};

export type VectorPoint = {
  x: number;
  y: number;
};

export function createVectorTransform(params: MonitorParams): VectorTransformContext {
  const rotation = (params.rotation * Math.PI) / 180;
  return {
    cos: Math.cos(rotation),
    sin: Math.sin(rotation),
    xGain: params.xGain,
    yGain: params.yGain,
    xOffset: params.xOffset,
    yOffset: params.yOffset,
    distortion: params.distortion,
  };
}

export function transformVectorPointInto(x: number, y: number, context: VectorTransformContext, out: VectorPoint, noise = 0) {
  const px = x * context.xGain;
  const py = y * context.yGain * VECTOR_SCREEN_ASPECT;
  const rx = px * context.cos - py * context.sin;
  const ry = px * context.sin + py * context.cos;
  const radius2 = rx * rx + ry * ry;
  const distortion = 1 + context.distortion * radius2;
  out.x = rx * distortion + context.xOffset + noise;
  out.y = ry * distortion + context.yOffset - noise * 0.7;
  return out;
}

export function transformVectorPoint(x: number, y: number, context: VectorTransformContext, noise = 0) {
  return transformVectorPointInto(x, y, context, { x: 0, y: 0 }, noise);
}
