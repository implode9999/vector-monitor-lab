import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Activity, Crosshair, Gamepad2, MonitorUp, RotateCcw, SlidersHorizontal, Zap } from "lucide-react";
import { VectorMonitor } from "./core/VectorMonitor";
import { paramsForPreset } from "./core/presets";
import type { MonitorParams, MonitorPresetName, MonitorStats, SceneKind, VectorCommand } from "./core/types";
import { buildScene } from "./scenes/patterns";
import { AsteroidsGame, type AsteroidsSnapshot } from "./game/AsteroidsGame";
import { AsteroidsAudio } from "./game/AsteroidsAudio";

type DemoScene = SceneKind | "asteroids";
type NumericParamKey = {
  [Key in keyof MonitorParams]: MonitorParams[Key] extends number ? Key : never;
}[keyof MonitorParams];
type ControlDef = {
  key: NumericParamKey;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
};
type ActiveHelp = {
  title: string;
  body: string;
  left: number;
  top: number;
  width: number;
  visible: boolean;
};

const asteroidsKeyMap: Record<string, keyof AsteroidsGame["input"]> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "thrust",
  KeyW: "thrust",
  Space: "fire",
  KeyH: "hyperspace",
  ShiftLeft: "hyperspace",
  ShiftRight: "hyperspace",
  Enter: "start",
  Digit1: "start",
};

const appTitle = "Vector Monitor Lab Playground Sandbox";

const sceneTabs: Array<{ id: DemoScene; label: string }> = [
  { id: "calibration", label: "Cal" },
  { id: "arcade", label: "Blocks" },
  { id: "text", label: "Text" },
  { id: "lissajous", label: "Scope" },
  { id: "stress", label: "Stress" },
  { id: "storage", label: "Storage" },
  { id: "asteroids", label: "Asteroids" },
];

const presetOptions: MonitorPresetName[] = ["asteroids-bw", "arcade-rgb", "p31-green", "amber-terminal", "blue-scope", "storage-green"];
const presetLabels: Record<MonitorPresetName, string> = {
  "asteroids-bw": "Asteroids B/W",
  "arcade-rgb": "Arcade RGB",
  "p31-green": "P31 Green Phosphor",
  "amber-terminal": "Amber Terminal",
  "blue-scope": "Blue Oscilloscope",
  "storage-green": "Storage Tube Green",
};

const projectOverview =
  "Vector Monitor Lab Playground Sandbox is a real-time Three.js model of an X-Y vector display. Made by Jason Cohen, Version 1.0 Sandbox, Vector API 1.0. It turns scene geometry into beam commands, samples the beam path, applies deflection limits, phosphor decay, bloom, persistence, and screen artifacts, then renders why old vector monitors look bright, sharp, alive, and physically imperfect. It is also a love letter to gaming: the kind of glowing line art that made arcades feel electric. Codex and AI coding bring me back to my 14-year-old self in the arcades, dreaming about the holodeck, experimenting, breaking things, tuning the machine, and chasing that first impossible feeling of making graphics move under my own control on my first computer, a Commodore VIC-20 with 3K memory and BASIC language.";

