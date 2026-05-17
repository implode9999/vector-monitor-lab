# Vector Monitor Lab Implementation Report

Generated: 2026-05-17

This report summarizes the implementation state of the project as it exists in this workspace. It is split into the two requested areas: the reusable vector screen API and the sandbox/playground application.

## Vector Screen API

The vector screen API is implemented as a TypeScript/Three.js renderer under `src/core`. Its public surface is re-exported from [src/core/index.ts](../src/core/index.ts:1), including `VectorMonitor`, `VectorProgram`, preset helpers, `sampleCommands`, and the core types.

### Public Command Model

The renderer consumes `VectorCommand` streams defined in [src/core/types.ts](../src/core/types.ts:8). Supported commands are:

- `move`: blanked beam movement to normalized X/Y coordinates.
- `line`: visible vector segment with optional intensity and per-segment RGB color.
- `color`: set current RGB beam color.
- `intensity`: set current beam drive.
- `dwell`: hold the beam at the current point.

`VectorProgram` is a small chainable builder around those commands in [src/core/VectorProgram.ts](../src/core/VectorProgram.ts:3). It provides `moveTo`, `lineTo`, `color`, `intensity`, `dwell`, `close`, and `append`. Coordinates are normalized vector-display space, roughly `[-1, 1]`, with aspect correction handled later by the transform stage.

### Parameter and Preset Model

`MonitorParams` in [src/core/types.ts](../src/core/types.ts:23) exposes the hardware-style controls used by both the library and sandbox:

- Beam/display controls: `beamIntensity`, `focus`, `beamWidth`, `bloom`, `exposure`, `contrast`, `blackLevel`.
- Phosphor controls: `persistence`, `decayCurve`, `afterglow`, `phosphorGrain`, `burnIn`.
- Vector artifacts: `blankingLeakage`, `retraceVisibility`, `dwellGain`, `cornerBrightening`, `spotKiller`.
- Deflection controls: `xGain`, `yGain`, `xOffset`, `yOffset`, `rotation`, `distortion`, `slewRate`, `deflectionLag`, `ringing`, `jitter`.
- Color/vector monitor controls: `convergence`, `rgbDecaySplit`.
- Runtime controls: `temporalSweep`, `antiAlias`, `internalScale`, `refreshHz`, `vectorBudget`.

Presets live in [src/core/presets.ts](../src/core/presets.ts:3). Implemented preset names are `asteroids-bw`, `p31-green`, `amber-terminal`, `arcade-rgb`, `storage-green`, and `blue-scope`. The Asteroids preset uses `ASTEROIDS_VECTOR_HZ = 61.5234375` from [src/core/presets.ts](../src/core/presets.ts:3); generic non-storage presets use a lower vintage-style refresh around 38 Hz, and storage mode uses a much slower 3 Hz refresh.

### Renderer Architecture

`VectorMonitor` owns the browser WebGL/Three.js renderer and the simulated phosphor surface in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:29). It is constructed with:

```ts
const monitor = new VectorMonitor(canvas, params);
```

The core lifecycle is:

```ts
monitor.setProgram(commands);
monitor.setParams(params);
monitor.render(deltaTime, elapsedTime);
monitor.clear();
monitor.dispose();
```

The render pipeline is not ordinary line drawing. It is a beam/phosphor simulation:

1. Commands are sampled into beam events by `sampleCommandsInto` in [src/core/strokeSampling.ts](../src/core/strokeSampling.ts:71).
2. Vector geometry is transformed through gain, offset, rotation, aspect correction, and distortion in [src/core/vectorGeometry.ts](../src/core/vectorGeometry.ts:13).
3. `VectorMonitor` prepares sweep segments in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:510).
4. Beam points and ribbon segments are deposited additively into an offscreen phosphor render target in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:547).
5. A decay pass ages the previous phosphor frame each browser frame in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:423).
6. A final composite pass applies exposure, contrast, bloom/glow, anti-aliasing, convergence, grain, curvature, vignette, and black level in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:451).

