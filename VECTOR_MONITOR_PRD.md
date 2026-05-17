# PRD: Three.js Vector Monitor Simulation Library

## 1. Product Summary

Build a reusable Three.js library that simulates old vector-monitor display technology with a dedicated test application for tuning hardware-like parameters in real time.

The goal is not a normal line renderer with glow. The library should model the visual behavior of cathode-ray vector displays: an electron beam steered over arbitrary X/Y paths, Z/intensity blanking, beam dwell brightness, phosphor persistence and decay, blooming, focus limits, analog deflection lag, color-gun convergence error, retrace artifacts, and refresh/flicker behavior. The included demo app should make those effects visible with blocks, grids, oscillating shapes, arcade-like moving objects, text strokes, and calibration patterns.

## 2. Research Basis

### 2.1 Wikipedia: Vector monitor

The Wikipedia article establishes the core product model:

- A vector monitor draws images from lines rather than a raster pixel grid.
- The beam can travel arbitrary paths instead of sweeping left-to-right and top-to-bottom.
- Dark areas can be skipped by blanking the beam while it moves.
- Brightness is tied to beam drive and how long the beam dwells on phosphor.
- Repeated refresh is required on non-storage displays, commonly around 30 to 40 frames per second.
- Complex scenes can flicker because all visible vectors must be retraced.
- Storage-tube variants can preserve images longer through phosphor or storage effects.
- Electromagnetic deflection has inertia and speed limits, so large or abrupt coordinate jumps cannot be idealized as instant movement.

Source: https://en.wikipedia.org/wiki/Vector_monitor

### 2.2 Practical arcade X-Y monitors

Atari/Wells-Gardner X-Y color monitors expose the hardware architecture that should inform the simulation:

- X and Y analog deflection channels drive horizontal and vertical beam position.
- Z/intensity controls modulate visible beam output.
- Color X-Y monitors use multiple Z/color drive paths and color-gun behavior rather than one monochrome beam.
- Brightness, contrast, focus, high voltage, and deflection correction are meaningful hardware controls.
- Spot-killer behavior matters: the display should suppress a stationary bright beam to avoid phosphor burn.
- Setup and calibration procedures use grids, boxes, dots, and convergence/linearity patterns.

Sources:

- Atari Quadrascan Color X-Y Display service manual: https://manualzz.com/doc/11348630/atari-quadrascan-color-x-y-display-service-manual
- Atari Quadrascan FAQ by Jed Margolin: https://www.jmargolin.com/vgens/vgens.htm
- The Secret Life of X-Y Monitors by Jed Margolin: https://www.jmargolin.com/xy/xymon.pdf

### 2.3 CRT and phosphor behavior

CRT references establish the visible effects that should be first-class simulation parameters:

- The electron gun, focus system, high voltage, deflection system, screen phosphor, and shadow mask or gun geometry all affect the final image.
- Beam focus is not constant across the screen. Edges and corners can be softer or less linear.
- Phosphor persistence controls how long a line remains visible after excitation.
- Different phosphor types have different color, brightness, and decay characteristics.
- Beam current, dwell time, phosphor efficiency, focus, and high voltage contribute to perceived brightness and blooming.
- Color displays introduce convergence and registration imperfections where RGB beams do not perfectly overlap.

Sources:

- The Secret Life of X-Y Monitors: https://www.jmargolin.com/xy/xymon.pdf
- TekWiki Tektronix 4010 overview: https://w140.com/tekwiki/wiki/4010
- Tektronix PLOT-10 Terminal Control System User's Manual: https://w140.com/tekwiki/images/2/20/062-1288-00.pdf

### 2.4 Storage vector displays

Tektronix storage terminals show a distinct operating mode:

- A display can preserve drawn vectors without continuously refreshing every line.
- Erase, write-through, stored persistence, and decay modes should be represented as a separate preset family.
- Storage mode is useful for CAD-like drawings, terminal output, and slow plotter-style graphics.

Sources:

- TekWiki Tektronix 4010 overview: https://w140.com/tekwiki/wiki/4010
- Tektronix PLOT-10 manual: https://w140.com/tekwiki/images/2/20/062-1288-00.pdf