const controls: ControlDef[] = [
  {
    key: "beamIntensity",
    label: "Beam current",
    help: "Raises simulated electron beam energy. More current excites the phosphor harder, so strokes get brighter, bloomier, and easier to overload.",
    min: 0,
    max: 1.6,
    step: 0.01,
  },
  {
    key: "focus",
    label: "Focus",
    help: "Models how tightly the beam is focused by the monitor optics. Lower focus spreads energy across nearby pixels; higher focus keeps lines crisp.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "beamWidth",
    label: "Spot size",
    help: "Controls the diameter of the beam spot. It approximates tube focus, phosphor spread, and camera exposure all contributing to line thickness.",
    min: 0.7,
    max: 7,
    step: 0.01,
  },
  {
    key: "bloom",
    label: "Bloom",
    help: "Adds optical glow around intense strokes. Real CRT glass, phosphor scatter, and camera lenses all leak a little light beyond the beam path.",
    min: 0,
    max: 1.5,
    step: 0.01,
  },
  {
    key: "persistence",
    label: "Persistence",
    help: "Sets how long excited phosphor stays visible. Long persistence leaves trails and blended motion; short persistence makes the beam path fade quickly.",
    min: 0.03,
    max: 0.99,
    step: 0.01,
  },
  {
    key: "decayCurve",
    label: "Decay curve",
    help: "Shapes the phosphor fade rate. Real phosphors do not disappear linearly, so this controls whether afterglow drops fast or has a long tail.",
    min: 0.2,
    max: 2.5,
    step: 0.01,
  },
  {
    key: "afterglow",
    label: "Afterglow",
    help: "Adds residual light after the main stroke fades. It helps recreate the soft memory of bright vector paths on slow phosphor screens.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "exposure",
    label: "Exposure",
    help: "Simulates display or camera exposure after the beam is rendered. It changes perceived brightness without changing the underlying beam path.",
    min: 0.2,
    max: 8,
    step: 0.01,
  },
  {
    key: "contrast",
    label: "Contrast",
    help: "Adjusts the curve between dark phosphor and bright strokes. It helps show how tube response and display tonemapping affect line readability.",
    min: 0.4,
    max: 2.4,
    step: 0.01,
  },
  {
    key: "blankingLeakage",
    label: "Blank leak",
    help: "Represents imperfect beam blanking while moving between visible strokes. Higher values reveal faint connector lines that old hardware could leak.",
    min: 0,
    max: 0.18,
    step: 0.001,
  },
  {
    key: "retraceVisibility",
    label: "Retrace",
    help: "Shows part of the beam's return travel between vectors. It explains why fast deflection plus imperfect blanking can leave diagonal ghosts.",
    min: 0,
    max: 0.18,
    step: 0.001,
  },
  {
    key: "dwellGain",
    label: "Dwell gain",
    help: "Sets how strongly slow points, stacked strokes, and repeated beam passes accumulate light. Raise it for hotter overlaps; lower it for flatter lines.",
    min: 0,
    max: 1.4,
    step: 0.01,
  },
  {
    key: "cornerBrightening",
    label: "Overlap burn",
    help: "Boosts brightness at vector joins, crossings, and sharp turns. Lower this when overlapping strokes or letters look too hot.",
    min: 0,
    max: 1.3,
    step: 0.01,
  },
  {
    key: "spotKiller",
    label: "Spot killer",
    help: "Suppresses concentrated idle brightness. Real circuits protect the tube from stationary beam burn when deflection or blanking fails.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "xGain",
    label: "X gain",
    help: "Scales horizontal deflection amplitude. It models calibration drift in the X amplifier that makes the whole image wider or narrower.",
    min: 0.7,
    max: 1.25,
    step: 0.001,
  },
  {
    key: "yGain",
    label: "Y gain",
    help: "Scales vertical deflection amplitude. It mirrors the Y amplifier calibration that stretches or compresses the picture height.",
    min: 0.7,
    max: 1.25,
    step: 0.001,
  },
  {
    key: "xOffset",
    label: "X offset",
    help: "Moves the beam center horizontally. Real monitor centering pots bias the deflection signal so the picture lands on the tube face.",
    min: -0.18,
    max: 0.18,
    step: 0.001,
  },
  {
    key: "yOffset",
    label: "Y offset",
    help: "Moves the beam center vertically. It demonstrates how a small DC offset shifts every vector before phosphor rendering.",
    min: -0.18,
    max: 0.18,
    step: 0.001,
  },
  {
    key: "rotation",
    label: "Rotation",
    help: "Rotates the whole deflection field. This stands in for yoke alignment and analog geometry setup inside a real display.",
    min: -8,
    max: 8,
    step: 0.01,
  },
  {
    key: "distortion",
    label: "Geometry bow",
    help: "Bends the coordinate space before drawing. It models non-linear deflection where straight vectors curve near the edge of the tube.",
    min: -0.2,
    max: 0.28,
    step: 0.001,
  },
  {
    key: "slewRate",
    label: "Slew rate",
    help: "Limits how quickly the beam can move. If the requested vector jump is too fast, analog deflection lags and corners soften.",
    min: 0.1,
    max: 1.4,
    step: 0.01,
  },
  {
    key: "deflectionLag",
    label: "Deflection lag",
    help: "Adds delay between commanded and actual beam position. It shows the inertia and bandwidth limits of the deflection amplifiers.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "ringing",
    label: "Ringing",
    help: "Adds overshoot after sudden direction changes. Real analog circuits can oscillate briefly, creating bright ripples around corners.",
    min: 0,
    max: 0.45,
    step: 0.001,
  },
  {
    key: "jitter",
    label: "Jitter",
    help: "Injects small beam-position noise. It represents analog noise, DAC instability, and vibration that keep old displays from looking perfectly digital.",
    min: 0,
    max: 0.035,
    step: 0.0005,
  },
  {
    key: "convergence",
    label: "RGB converge",
    help: "Separates color channels slightly. Color vector displays must align multiple beams, and small convergence errors create colored fringes.",
    min: 0,
    max: 0.06,
    step: 0.001,
  },
  {
    key: "rgbDecaySplit",
    label: "RGB decay",
    help: "Lets color channels fade at different rates. Different phosphor compounds decay differently, which can leave subtle color trails.",
    min: 0,
    max: 0.5,
    step: 0.001,
  },
  {
    key: "blackLevel",
    label: "Black level",
    help: "Raises the dark floor of the screen. It simulates tube glass glow, camera lift, and ambient reflections that keep black from being absolute.",
    min: 0,
    max: 0.08,
    step: 0.001,
  },
  {
    key: "internalScale",
    label: "Internal res",
    help: "Changes the simulation render resolution before display scaling. Higher values preserve fine phosphor detail; lower values improve performance.",
    min: 0.35,
    max: 2,
    step: 0.01,
  },
  {
    key: "phosphorGrain",
    label: "Phosphor grain",
    help: "Adds fine screen texture. It approximates uneven phosphor coating and glass structure that break up perfectly smooth computer lines.",
    min: 0,
    max: 0.35,
    step: 0.001,
  },
  {
    key: "glassCurvature",
    label: "Glass curve",
    help: "Warps the image as if it is on curved CRT glass. It helps explain edge distortion and the physical shape of old tubes.",
    min: 0,
    max: 0.4,
    step: 0.001,
  },
  {
    key: "vignette",
    label: "Vignette",
    help: "Darkens the edges of the simulated glass. It recreates brightness falloff from viewing angle, tube geometry, and optical capture.",
    min: 0,
    max: 0.8,
    step: 0.01,
  },
  {
    key: "burnIn",
    label: "Burn-in",
    help: "Adds a faint retained imprint from repeated bright paths. It demonstrates how phosphors age when the same vectors are drawn often.",
    min: 0,
    max: 0.5,
    step: 0.001,
  },
  {
    key: "refreshHz",
    label: "VG Hz",
    help: "Controls the simulated vector generator refresh rate. Lower rates reveal redraw flicker; higher rates make motion feel more continuous.",
    min: 8,
    max: 75,
    step: 0.01,
  },
  {
    key: "vectorBudget",
    label: "Vector budget",
    help: "Caps how much vector work can be sampled per frame. It keeps the demo responsive while showing the tradeoff between fidelity and speed.",
    min: 800,
    max: 16000,
    step: 100,
  },
];

