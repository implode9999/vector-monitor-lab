# References

The implementation follows the PRD in [../VECTOR_MONITOR_PRD.md](../VECTOR_MONITOR_PRD.md).

## Source Mapping

- Wikipedia, "Vector monitor": vector displays draw arbitrary beam paths instead of raster pixels, blank dark moves, and must refresh non-storage scenes.
  https://en.wikipedia.org/wiki/Vector_monitor

- Jed Margolin, "The Secret Life of X-Y Monitors": practical arcade X-Y monitor behavior, phosphor persistence, focus, convergence, deflection, and spot-killer considerations.
  https://www.jmargolin.com/xy/xymon.pdf

- Jed Margolin, "The Atari Color X-Y Monitor": Atari/arcade color X-Y context and Quadrascan notes.
  https://www.jmargolin.com/vgens/vgens.htm

- Atari Quadrascan Color X-Y Display service manual: color X-Y setup, calibration concepts, focus/brightness/convergence controls, and service-pattern thinking.
  https://manualzz.com/doc/11348630/atari-quadrascan-color-x-y-display-service-manual

- TekWiki Tektronix 4010 and Tektronix PLOT-10 manual: storage vector terminal behavior, long persistence, plotting, and erase/write mode distinction.
  https://w140.com/tekwiki/wiki/4010
  https://w140.com/tekwiki/images/2/20/062-1288-00.pdf

- HP Journal, December 1967, "Factors in Designing a Large-Screen Wideband CRT": deflection bandwidth, spot size, focus, and high-performance CRT limits.
  https://vtda.org/pubs/HP_Journal/HP_Journal_1967-12.pdf

- Derek Holzer, "Vector Synthesis": signal-driven X/Y/Z vector-synthesis use cases and oscilloscope art context.
  https://macumbista.net/wp-content/uploads/2018/12/VectorSynthesis_DerekHolzer_2018.pdf

## Implemented Fidelity Features

- Beam commands are not raster line draws; they are sampled into beam events.
- Beam events deposit additive energy into a phosphor render target.
- Phosphor energy decays frame to frame with persistence and decay controls.
- Dwell and corner brightening create hotter points.
- Blanking and retrace can leak visible artifacts.
- Deflection lag, slew, ringing, jitter, and distortion alter geometry.
- RGB convergence and per-channel decay can separate color beams.
- Storage mode uses a long-persistence preset and slow plotting scene.
- Asteroids mode exercises the renderer with a classic vector-arcade workload.
- The Asteroids preset uses a `61.5234375 Hz` vector-generator redraw cadence, matching the current MAME Atari Asteroids driver formula `CLOCK_3KHZ / 12 / 4` from a `12.096 MHz` master clock. Generic non-storage presets use the PRD's broader `30-40 Hz` guidance, while storage mode intentionally runs much slower.
- `Carrier sweep` is an implementation feature for modern high-refresh monitors: it keeps the historical vector-generator cadence but distributes each beam pass over multiple browser refreshes when the real display can present them.