### 2.5 Wideband/high-performance CRT references

Oscilloscope and wideband CRT references inform the display limits:

- Bandwidth, deflection amplifier response, spot size, and high-voltage design limit how sharply and quickly the beam can move.
- A renderer should allow deliberately imperfect bandwidth and slew limits rather than drawing ideal mathematical lines.

Source:

- Hewlett-Packard Journal, "Factors in Designing a Large-Screen Wideband CRT": https://vtda.org/pubs/HP_Journal/HP_Journal_1967-12.pdf

### 2.6 Vector synthesis and media-art references

Modern vector-synthesis references frame the creative target:

- Audio or procedural signals can directly modulate X, Y, and intensity.
- Lissajous curves, oscilloscope art, analog feedback, and beam modulation should be easy to express.
- The API should accept vector instructions as streams, not only static paths.

Source:

- Derek Holzer, "Vector Synthesis: a Media-Archaeological Investigation into Sound-Modulated Light": https://macumbista.net/wp-content/uploads/2018/12/VectorSynthesis_DerekHolzer_2018.pdf

## 3. Product Goals

1. Provide a reusable Three.js vector-monitor simulation library.
2. Render old CRT vector-display behavior with high visual fidelity.
3. Support monochrome, color arcade X-Y, storage terminal, oscilloscope, and stylized custom presets.
4. Provide a test app with real on-screen controls for hardware parameters.
5. Make the demo visually useful: calibration grids, blocks, moving objects, text, vector trails, and stress scenes.
6. Keep the renderer usable in creative coding, retro games, educational displays, and UI experiments.
7. Expose enough API surface for external applications to feed live vector command lists or procedural signal streams.

## 4. Non-Goals

- Do not emulate any single historical monitor circuit at component accuracy in v1.
- Do not make a raster post-processing glow effect and call it done.
- Do not require WebGPU in v1. WebGL/Three.js compatibility is the baseline.
- Do not ship ROMs, copyrighted arcade assets, or full game clones.
- Do not model dangerous CRT hardware procedures beyond safe educational controls.
- Do not prioritize photographic cabinet modeling over display behavior.

## 5. Target Users

- Creative coders building oscilloscope/vector art.
- Game developers making vector-arcade visuals.
- Educators explaining CRT/vector display technology.
- Retro-computing enthusiasts who want believable monitor behavior.
- Three.js developers who want a drop-in vector CRT effect with a clean API.

## 6. Core Concepts

### 6.1 Vector Command Stream

The library should consume a sequence of beam instructions:

- Move beam to X/Y with blanking.
- Draw from current X/Y to next X/Y with intensity.
- Set RGB or phosphor color.
- Set Z/intensity.
- Set beam width/focus override.
- Wait/dwell at a point.
- Begin/end frame.
- Optional metadata: layer, tag, object id, source label.

Coordinates should support normalized display space first: `x` and `y` in `[-1, 1]`. Optional helpers can map arcade coordinate ranges, terminal coordinate ranges, or pixels into normalized space.

### 6.2 Beam Model

The beam should be simulated as a moving spot, not just a final line segment.

Parameters:

- Beam current/intensity.
- Beam diameter.
- Focus.
- Edge defocus.
- Bloom amount.
- Dwell brightness gain.
- Beam velocity brightness compensation.
- Maximum slew rate.
- Deflection lag.
- Retrace visibility.
- Blanking speed.
- Spot-killer threshold.

Expected behavior:

- Slow beam movement appears brighter than fast movement.
- Stationary or slow points bloom unless spot killer or clamp settings limit them.
- Fast blanked moves may still leave faint retrace if blanking is imperfect.
- Sharp corners can brighten because of dwell/velocity change.

### 6.3 Phosphor Model

The display surface should accumulate energy and decay over time.

Parameters:

- Persistence time.
- Decay curve shape.
- Initial excitation response.
- Color tint.
- Afterglow color shift.
- Saturation threshold.
- Burn-in/ghost image accumulation.
- Noise/sparkle/grain.