const controlGroups = [
  { title: "Beam", icon: Zap, items: controls.slice(0, 14) },
  { title: "Deflection", icon: Crosshair, items: controls.slice(14, 25) },
  { title: "Screen", icon: MonitorUp, items: controls.slice(25) },
];

const controlByKey = new Map<NumericParamKey, ControlDef>(controls.map((control) => [control.key, control]));

function controlFor(key: NumericParamKey) {
  const control = controlByKey.get(key);
  if (!control) {
    throw new Error(`Missing control definition for ${key}`);
  }
  return control;
}

function asteroidsControl(control: ControlDef): ControlDef {
  switch (control.key) {
    case "beamIntensity":
      return { ...control, min: 0, max: 0.08, step: 0.001 };
    case "blackLevel":
      return { ...control, min: 0, max: 0.03, step: 0.001 };
    case "convergence":
      return { ...control, min: 0, max: 0.0145, step: 0.0005 };
    case "phosphorGrain":
      return { ...control, min: 0, max: 0.08, step: 0.001 };
    case "refreshHz":
      return { ...control, min: 55, max: 66, step: 0.01 };
    default:
      return control;
  }
}

const asteroidsControlGroups = [
  {
    title: "Beam",
    icon: Zap,
    items: controls.slice(0, 14).map(asteroidsControl),
  },
  {
    title: "Deflection",
    icon: Crosshair,
    items: controls.slice(14, 25).map(asteroidsControl),
  },
  {
    title: "Screen",
    icon: MonitorUp,
    items: controls.slice(25).map(asteroidsControl),
  },
];

