import type { MonitorParams, MonitorPresetName } from "./types";

export const ASTEROIDS_VECTOR_HZ = 61.5234375;

export const defaultParams: MonitorParams = {
  preset: "arcade-rgb",
  temporalSweep: true,
  antiAlias: true,
  internalScale: 1,
  refreshHz: 38,
  beamIntensity: 0.68,
  focus: 0.6,
  beamWidth: 4.25,
  bloom: 0.28,
  persistence: 0.36,
  decayCurve: 1.16,
  afterglow: 0.16,
  exposure: 1.15,
  contrast: 1.25,
  blackLevel: 0.006,
  blankingLeakage: 0.004,
  retraceVisibility: 0.003,
  dwellGain: 0.32,
  cornerBrightening: 0.25,
  spotKiller: 0.34,
  xGain: 1,
  yGain: 1,
  xOffset: 0,
  yOffset: 0,
  rotation: 0,
  distortion: 0.018,
  slewRate: 0.95,
  deflectionLag: 0.045,
  ringing: 0.018,
  jitter: 0.0015,
  convergence: 0.0025,
  rgbDecaySplit: 0.04,
  glassCurvature: 0.04,
  vignette: 0.2,
  phosphorGrain: 0.025,
  burnIn: 0.025,
  vectorBudget: 15000,
};

const presetOverrides: Record<MonitorPresetName, Partial<MonitorParams>> = {
  "asteroids-bw": {
    preset: "asteroids-bw",
    temporalSweep: true,
    antiAlias: true,
    internalScale: 1,
    refreshHz: ASTEROIDS_VECTOR_HZ,
    beamIntensity: 0.036,
    focus: 0.6,
    beamWidth: 4.25,
    bloom: 0.3,
    persistence: 0.32,
    decayCurve: 1.18,
    afterglow: 0.12,
    exposure: 3.95,
    contrast: 1.55,
    blackLevel: 0,
    blankingLeakage: 0,
    retraceVisibility: 0,
    dwellGain: 0.72,
    cornerBrightening: 1.08,
    spotKiller: 0.22,
    distortion: 0.006,
    slewRate: 0.92,
    deflectionLag: 0.07,
    ringing: 0.024,
    jitter: 0.0018,
    convergence: 0,
    rgbDecaySplit: 0,
    glassCurvature: 0.018,
    vignette: 0.18,
    phosphorGrain: 0.008,
    burnIn: 0.015,
    vectorBudget: 15000,
  },
  "p31-green": {
    preset: "p31-green",
    beamIntensity: 0.88,
    bloom: 0.52,
    persistence: 0.34,
    afterglow: 0.3,
    exposure: 1.25,
    convergence: 0,
    rgbDecaySplit: 0,
  },
  "amber-terminal": {
    preset: "amber-terminal",
    beamIntensity: 0.78,
    bloom: 0.44,
    persistence: 0.6,
    decayCurve: 1.08,
    afterglow: 0.46,
    exposure: 1.12,
    convergence: 0,
    rgbDecaySplit: 0,
  },
  "arcade-rgb": {
    preset: "arcade-rgb",
    refreshHz: 38,
    persistence: 0.22,
    afterglow: 0.1,
    bloom: 0.42,
    convergence: 0.004,
    rgbDecaySplit: 0.04,
    blankingLeakage: 0.004,
    retraceVisibility: 0.003,
  },
  "storage-green": {
    preset: "storage-green",
    temporalSweep: false,
    refreshHz: 3,
    beamIntensity: 0.65,
    persistence: 0.99,
    decayCurve: 0.32,
    afterglow: 0.86,
    bloom: 0.28,
    burnIn: 0.3,
    blankingLeakage: 0,
    retraceVisibility: 0,
    convergence: 0,
    rgbDecaySplit: 0,
  },
  "blue-scope": {
    preset: "blue-scope",
    beamIntensity: 0.82,
    persistence: 0.2,
    afterglow: 0.16,
    bloom: 0.46,
    exposure: 1.35,
    convergence: 0,
    rgbDecaySplit: 0,
  },
};

export function paramsForPreset(preset: MonitorPresetName): MonitorParams {
  return { ...defaultParams, ...presetOverrides[preset] };
}

export function tintForPreset(preset: MonitorPresetName): [number, number, number] {
  switch (preset) {
    case "asteroids-bw":
      return [0.96, 0.99, 1];
    case "p31-green":
      return [0.3, 1, 0.32];
    case "amber-terminal":
      return [1, 0.62, 0.18];
    case "storage-green":
      return [0.5, 1, 0.42];
    case "blue-scope":
      return [0.28, 0.66, 1];
    case "arcade-rgb":
    default:
      return [0.85, 1, 0.92];
  }
}
