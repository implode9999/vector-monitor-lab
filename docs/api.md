# API

## `VectorMonitor`

```ts
const monitor = new VectorMonitor(canvas, params);
monitor.setProgram(commands);
monitor.setParams(params);
monitor.render(deltaTime, elapsedTime);
monitor.clear();
monitor.dispose();
```

`VectorMonitor` owns the Three.js renderer, phosphor render targets, beam deposit pass, decay pass, and final composite pass.

## `VectorProgram`

```ts
const program = new VectorProgram()
  .moveTo(-0.5, -0.5)
  .color(0.2, 1, 0.4)
  .intensity(0.9)
  .lineTo(0.5, -0.5)
  .lineTo(0, 0.5)
  .dwell(0.25);
```

Commands:

- `moveTo(x, y)`: move with beam blanking.
- `lineTo(x, y, intensity?, color?)`: draw a vector segment.
- `color(r, g, b)`: set current RGB beam color.
- `intensity(value)`: set current beam intensity.
- `dwell(duration)`: hold beam at the current point.
- `close()`: line back to first move command.

Coordinates are normalized X-Y display space, roughly `-1..1`.

## `MonitorParams`

Important parameters:

- `beamIntensity`: electron beam current.
- `focus`: spot sharpness.
- `beamWidth`: base spot size.
- `bloom`: high-energy halo.
- `persistence`: phosphor retention.
- `decayCurve`: decay response curve.
- `afterglow`: short/medium phosphor ghost trail strength.
- `blankingLeakage`: visible beam during nominally blank moves.
- `retraceVisibility`: retrace artifact strength.
- `dwellGain`: stationary/corner brightness gain.
- `spotKiller`: stationary beam suppression.
- `xGain`, `yGain`, `xOffset`, `yOffset`, `rotation`: calibration controls.
- `distortion`: barrel/pincushion-style geometry error.
- `slewRate`, `deflectionLag`, `ringing`, `jitter`: analog deflection behavior.
- `convergence`, `rgbDecaySplit`: color X-Y imperfections.
- `glassCurvature`, `vignette`, `phosphorGrain`, `afterglow`, `burnIn`: screen/composite behavior.
- `vectorBudget`: maximum beam samples per frame.

## Presets

```ts
paramsForPreset("arcade-rgb");
paramsForPreset("asteroids-bw");
paramsForPreset("p31-green");
paramsForPreset("amber-terminal");
paramsForPreset("blue-scope");
paramsForPreset("storage-green");
```