const inputKeys: Array<keyof AsteroidsGame["input"]> = ["left", "right", "thrust", "fire", "hyperspace", "start"];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const monitorRef = useRef<VectorMonitor | null>(null);
  const paramsRef = useRef<MonitorParams>(paramsForPreset("asteroids-bw"));
  const highRefreshPreferenceRef = useRef(paramsRef.current.temporalSweep);
  const sceneRef = useRef<DemoScene>("asteroids");
  const sceneStartedAtRef = useRef(performance.now() / 1000);
  const gameRef = useRef(new AsteroidsGame());
  const latestStatsRef = useRef<MonitorStats>({ vectors: 0, samples: 0, phosphorLoad: 0, simulatedRefreshHz: 0 });
  const latestSnapshotRef = useRef<AsteroidsSnapshot>(gameRef.current.snapshot());
  const latestCarrierFpsRef = useRef(0);
  const helpHideTimerRef = useRef<number | null>(null);
  const userAdjustedParamsRef = useRef(false);
  const [params, setParams] = useState<MonitorParams>(paramsRef.current);
  const [scene, setScene] = useState<DemoScene>("asteroids");
  const [stats, setStats] = useState<MonitorStats>({ vectors: 0, samples: 0, phosphorLoad: 0, simulatedRefreshHz: 0 });
  const [carrierFps, setCarrierFps] = useState(0);
  const [snapshot, setSnapshot] = useState<AsteroidsSnapshot>(latestSnapshotRef.current);
  const [activeHelp, setActiveHelp] = useState<ActiveHelp | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const presetWithUserDisplayToggles = useCallback((preset: MonitorPresetName, current?: MonitorParams) => {
    const nextParams = paramsForPreset(preset);
    return {
      ...nextParams,
      temporalSweep: highRefreshPreferenceRef.current,
      antiAlias: current?.antiAlias ?? nextParams.antiAlias,
    };
  }, []);

  useEffect(() => {
    paramsRef.current = params;
    monitorRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    sceneRef.current = scene;
    sceneStartedAtRef.current = performance.now() / 1000;
    monitorRef.current?.clear();
    if (scene === "storage") {
      setParams((current) => presetWithUserDisplayToggles("storage-green", current));
      return;
    }
    if (scene === "asteroids") {
      setParams((current) => presetWithUserDisplayToggles("asteroids-bw", current));
      return;
    }
    if (["asteroids-bw", "storage-green"].includes(paramsRef.current.preset)) {
      setParams((current) => presetWithUserDisplayToggles("arcade-rgb", current));
    }
  }, [presetWithUserDisplayToggles, scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (!canCreateWebGLContext()) {
      setWebglError("WebGL is unavailable or disabled on this device.");
      return;
    }
    let monitor: VectorMonitor;
    try {
      monitor = new VectorMonitor(canvas, paramsRef.current);
      setWebglError(null);
    } catch {
      setWebglError("WebGL failed to start on this device.");
      return;
    }
    const audio = new AsteroidsAudio();
    monitorRef.current = monitor;
    (window as typeof window & { __vectorMonitorAudit?: { clear: () => void; getParams: () => MonitorParams } }).__vectorMonitorAudit = {
      clear: () => monitor.clear(),
      getParams: () => paramsRef.current,
    };
    let raf = 0;
    let last = performance.now();
    let lastStats = 0;
    let fpsWindowStart = last;
    let fpsFrames = 0;
    let latestCarrierFps = 0;

    const setKey = (event: KeyboardEvent, down: boolean) => {
      if (sceneRef.current === "asteroids") {
        const mapped = asteroidsKeyMap[event.code];
        if (!mapped) {
          return;
        }
        event.preventDefault();
        if (down) {
          audio.unlock();
        }
        gameRef.current.input[mapped] = down;
        if (down && mapped === "start") {
          gameRef.current.requestStart();
        }
        if (down && mapped === "fire") {
          gameRef.current.requestFire();
        }
        if (down && mapped === "hyperspace") {
          gameRef.current.requestHyperspace();
        }
        return;
      }

    };
    const onKeyDown = (event: KeyboardEvent) => setKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => setKey(event, false);
    const onBlur = () => {
      for (const key of inputKeys) {
        gameRef.current.input[key] = false;
      }
    };

    const frame = (now: number) => {
      const auditFrozen = Boolean((window as typeof window & { __vectorMonitorAuditFreeze?: boolean }).__vectorMonitorAuditFreeze);
      const time = auditFrozen ? 1 : now / 1000;
      const delta = auditFrozen ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      fpsFrames += 1;
      if (now - fpsWindowStart >= 500) {
        latestCarrierFps = (fpsFrames * 1000) / (now - fpsWindowStart);
        fpsFrames = 0;
        fpsWindowStart = now;
      }
      if (sceneRef.current === "asteroids") {
        gameRef.current.update(delta);
        audio.handleEvents(gameRef.current.drainSoundEvents());
      } else {
        audio.handleEvents(gameRef.current.drainSoundEvents());
      }
      if (monitor.needsProgramRefresh(time)) {
        const commands: VectorCommand[] =
          sceneRef.current === "asteroids"
            ? gameRef.current.commands(time)
            : buildScene(sceneRef.current, Math.max(0, time - sceneStartedAtRef.current)).commands;
        monitor.setProgram(commands);
      }
      monitor.render(delta, time);
      if (now - lastStats > 250) {
        const nextStats = monitor.getStats();
        if (!sameStats(latestStatsRef.current, nextStats)) {
          latestStatsRef.current = { ...nextStats };
          setStats(latestStatsRef.current);
        }
        if (Math.abs(latestCarrierFpsRef.current - latestCarrierFps) >= 1) {
          latestCarrierFpsRef.current = latestCarrierFps;
          setCarrierFps(latestCarrierFps);
        }
        if (sceneRef.current === "asteroids") {
          const nextSnapshot = gameRef.current.snapshot();
          if (!sameSnapshot(latestSnapshotRef.current, nextSnapshot)) {
            latestSnapshotRef.current = nextSnapshot;
            setSnapshot(nextSnapshot);
          }
        }
        lastStats = now;
      }
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      audio.dispose();
      monitor.dispose();
      delete (window as typeof window & { __vectorMonitorAudit?: { clear: () => void; getParams: () => MonitorParams } }).__vectorMonitorAudit;
      monitorRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (helpHideTimerRef.current !== null) {
        window.clearTimeout(helpHideTimerRef.current);
      }
    };
  }, []);

  const setPreset = useCallback((preset: MonitorPresetName) => {
    userAdjustedParamsRef.current = true;
    setParams((current) => presetWithUserDisplayToggles(preset, current));
  }, [presetWithUserDisplayToggles]);

  const updateControl = useCallback((key: NumericParamKey, value: number) => {
    userAdjustedParamsRef.current = true;
    setParams((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);

  const resetControl = useCallback((key: NumericParamKey) => {
    userAdjustedParamsRef.current = true;
    setParams((current) => {
      const defaultValue = paramsForPreset(current.preset)[key];
      return current[key] === defaultValue ? current : { ...current, [key]: defaultValue };
    });
  }, []);

  const updateTemporalSweep = useCallback((temporalSweep: boolean) => {
    userAdjustedParamsRef.current = true;
    highRefreshPreferenceRef.current = temporalSweep;
    setParams((current) => (current.temporalSweep === temporalSweep ? current : { ...current, temporalSweep }));
  }, []);

  const updateAntiAlias = useCallback((antiAlias: boolean) => {
    userAdjustedParamsRef.current = true;
    setParams((current) => (current.antiAlias === antiAlias ? current : { ...current, antiAlias }));
  }, []);

  const selectScene = useCallback((nextScene: DemoScene) => {
    setScene((current) => (current === nextScene ? current : nextScene));
  }, []);
  const showHelp = useCallback((title: string, body: string, trigger: HTMLElement) => {
    if (helpHideTimerRef.current !== null) {
      window.clearTimeout(helpHideTimerRef.current);
      helpHideTimerRef.current = null;
    }
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(title === appTitle ? 540 : 330, viewportWidth - 32);
    const estimatedHeight = title === appTitle ? 430 : 260;
    const alignFromLeft = rect.left < viewportWidth * 0.52;
    const rawLeft = alignFromLeft ? rect.left - 8 : rect.right - width + 8;
    const rawTop = rect.bottom + 12;

    setActiveHelp({
      title,
      body,
      left: Math.max(16, Math.min(rawLeft, viewportWidth - width - 16)),
      top: rawTop + estimatedHeight > viewportHeight ? Math.max(16, rect.top - estimatedHeight - 12) : rawTop,
      width,
      visible: true,
    });
  }, []);

  const hideHelp = useCallback(() => {
    setActiveHelp((current) => (current ? { ...current, visible: false } : current));
    helpHideTimerRef.current = window.setTimeout(() => {
      setActiveHelp(null);
      helpHideTimerRef.current = null;
    }, 140);
  }, []);

  const activeControlGroups = scene === "asteroids" && params.preset === "asteroids-bw" ? asteroidsControlGroups : controlGroups;

  return (
    <main className={`app-shell ${scene === "asteroids" ? "asteroids-shell" : ""}`}>
      <section className="stage-area">
        <div className="top-bar">
          <div className="brand">
            {scene === "asteroids" ? <Gamepad2 size={20} /> : <Activity size={20} />}
            <div>
              <div className="brand-heading">
                <h1>{appTitle}</h1>
                <HelpTip title={appTitle} body={projectOverview} onShow={showHelp} onHide={hideHelp} />
              </div>
              <p>
                {scene === "asteroids" ? "Asteroids-style vector monitor recreation" : "Three.js phosphor and X-Y beam simulation"}
              </p>
            </div>
          </div>
          <div className="readouts">
            <Readout label="Vectors" value={stats.vectors.toFixed(0)} />
            <Readout label="Samples" value={stats.samples.toFixed(0)} />
            <Readout label="Load" value={stats.phosphorLoad.toFixed(2)} />
            <Readout label="VG Hz" value={stats.simulatedRefreshHz.toFixed(1)} />
            <Readout label="Carrier" value={carrierFps > 0 ? carrierFps.toFixed(0) : "--"} />
          </div>
        </div>

        <div className="monitor-frame">
          <canvas ref={canvasRef} aria-label="Vector monitor simulation" />
          {webglError && (
            <div className="webgl-fallback" role="status">
              {webglError}
            </div>
          )}
          <div className="bezel-shine" />
        </div>

        <div className="scene-tabs" aria-label="Scene presets">
          {sceneTabs.map((tab) => (
            <button key={tab.id} className={scene === tab.id ? "active" : ""} onClick={() => selectScene(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <aside className="control-panel">
        <div className="panel-header">
          <SlidersHorizontal size={19} />
          <h2>Hardware Parameters</h2>
          <button className="icon-button" title="Reset current preset" onClick={() => setPreset(params.preset)}>
            <RotateCcw size={17} />
          </button>
        </div>

        <label className="select-row">
          <span>Monitor preset</span>
          <select value={params.preset} onChange={(event) => setPreset(event.target.value as MonitorPresetName)}>
            {presetOptions.map((preset) => (
              <option value={preset} key={preset}>
                {presetLabels[preset]}
              </option>
            ))}
          </select>
        </label>

        <label className="toggle-row">
          <span>
            <strong>120 Hz+ overdrive</strong>
            <small>{params.temporalSweep ? "Display-rate beam sweep" : "Original VG frame only"}</small>
          </span>
          <input type="checkbox" checked={params.temporalSweep} onChange={(event) => updateTemporalSweep(event.target.checked)} />
        </label>

        <label className="toggle-row">
          <span>
            <strong>Vector AA</strong>
            <small>{params.antiAlias ? "Smooth beam edges" : "Raw stepped beam"}</small>
          </span>
          <input type="checkbox" checked={params.antiAlias} onChange={(event) => updateAntiAlias(event.target.checked)} />
        </label>

        {scene === "asteroids" && (
          <div className="keys-row">
            <kbd>Enter</kbd>
            <span>start</span>
            <kbd>Arrows</kbd>
            <span>move</span>
            <kbd>Space</kbd>
            <span>fire</span>
            <kbd>H</kbd>
            <span>jump</span>
          </div>
        )}

        {activeControlGroups.map((group) => (
          <section className="control-group" key={group.title}>
            <h3>
              <group.icon size={16} />
              {group.title}
            </h3>
            {group.items.map((control) => (
              <Control
                key={control.key}
                control={control}
                value={Number(params[control.key])}
                onChange={updateControl}
                onReset={resetControl}
                onHelpShow={showHelp}
                onHelpHide={hideHelp}
              />
            ))}
          </section>
        ))}
      </aside>
      {activeHelp && (
        <div
          className={`help-popover ${activeHelp.visible ? "active" : ""}`}
          role="note"
          style={{
            left: activeHelp.left,
            top: activeHelp.top,
            width: activeHelp.width,
          }}
        >
          <strong>{activeHelp.title}</strong>
          <p>{activeHelp.body}</p>
        </div>
      )}
    </main>
  );
}

function sameStats(a: MonitorStats, b: MonitorStats) {
  return a.vectors === b.vectors && a.samples === b.samples && a.phosphorLoad === b.phosphorLoad && a.simulatedRefreshHz === b.simulatedRefreshHz;
}

function sameSnapshot(a: AsteroidsSnapshot, b: AsteroidsSnapshot) {
  return a.score === b.score && a.highScore === b.highScore && a.lives === b.lives && a.wave === b.wave && a.rocks === b.rocks && a.mode === b.mode;
}

const Readout = memo(function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

const HelpTip = memo(function HelpTip({
  title,
  body,
  onShow,
  onHide,
  onClick,
  ariaLabel,
}: {
  title: string;
  body: string;
  onShow: (title: string, body: string, trigger: HTMLElement) => void;
  onHide: () => void;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <span className="help-tip">
      <button
        className="help-trigger"
        type="button"
        aria-label={ariaLabel ?? `About ${title}`}
        onMouseEnter={(event) => onShow(title, body, event.currentTarget)}
        onMouseLeave={onHide}
        onClick={onClick}
      >
        <span aria-hidden="true">?</span>
      </button>
    </span>
  );
});

const Control = memo(function Control({
  control,
  value,
  onChange,
  onReset,
  onHelpShow,
  onHelpHide,
}: {
  control: ControlDef;
  value: number;
  onChange: (key: NumericParamKey, value: number) => void;
  onReset: (key: NumericParamKey) => void;
  onHelpShow: (title: string, body: string, trigger: HTMLElement) => void;
  onHelpHide: () => void;
}) {
  const inputId = `control-${control.key}`;
  const labelId = `${inputId}-label`;

  return (
    <div className="control-row">
      <div className="control-label" id={labelId}>
        <span>{control.label}</span>
        <HelpTip
          title={control.label}
          body={control.help}
          onShow={onHelpShow}
          onHide={onHelpHide}
          onClick={() => onReset(control.key)}
          ariaLabel={`About ${control.label}; click to reset this slider`}
        />
      </div>
      <input
        id={inputId}
        aria-labelledby={labelId}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(event) => onChange(control.key, Number(event.target.value))}
      />
      <output>{formatControlValue(value, control.step)}</output>
    </div>
  );
});

function formatControlValue(value: number, step: number) {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) {
    return value.toFixed(0);
  }
  const decimals = Math.min(4, Math.max(0, decimalPlaces(step)));
  return value.toFixed(decimals);
}

function decimalPlaces(value: number) {
  if (!Number.isFinite(value)) {
    return 2;
  }
  const text = value.toString();
  if (text.includes("e-")) {
    return Number(text.split("e-")[1]);
  }
  return text.includes(".") ? text.split(".")[1].length : 0;
}

function canCreateWebGLContext() {
  try {
    const testCanvas = document.createElement("canvas");
    return Boolean(testCanvas.getContext("webgl2") ?? testCanvas.getContext("webgl"));
  } catch {
    return false;
  }
}
