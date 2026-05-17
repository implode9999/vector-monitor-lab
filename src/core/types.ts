export type MonitorPresetName =
  | "asteroids-bw"
  | "p31-green"
  | "amber-terminal"
  | "arcade-rgb"
  | "storage-green"
  | "blue-scope";

export type VectorCommand =
  | { type: "move"; x: number; y: number }
  | { type: "line"; x: number; y: number; intensity?: number; color?: [number, number, number] }
  | { type: "color"; color: [number, number, number] }
  | { type: "intensity"; intensity: number }
  | { type: "dwell"; duration: number };

export type BeamSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
  size: number;
};

export type MonitorParams = {
  preset: MonitorPresetName;
  temporalSweep: boolean;
  antiAlias: boolean;
  internalScale: number;
  refreshHz: number;
  beamIntensity: number;
  focus: number;
  beamWidth: number;
  bloom: number;
  persistence: number;
  decayCurve: number;
  afterglow: number;
  exposure: number;
  contrast: number;
  blackLevel: number;
  blankingLeakage: number;
  retraceVisibility: number;
  dwellGain: number;
  cornerBrightening: number;
  spotKiller: number;
  xGain: number;
  yGain: number;
  xOffset: number;
  yOffset: number;
  rotation: number;
  distortion: number;
  slewRate: number;
  deflectionLag: number;
  ringing: number;
  jitter: number;
  convergence: number;
  rgbDecaySplit: number;
  glassCurvature: number;
  vignette: number;
  phosphorGrain: number;
  burnIn: number;
  vectorBudget: number;
};

export type SceneKind =
  | "calibration"
  | "arcade"
  | "text"
  | "lissajous"
  | "stress"
  | "storage";

export type MonitorStats = {
  vectors: number;
  samples: number;
  phosphorLoad: number;
  simulatedRefreshHz: number;
};