The renderer maintains separate concepts of display carrier refresh and simulated vector-generator refresh. `needsProgramRefresh` in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:343) lets the sandbox avoid rebuilding command streams on every browser frame. `temporalSweep` spreads a simulated vector-generator frame over modern browser/display frames when possible, so high-refresh monitors can show smoother beam sweep and phosphor behavior while the virtual hardware still runs at its own VG cadence.

### Beam Sampling and Visual Behavior

Sampling logic in [src/core/strokeSampling.ts](../src/core/strokeSampling.ts:71) models:

- Beam slew and density through `slewRate` and `vectorBudget`.
- Blanked retrace leakage when `blankingLeakage` or `retraceVisibility` are nonzero.
- Dwell and stationary point brightness.
- Endpoint and corner energy via `dwellGain` and `cornerBrightening`.
- Analog jitter and ringing.
- Phosphor tinting per preset.

The current optimized path avoids uploading low-value interior point samples and keeps point sprites for dwell, blanking leakage, and hot endpoints. Continuous strokes are represented mainly by beam ribbons in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:616).

### Performance and Portability Work Completed

The renderer has been optimized for headroom without changing the overall API:

- Command rebuilding is gated to VG refresh instead of browser refresh through [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:343) and [src/App.tsx](../src/App.tsx:530).
- Composite shader sampling was reduced so the high-refresh overdrive look is carried primarily by beam deposition rather than a heavy full-screen shader.
- Dynamic buffer update-range objects are reused in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:871), reducing per-frame garbage.
- Near-zero interior point samples are skipped in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:559), reducing beam upload cost.
- Per-sample endpoint sparkle math is gated in [src/core/strokeSampling.ts](../src/core/strokeSampling.ts:171).
- Render-target type is capability-gated in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:1060), falling back from half-float to unsigned-byte targets when required.
- WebGL1 half-float targets require `OES_texture_half_float_linear`, `OES_texture_half_float`, and `EXT_color_buffer_half_float`.
- WebGL context loss is handled in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:74), with restore currently handled by page reload.
- Renderer pixel ratio is capped at `1`, and render target size is capped at `3_800_000` pixels in [src/core/VectorMonitor.ts](../src/core/VectorMonitor.ts:12) to prevent high-DPI displays from exploding fill cost.

### Build and Package Portability

The app uses Vite with an explicit relative base path in [vite.config.ts](../vite.config.ts:5), so production assets are emitted with `./assets/...` paths and can be hosted from a subfolder/static directory. Sound URLs use `import.meta.env.BASE_URL` in [src/game/AsteroidsAudio.ts](../src/game/AsteroidsAudio.ts:14).

Runtime dependencies are kept to React, React DOM, Three.js, and lucide-react in [package.json](../package.json:17). Build/test tooling is in `devDependencies`, and the package declares Node support as `^20.19.0 || >=22.12.0` in [package.json](../package.json:6).

### Current API Limitations and Tradeoffs

- Some optional/desirable PRD command concepts are not implemented yet: per-command beam width/focus overrides, begin/end frame commands, layers/tags/object IDs, and source labels.
- The largest remaining renderer headroom win is still a future refactor: convert CPU-expanded beam ribbons into instanced geometry. That would reduce upload bytes and CPU ribbon expansion, but it adds shader complexity and requires careful visual regression testing.
- The phosphor/composite shader is still a full-screen pass every browser frame, so very high resolution displays can become fill-rate bound.
- `sampleCommandsInto` and `buildStraightVectorSegments` both walk command streams during VG refreshes; a shared typed command/deposition pipeline could remove duplicated work later.
- WebGL context restoration currently reloads the page instead of reconstructing resources in place.
- The API remains workspace-local rather than packaged/published as a standalone npm library.

## Sandbox

The sandbox is the React/Vite application that exercises the vector screen API. It lives primarily in [src/App.tsx](../src/App.tsx:399), with scenes in `src/scenes`, Asteroids reproduction code in `src/game`, and the styling/control surface in [src/styles.css](../src/styles.css:1).