Preset examples:

- `p31-green`: bright green oscilloscope style, medium-short persistence.
- `p1-green`: classic general-purpose green.
- `p11-blue`: blue short-persistence style.
- `amber-terminal`: warm terminal-like phosphor.
- `arcade-rgb`: color X-Y display with lower persistence and RGB convergence behavior.
- `storage-green`: long storage-tube style with explicit erase/fade controls.

### 6.4 Deflection Model

The deflection system should deliberately limit ideal geometry.

Parameters:

- X gain.
- Y gain.
- X/Y offset.
- Rotation.
- Aspect correction.
- Pincushion/barrel distortion.
- Linearity error.
- X/Y bandwidth.
- Slew limit.
- Overshoot/ringing.
- Jitter/drift.
- Corner focus loss.

Expected behavior:

- Calibration grid can bow, stretch, or drift.
- Large jumps or fast shapes can show lag or rounded corners.
- Optional overshoot can make lines wobble like analog circuits.

### 6.5 Color X-Y Model

Color vector monitors should simulate more than tinting lines.

Parameters:

- RGB gun intensity.
- Per-channel convergence offset.
- Per-channel focus.
- Per-channel decay.
- Per-channel bloom.
- White balance.
- Shadow-mask or aperture grille hint, optional and subtle.
- Color bleed/saturation.

Expected behavior:

- White lines can split slightly at edges when convergence is imperfect.
- Red, green, and blue decay can differ.
- High-intensity color vectors can bloom and desaturate.

### 6.6 Storage Tube Mode

Storage mode should be a separate display mode:

- Drawn vectors remain until explicit erase or long decay.
- Current write beam can be visible separately from stored trace.
- Optional "flood" or erase animation can clear the screen.
- No normal frame-by-frame redraw flicker unless the app requests live overlays.

## 7. Library Deliverables

### 7.1 Package Structure

Proposed project layout:

```text
src/
  core/
    VectorMonitor.ts
    VectorProgram.ts
    BeamSimulator.ts
    PhosphorSurface.ts
    Presets.ts
    types.ts
  shaders/
    beam.vert
    beam.frag
    phosphor.frag
    composite.frag
  geometry/
    strokeSampling.ts
    vectorText.ts
    calibrationPatterns.ts
  three/
    VectorMonitorMesh.ts
    createVectorMonitorScene.ts
demo/
  src/
    App.tsx
    scenes/
    controls/
    styles/
docs/
  references.md
  api.md
```

### 7.2 Public API

Minimum v1 API:

```ts
const monitor = new VectorMonitor({
  preset: "arcade-rgb",
  resolution: [1600, 1200],
  phosphor: { persistence: 0.18, bloom: 0.6 },
  beam: { focus: 0.42, slewRate: 1.0 }
});

monitor.setProgram(program);
monitor.update(deltaTime);
monitor.render(renderer, camera);
```

Vector program builder:

```ts
const program = new VectorProgram()
  .moveTo(-0.8, -0.4)
  .color(0.1, 1.0, 0.25)
  .intensity(0.85)
  .lineTo(0.8, -0.4)
  .lineTo(0.0, 0.6)
  .close();
```

Scene helper:

```ts
const display = createVectorMonitorDisplay({
  mount,
  preset: "p31-green",
  controls: true
});
```

### 7.3 Rendering Architecture

Recommended v1 approach:

1. CPU samples vector commands into beam events.
2. Beam events are uploaded to GPU geometry or data textures.
3. A beam pass deposits energy into a phosphor render target.
4. A decay pass reduces phosphor energy over time.
5. A composite pass adds bloom, glass, mask, scan-like surface imperfections, vignette, noise, and exposure.
6. Three.js displays the simulated screen as a full-screen plane or material that can be embedded in 3D scenes.

This preserves the important behavior: the library is not drawing final pixels directly; it is drawing beam energy into a surface that behaves like phosphor.

## 8. Test Application Requirements

### 8.1 Primary Screen

The test application should open directly into the monitor simulation, not a marketing page.

Layout:

- Large central vector monitor viewport.
- Compact hardware control panel.
- Scene preset tabs.
- Live readout strip: vector count, beam samples, frame rate, phosphor load, simulated refresh.
- Reset/randomize controls.

### 8.2 Required Scene Presets

1. Calibration Grid
   - Border rectangle, center crosshair, dot matrix, corner circles, convergence marks.
   - Used to tune geometry, focus, and convergence.

2. Arcade Blocks
   - Moving rectangular blocks, bouncing outlines, rotating wire objects, particle-like sparks.
   - Used to test motion, blanking, and persistence.

3. Vector Text
   - Stroke-font labels, moving captions, brightness variation by stroke speed.
   - Used to test text clarity and line joins.

4. Lissajous/Oscilloscope
   - Signal-driven X/Y curves with phase/frequency controls.
   - Used to test continuous analog motion.

5. Stress Test
   - High vector count, fast jumps, sharp corners, and dense overlapping geometry.
   - Used to expose flicker, persistence, and beam speed limits.

6. Storage Terminal
   - Slowly plotted lines and text with explicit erase.
   - Used to demonstrate storage-tube behavior.

### 8.3 Hardware Controls

Controls should be live and visible:

- Preset: p31 green, amber, arcade RGB, storage green, custom.
- Beam intensity.
- Beam focus.
- Beam width.
- Bloom.
- Persistence.
- Decay curve.
- Exposure.
- Contrast.
- Black level.
- Blanking leakage.
- Retrace visibility.
- Dwell gain.
- Corner brightening.
- Spot-killer threshold.
- X gain.
- Y gain.
- X offset.
- Y offset.
- Rotation.
- Pincushion/barrel distortion.
- X/Y slew rate.
- Deflection lag.
- Overshoot/ringing.
- Jitter.
- RGB convergence X/Y offsets.
- RGB decay split.
- Glass curvature.
- Vignette.
- Phosphor grain/noise.
- Burn-in amount.
- Refresh rate.
- Vector budget.

Control design requirement: each control must actually update the renderer. No inert decorative sliders.

### 8.4 Visual Fidelity Acceptance Criteria

The demo should visibly demonstrate:

- Lines glow from beam energy rather than flat CSS color.
- Trails fade according to persistence settings.
- Slow points and corners can become brighter.
- Fast movement can dim or leave gaps depending on beam settings.
- Blank moves can be hidden or slightly visible depending on leakage.
- High intensity causes bloom and focus softness.
- Geometry can distort with X/Y calibration controls.
- Color mode can show convergence error.
- Storage mode behaves differently from refresh mode.
- Dense scenes can flicker or smear when refresh/vector budget is stressed.

## 9. Documentation Requirements

Create:

- `README.md`: overview, install/run commands, demo URL, basic usage.
- `docs/references.md`: sources and how each influenced the simulation.
- `docs/api.md`: public API with examples.
- Inline comments only where shader or beam-sampling math is not obvious.
- Demo help panel with concise labels, not a long tutorial overlay.

## 10. Technical Requirements

- Use Three.js as the rendering foundation.
- Use TypeScript for the library and demo.
- Use React + Vite for the test app unless a lighter setup proves sufficient.
- Keep the library separable from the demo.
- Avoid hard dependency on React in the library.
- Support normal browser resize and high-DPI rendering.
- Provide performance controls for resolution and beam sample count.
- Build should run on Windows from this workspace.

## 11. Performance Targets

Baseline target on a modern desktop browser:

- 60 fps for medium scenes at 1280 x 960 simulation resolution.
- 30 fps or better for stress scenes with intentionally high vector counts.
- User-selectable internal phosphor resolution: low, medium, high, ultra.
- Graceful degradation: lower sample count or resolution rather than freezing.
- Modern display refresh should act as the high-rate carrier for phosphor decay, bloom, glass, and smooth visible motion while the simulated beam refresh remains the lower vintage vector-monitor refresh.

## 12. Implementation Milestones

### Milestone 1: Library Skeleton

- Project scaffold.
- Vector command model.
- Presets and parameter schema.
- Basic Three.js render target pipeline.