### Application Shell

The sandbox opens directly into the monitor simulation. It defaults to the Asteroids scene and the `asteroids-bw` preset. The main shell contains:

- A large 4:3 monitor viewport.
- A top header with live readouts for vectors, samples, phosphor load, VG Hz, and carrier FPS.
- Seven scene tabs: Cal, Blocks, Text, Scope, Stress, Storage, and Asteroids, defined in [src/App.tsx](../src/App.tsx:48).
- A hardware parameter panel with preset selection, `120 Hz+ overdrive`, `Vector AA`, Asteroids key hints, and grouped sliders.
- A WebGL fallback message if context creation fails, implemented in [src/App.tsx](../src/App.tsx:454) and styled in [src/styles.css](../src/styles.css:228).

The sandbox exposes `window.__vectorMonitorAudit` and `window.__vectorMonitorAuditFreeze` hooks for deterministic Playwright audits in [src/App.tsx](../src/App.tsx:472).

### Hardware Controls and Settings

The sandbox defines 34 numeric hardware controls in [src/App.tsx](../src/App.tsx:71). They are grouped into Beam, Deflection, and Screen sections in [src/App.tsx](../src/App.tsx:346). Asteroids mode narrows selected ranges, including beam current, black level, convergence, phosphor grain, and refresh Hz, through [src/App.tsx](../src/App.tsx:362).

Each slider updates `MonitorParams` live through `updateControl` in [src/App.tsx](../src/App.tsx:589). Slider reset/help behavior is implemented in the `Control` and `HelpTip` components in [src/App.tsx](../src/App.tsx:809).

Current settings behavior:

- The app preserves the current `120 Hz+ overdrive` and `Vector AA` toggles while switching presets/scenes.
- User-adjusted values are retained during the current page session unless the current preset is reset or the page reloads.
- There is not yet durable `localStorage` or `sessionStorage` persistence.
- `userAdjustedParamsRef` exists in [src/App.tsx](../src/App.tsx:415), but it is not currently used for persistence.

The UI was adjusted for no page-level scrollbars in the Asteroids view, uses `100dvh` with `100vh` fallback in [src/styles.css](../src/styles.css:28), and removed a Google Fonts dependency for offline/static portability.

### Demo Scenes

Non-Asteroids scenes are built by [src/scenes/patterns.ts](../src/scenes/patterns.ts:14), returning reusable `VectorProgram` command lists.

Implemented scenes:

- Calibration: grid, center lines, convergence/color marks, and corner crosses.
- Blocks: moving arcade-like blocks, ship outline, shots, and rotating wire object.
- Text: stroke text and moving intensity/dwell examples.
- Scope: animated Lissajous/oscilloscope-like curve.
- Stress: high-vector-count fast-jump scene for performance and artifact testing.
- Storage: slow plotter-style storage-terminal behavior.

Vector text helpers live in [src/scenes/vectorText.ts](../src/scenes/vectorText.ts:59), while the Asteroids game has its own local glyph set in [src/game/AsteroidsGame.ts](../src/game/AsteroidsGame.ts:912).

### Asteroids Reproduction Mode

Asteroids is implemented in [src/game/AsteroidsGame.ts](../src/game/AsteroidsGame.ts:103). It is a playable vector-arcade reproduction built on the same command stream API rather than a separate sprite/canvas renderer.

Implemented gameplay and display behavior:

- Attract, playing, and game-over modes.
- Keyboard controls for start, rotate, thrust, fire, and hyperspace, mapped in [src/App.tsx](../src/App.tsx:31).
- Ship motion, thrust, inertia, screen wrap, firing, hyperspace, invulnerability, and respawn.
- Asteroid waves, rock splitting, scoring, bonus lives, and collisions.
- Player shots and saucer shots.
- Large/small saucer behavior with reload/y-change/action timing constants in [src/game/AsteroidsGame.ts](../src/game/AsteroidsGame.ts:14).
- HUD score, high score, lives, rocks, attract text, and game-over text.
- Rock explosions and ship breakup vectors in [src/game/AsteroidsGame.ts](../src/game/AsteroidsGame.ts:934).

The Asteroids code intentionally separates source-inspired timing from project-local vector geometry:

- Asteroids timing is modeled from public 6502/disassembly notes.
- Rock explosion stepping and ship explosion stepping are source-inspired.
- The visible ship, saucer, rock outlines, glyphs, and explosion fragments are local hand-authored project geometry, not ROM-extracted vector tables. This provenance is documented in [src/game/AsteroidsGame.ts](../src/game/AsteroidsGame.ts:937) and [src/game/AsteroidsGame.ts](../src/game/AsteroidsGame.ts:1007).

### Asteroids Audio

Asteroids sound playback is event-driven through [src/game/AsteroidsAudio.ts](../src/game/AsteroidsAudio.ts:32). It handles:

- One-shot clips: fire, beat1, beat2, bangLarge, bangMedium, bangSmall, extraShip.
- Loops: thrust, large saucer, small saucer.
- Browser unlock behavior: audio is activated after user/game input.
- Portable asset paths via Vite `BASE_URL`.

The WAV files under `public/sounds/asteroids` are user-supplied reference samples. [public/sounds/asteroids/README.md](../public/sounds/asteroids/README.md:3) explicitly notes that they should not be treated as generated project assets or redistributable arcade content without replacement or licensing.

### Audits and Verification

Project scripts are defined in [package.json](../package.json:9):

```powershell
npm run dev
npm run build
npm run preview
npm run audit:modes
npm run audit:performance
npm run audit:sliders
```

Current verification status from this workspace:

- `npm run build` passed after the latest renderer and portability changes.
- `npm run audit:modes` passed: 7 scenes, 6 presets, 2 overdrive states, and 2 AA states. The mode audit report is [artifacts/mode-audit/mode-audit.json](../artifacts/mode-audit/mode-audit.json:8).
- `npm run audit:sliders` passed: 68/68 slider checks across Asteroids and Stress. The slider audit report is [artifacts/slider-audit/slider-audit.json](../artifacts/slider-audit/slider-audit.json:8).
- `npm run audit:performance` completed four scenarios. The performance report is [artifacts/performance-audit/performance-audit.json](../artifacts/performance-audit/performance-audit.json:8).

Latest performance results:

| Scenario | Carrier sweep | FPS | Long frames |
| --- | --- | ---: | ---: |
| Asteroids | On | 60.0 | 0 |
| Asteroids | Off | 60.0 | 0 |
| Stress | On | 60.0 | 0 |
| Stress | Off | 57.4 | 9 |

The Stress/off result is expected to be the most punishing mode because it deposits each VG frame in one lump instead of spreading beam work across carrier frames. Both slider and performance audits include WebGL `ReadPixels` stall warnings from screenshot/readback collection; those warnings come from the audit harness rather than normal gameplay rendering. Slider audit success means every slider changed React state and propagated the expected renderer parameter; a visible canvas pixel delta is measured but not required for every individual slider because some controls only affect specific scenes/timing/edge cases.

### Sandbox Limitations and Followups

- Durable settings persistence is not implemented yet. The current behavior is session-only.
- The Asteroids reproduction is faithful-feeling and source-informed, but it is not a deterministic emulator and does not use original ROM vector tables.
- Asteroids audio samples need replacement/licensing before any public redistributable build.
- Audit scripts currently run through Chromium/dev server paths. A production-preview audit path would better validate `dist` output and subfolder hosting.
- `performance-audit` records performance data but does not currently fail the process on FPS/long-frame thresholds.
- The UI and renderer are tuned for the current desktop sandbox; mobile/small-screen audit coverage should be expanded before claiming portable mobile support.
- The repo is currently uncommitted/untracked in this workspace, so this report describes working-tree state rather than committed release history.