### Milestone 2: Beam and Phosphor

- Beam sampling.
- Energy deposition.
- Persistence decay.
- Bloom/composite pass.
- Monochrome presets.

### Milestone 3: Hardware Imperfections

- Deflection lag and slew.
- Blanking/retrace.
- Dwell brightness.
- Spot killer.
- Distortion and focus variation.

### Milestone 4: Color X-Y

- RGB beam channels.
- Convergence offsets.
- Per-channel decay/bloom.
- Arcade color preset.

### Milestone 5: Test Application

- Full-screen monitor viewport.
- Hardware control panel.
- Calibration, arcade blocks, text, Lissajous, stress, and storage scenes.
- Live stats and preset save/reset.

### Milestone 6: Verification and Polish

- Build check.
- Browser verification.
- Screenshot review across desktop and smaller viewport.
- Source documentation.
- Final tuning pass for visual credibility.

## 13. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Renderer looks like generic neon lines | Fails core goal | Use phosphor accumulation pipeline, velocity/dwell effects, decay, and calibration scenes from the start |
| Too slow at high vector counts | Demo becomes unusable | Add internal resolution scaling, sample budget, and stress-scene controls |
| Historical parameter names become pseudo-accurate | Misleading documentation | Document each control as "inspired by" unless exact circuit behavior is implemented |
| Browser/GPU differences affect bloom and exposure | Visual inconsistency | Provide calibration presets and stable default exposure |
| Storage mode scope expands too far | Delays v1 | Implement storage as a separate long-persistence/erase path first |

## 14. Open Questions

1. Should the first implementation prioritize color arcade X-Y or monochrome oscilloscope accuracy?
2. Should the library expose low-level signal input, for audio-driven X/Y/Z streams, in v1 or v1.1?
3. Should the demo include an export/import JSON preset system?
4. Should burn-in be only temporary/visual in v1, or persist between sessions through local storage?
5. Should the final package be published-ready, or kept as a workspace library plus demo first?

## 15. Definition of Done

The first complete version is done when:

- The workspace contains a reusable Three.js/TypeScript vector monitor library.
- The demo app runs locally and opens to the simulation screen.
- On-screen hardware controls change the visual output live.
- At least six scene presets are implemented.
- Monochrome, color X-Y, and storage-like presets are available.
- Beam, phosphor, bloom, persistence, blanking, deflection, and convergence effects are visible.
- Documentation explains the simulation model and links the references.
- The app is browser-verified with screenshots.

## 16. Reference List

- Wikipedia, "Vector monitor": https://en.wikipedia.org/wiki/Vector_monitor
- Jed Margolin, "The Secret Life of X-Y Monitors": https://www.jmargolin.com/xy/xymon.pdf
- Jed Margolin, "The Atari Color X-Y Monitor": https://www.jmargolin.com/vgens/vgens.htm
- Atari Quadrascan Color X-Y Display service manual: https://manualzz.com/doc/11348630/atari-quadrascan-color-x-y-display-service-manual
- TekWiki, "4010": https://w140.com/tekwiki/wiki/4010
- Tektronix, "PLOT-10 Terminal Control System User's Manual": https://w140.com/tekwiki/images/2/20/062-1288-00.pdf
- Hewlett-Packard Journal, December 1967: https://vtda.org/pubs/HP_Journal/HP_Journal_1967-12.pdf
- Derek Holzer, "Vector Synthesis": https://macumbista.net/wp-content/uploads/2018/12/VectorSynthesis_DerekHolzer_2018.pdf
- Alvy Ray Smith, "Special Effects for Star Trek II: The Genesis Demo": https://alvyray.com/Papers/CG/StarTrekII.pdf

## 17. Source Coverage Notes

The Wikipedia page contains historical and bibliographic references that are not all equally useful for implementation. The PRD prioritizes accessible technical sources that describe display behavior, signal paths, CRT/phosphor behavior, and vector-display use cases. Historical references such as early CRT invention notes, newspaper coverage, and book citations are useful context but do not directly add v1 simulation controls.
