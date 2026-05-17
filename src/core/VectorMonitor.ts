import * as THREE from "three";
import type { MonitorParams, MonitorStats, VectorCommand } from "./types";
import { createSampleBuffer, sampleCommandsInto, type SampleBuffer } from "./strokeSampling";
import { tintForPreset } from "./presets";
import { createVectorTransform, transformVectorPointInto, VECTOR_SCREEN_ASPECT } from "./vectorGeometry";

const MAX_SAMPLES = 16000;
const MAX_POINT_VERTICES = MAX_SAMPLES * 3;
const MAX_LINE_VERTICES = MAX_SAMPLES * 6;
const LINE_DISTANCE_LIMIT_SQ = 0.08 * 0.08;
const LINE_INTENSITY_FLOOR = 0.006;
const MAX_RENDER_TARGET_PIXELS = 3_800_000;
const MAX_RENDERER_PIXEL_RATIO = 1;

type SweepSegmentArrays = {
  x1: Float32Array;
  y1: Float32Array;
  x2: Float32Array;
  y2: Float32Array;
  width: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  length: Float32Array;
  heat: Float32Array;
  seed: Float32Array;
};

export class VectorMonitor {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private beamScene = new THREE.Scene();
  private postScene = new THREE.Scene();
  private compositeScene = new THREE.Scene();
  private decayMaterial: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;
  private beamMaterial: THREE.ShaderMaterial;
  private beamGeometry: THREE.BufferGeometry;
  private beamPositionAttribute: THREE.BufferAttribute;
  private beamColorAttribute: THREE.BufferAttribute;
  private beamInfoAttribute: THREE.BufferAttribute;
  private beamPoints: THREE.Points;
  private beamLineGeometry: THREE.BufferGeometry;
  private beamLinePositionAttribute: THREE.BufferAttribute;
  private beamLineColorAttribute: THREE.BufferAttribute;
  private beamLineSideAttribute: THREE.BufferAttribute;
  private beamLineMaterial: THREE.ShaderMaterial;
  private beamLines: THREE.Mesh;
  private targetA!: THREE.WebGLRenderTarget;
  private targetB!: THREE.WebGLRenderTarget;
  private targetType: THREE.TextureDataType;
  private sampleBuffer: SampleBuffer = createSampleBuffer(MAX_SAMPLES);
  private commands: VectorCommand[] = [];
  private params: MonitorParams;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private internalScale = 0;
  private targetWidth = 1;
  private targetHeight = 1;
  private aperturePixelWidth = 640;
  private aperturePixelHeight = 480;
  private sizeDirty = true;
  private resizeObserver?: ResizeObserver;
  private front = 0;
  private disposed = false;
  private contextLost = false;
  private nextBeamRefreshTime = 0;
  private sweepSegments: SweepSegmentArrays = createSweepSegmentArrays(MAX_SAMPLES);
  private sweepSegmentCount = 0;
  private sweepSegmentCursor = 0;
  private sweepCursorLength = 0;
  private sweepStartedAt = 0;
  private sweepPeriod = 1 / 60;
  private sweepDrawnLength = 0;
  private sweepTotalLength = 0;
  private sweepSampleCount = 0;
  private stats: MonitorStats = { vectors: 0, samples: 0, phosphorLoad: 0, simulatedRefreshHz: 0 };
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = () => {
    window.location.reload();
  };

  constructor(canvas: HTMLCanvasElement, params: MonitorParams) {
    this.params = params;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      precision: "mediump",
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.targetType = chooseRenderTargetType(this.renderer);
    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);

    this.beamGeometry = new THREE.BufferGeometry();
    this.beamPositionAttribute = new THREE.Float32BufferAttribute(new Float32Array(MAX_POINT_VERTICES * 3), 3);
    this.beamColorAttribute = new THREE.Float32BufferAttribute(new Float32Array(MAX_POINT_VERTICES * 3), 3);
    this.beamInfoAttribute = new THREE.Float32BufferAttribute(new Float32Array(MAX_POINT_VERTICES * 2), 2);
    this.beamPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.beamColorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.beamInfoAttribute.setUsage(THREE.DynamicDrawUsage);
    this.beamGeometry.setAttribute("position", this.beamPositionAttribute);
    this.beamGeometry.setAttribute("beamColor", this.beamColorAttribute);
    this.beamGeometry.setAttribute("beamInfo", this.beamInfoAttribute);
    this.beamGeometry.setDrawRange(0, 0);

    this.beamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        pointScale: { value: 1 },
        convergence: { value: params.convergence },
      },
      vertexShader: `
        attribute vec3 beamColor;
        attribute vec2 beamInfo;
        varying vec3 vColor;
        varying float vIntensity;
        void main() {
          vColor = beamColor;
          vIntensity = beamInfo.x;
          gl_Position = vec4(position.xy, 0.0, 1.0);
          gl_PointSize = max(1.0, beamInfo.y);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vIntensity;
        void main() {
          vec2 p = gl_PointCoord.xy - 0.5;
          float d = dot(p, p);
          float core = exp(-d * 18.0);
          float halo = exp(-d * 4.6) * 0.24;
          float energy = (core * 0.42 + halo) * vIntensity;
          gl_FragColor = vec4(vColor * energy, energy);
        }
      `,
    });
    this.beamPoints = new THREE.Points(this.beamGeometry, this.beamMaterial);
    this.beamScene.add(this.beamPoints);

    this.beamLineGeometry = new THREE.BufferGeometry();
    this.beamLinePositionAttribute = new THREE.Float32BufferAttribute(new Float32Array(MAX_LINE_VERTICES * 3), 3);
    this.beamLineColorAttribute = new THREE.Float32BufferAttribute(new Float32Array(MAX_LINE_VERTICES * 3), 3);
    this.beamLineSideAttribute = new THREE.Float32BufferAttribute(new Float32Array(MAX_LINE_VERTICES), 1);
    this.beamLinePositionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.beamLineColorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.beamLineSideAttribute.setUsage(THREE.DynamicDrawUsage);
    this.beamLineGeometry.setAttribute("position", this.beamLinePositionAttribute);
    this.beamLineGeometry.setAttribute("color", this.beamLineColorAttribute);
    this.beamLineGeometry.setAttribute("lineSide", this.beamLineSideAttribute);
    this.beamLineGeometry.setDrawRange(0, 0);
    this.beamLineMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: `
        attribute float lineSide;
        varying vec3 vColor;
        varying float vLineSide;
        void main() {
          vColor = color;
          vLineSide = lineSide;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform float antiAlias;
        varying vec3 vColor;
        varying float vLineSide;
        void main() {
          float side = abs(vLineSide);
          float analogTrace = exp(-side * side * 3.25) * 0.82 + exp(-side * side * 0.9) * 0.16;
          float edgeWidth = mix(0.001, 0.18, antiAlias);
          float cleanEdge = 1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, side);
          float solidCore = mix(0.98, cleanEdge, antiAlias);
          float feather = analogTrace * solidCore;
          vec3 col = vColor * feather;
          gl_FragColor = vec4(col, max(max(col.r, col.g), col.b));
        }
      `,
      uniforms: {
        antiAlias: { value: params.antiAlias ? 1 : 0 },
      },
    });
    this.beamLines = new THREE.Mesh(this.beamLineGeometry, this.beamLineMaterial);
    this.beamScene.add(this.beamLines);

    this.decayMaterial = new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: {
        previousFrame: { value: null },
        channelDecay: { value: new THREE.Vector3(0.94, 0.94, 0.94) },
        afterglow: { value: params.afterglow },
        burnIn: { value: params.burnIn },
      },
      vertexShader: fullScreenVert,
      fragmentShader: `
        uniform sampler2D previousFrame;
        uniform vec3 channelDecay;
        uniform float afterglow;
        uniform float burnIn;
        varying vec2 vUv;
        void main() {
          vec4 last = texture2D(previousFrame, vUv);
          vec3 after = last.rgb * channelDecay;
          float luma = max(max(last.r, last.g), last.b);
          vec3 phosphorTail = last.rgb * afterglow * smoothstep(0.02, 0.85, luma) * 0.035;
          vec3 ghost = last.rgb * burnIn * 0.0025;
          gl_FragColor = vec4(max(after + phosphorTail + ghost, 0.0), 1.0);
        }
      `,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.decayMaterial));

    this.compositeMaterial = new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: {
        phosphor: { value: null },
        texel: { value: new THREE.Vector2(1 / 900, 1 / 700) },
        exposure: { value: params.exposure },
        contrast: { value: params.contrast },
        bloom: { value: params.bloom },
        grain: { value: params.phosphorGrain },
        blackLevel: { value: params.blackLevel },
        convergence: { value: params.convergence },
        antiAlias: { value: params.antiAlias ? 1 : 0 },
        vignette: { value: params.vignette },
        curvature: { value: params.glassCurvature },
        time: { value: 0 },
      },
      vertexShader: fullScreenVert,
      fragmentShader: `
        uniform sampler2D phosphor;
        uniform vec2 texel;
        uniform float exposure;
        uniform float contrast;
        uniform float bloom;
        uniform float grain;
        uniform float blackLevel;
        uniform float convergence;
        uniform float antiAlias;
        uniform float vignette;
        uniform float curvature;
        uniform float time;
        varying vec2 vUv;

        float random(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7)) + time * 0.37) * 43758.5453123);
        }

        void main() {
          vec2 uv = vUv;
          vec2 c = uv * 2.0 - 1.0;
          float r2 = dot(c, c);
          uv -= c * r2 * curvature * 0.055;
          vec3 base = texture2D(phosphor, uv).rgb;
          vec3 nearGlow =
            texture2D(phosphor, uv + texel * vec2(1.35, 0.0)).rgb +
            texture2D(phosphor, uv - texel * vec2(1.35, 0.0)).rgb +
            texture2D(phosphor, uv + texel * vec2(0.0, 1.35)).rgb +
            texture2D(phosphor, uv - texel * vec2(0.0, 1.35)).rgb;
          if (antiAlias > 0.5) {
            base = base * 0.56 + nearGlow * 0.11;
          }
          vec3 col = base;
          if (convergence > 0.0001) {
            vec2 fringe = c * convergence * 1.35 + texel * vec2(1.8, -0.55) * convergence * 260.0;
            col = vec3(
              texture2D(phosphor, uv + fringe).r,
              base.g,
              texture2D(phosphor, uv - fringe * 0.92).b
            );
          }
          vec3 hot = max(col - vec3(0.08), 0.0);
          vec3 hdrHot = max(col - vec3(0.025), 0.0);
          col += nearGlow * bloom * 0.22;
          col += nearGlow * nearGlow * bloom * 0.14;
          col += hdrHot * bloom * 0.34;
          col += hot * hot * bloom * 1.16;
          col += hdrHot * hdrHot * bloom * 1.15;
          col = (col * exposure * 1.92) / (vec3(1.0) + col * exposure * 1.92);
          col = pow(max(col, 0.0), vec3(1.0 / max(contrast, 0.01)));
          col = max(col, vec3(blackLevel));
          float mask = smoothstep(1.22, 0.1, r2);
          col *= mix(1.0, mask, vignette);
          col += (random(uv * 1200.0) - 0.5) * grain * 0.08;
          vec3 glass = vec3(0.016, 0.022, 0.018) * (1.0 - mask) * clamp(blackLevel * 48.0, 0.0, 1.0);
          gl_FragColor = vec4(max(col + glass, 0.0), 1.0);
        }
      `,
    });
    this.compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial));
    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => {
        this.sizeDirty = true;
      });
      this.resizeObserver.observe(canvas);
    }
    this.resize();
  }

  setParams(params: MonitorParams) {
    const resetSweep = params.temporalSweep !== this.params.temporalSweep || params.refreshHz !== this.params.refreshHz;
    const resizeNeeded = params.internalScale !== this.params.internalScale;
    this.params = params;
    this.sizeDirty = this.sizeDirty || resizeNeeded;
    if (resetSweep) {
      this.nextBeamRefreshTime = 0;
      this.sweepSegmentCount = 0;
      this.sweepSegmentCursor = 0;
      this.sweepCursorLength = 0;
      this.sweepDrawnLength = 0;
      this.sweepTotalLength = 0;
      this.sweepSampleCount = 0;
    }
  }

  setProgram(commands: VectorCommand[]) {
    this.commands = commands;
    let vectors = 0;
    for (let i = 0; i < commands.length; i += 1) {
      if (commands[i].type === "line") {
        vectors += 1;
      }
    }
    this.stats.vectors = vectors;
  }

  needsProgramRefresh(time: number) {
    return this.nextBeamRefreshTime <= 0 || time >= this.nextBeamRefreshTime;
  }

  resize() {
    if (!this.sizeDirty && this.targetA) {
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nextWidth = Math.max(320, Math.floor(rect.width || window.innerWidth));
    const nextHeight = Math.max(240, Math.floor(rect.height || window.innerHeight));
    const nextPixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_RENDERER_PIXEL_RATIO));
    const nextInternalScale = this.params.internalScale;
    if (
      nextWidth === this.width &&
      nextHeight === this.height &&
      nextPixelRatio === this.pixelRatio &&
      nextInternalScale === this.internalScale &&
      this.targetA
    ) {
      this.sizeDirty = false;
      return;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = nextPixelRatio;
    this.internalScale = nextInternalScale;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    const rawRtWidth = Math.max(640, Math.floor(this.width * this.pixelRatio * this.internalScale));
    const rawRtHeight = Math.max(480, Math.floor(this.height * this.pixelRatio * this.internalScale));
    const targetPixels = rawRtWidth * rawRtHeight;
    const targetScale = targetPixels > MAX_RENDER_TARGET_PIXELS ? Math.sqrt(MAX_RENDER_TARGET_PIXELS / targetPixels) : 1;
    const rtWidth = Math.max(640, Math.floor(rawRtWidth * targetScale));
    const rtHeight = Math.max(480, Math.floor(rawRtHeight * targetScale));
    this.targetWidth = rtWidth;
    this.targetHeight = rtHeight;
    const targetAspect = rtWidth / rtHeight;
    if (targetAspect > VECTOR_SCREEN_ASPECT) {
      this.aperturePixelHeight = rtHeight;
      this.aperturePixelWidth = rtHeight * VECTOR_SCREEN_ASPECT;
    } else {
      this.aperturePixelWidth = rtWidth;
      this.aperturePixelHeight = rtWidth / VECTOR_SCREEN_ASPECT;
    }
    this.targetA?.dispose();
    this.targetB?.dispose();
    this.targetA = makeTarget(rtWidth, rtHeight, this.targetType);
    this.targetB = makeTarget(rtWidth, rtHeight, this.targetType);
    this.renderer.setRenderTarget(this.targetA);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.targetB);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
    this.sizeDirty = false;
  }

  render(deltaTime: number, time: number) {
    if (this.disposed) {
      return;
    }
    if (this.contextLost) {
      return;
    }
    this.resize();
    const previous = this.front === 0 ? this.targetA : this.targetB;
    const next = this.front === 0 ? this.targetB : this.targetA;
    const decayBase = 1 - Math.pow(1 - this.params.persistence, this.params.decayCurve);
    const decay =
      this.params.preset === "storage-green"
        ? Math.pow(0.9975, deltaTime * 60)
        : Math.pow(0.18 + decayBase * 0.8, deltaTime * 60);
    const splitR = 1 + this.params.rgbDecaySplit * 0.24;
    const splitB = 1 - this.params.rgbDecaySplit * 0.18;
    this.decayMaterial.uniforms.previousFrame.value = previous.texture;
    this.decayMaterial.uniforms.channelDecay.value.set(Math.pow(decay, splitR), decay, Math.pow(decay, splitB));
    this.decayMaterial.uniforms.afterglow.value = this.params.afterglow;
    this.decayMaterial.uniforms.burnIn.value = this.params.burnIn;

    this.renderer.setRenderTarget(next);
    this.renderer.render(this.postScene, this.camera);

    const beamFramePeriod = 1 / Math.max(1, this.params.refreshHz);
    const highRefreshCarrier = deltaTime > 0 && deltaTime < beamFramePeriod * 0.55;
    const temporalSweep = this.params.temporalSweep && highRefreshCarrier;
    const carrierOverdrive = temporalSweep ? highRefreshOverdrive(deltaTime, beamFramePeriod) : 0;
    const shouldRefresh = time >= this.nextBeamRefreshTime;
    if (shouldRefresh) {
      if (temporalSweep) {
        this.renderSweepIncrement(this.sweepTotalLength, time, carrierOverdrive);
      }
      if (this.nextBeamRefreshTime <= 0) {
        this.nextBeamRefreshTime = time;
      }
      const sweepStartTime = this.nextBeamRefreshTime;
      while (this.nextBeamRefreshTime <= time) {
        this.nextBeamRefreshTime += beamFramePeriod;
      }
      const samples = sampleCommandsInto(this.commands, this.params, time, this.sampleBuffer);
      this.prepareSweep(samples, sweepStartTime, beamFramePeriod);
      this.stats.samples = samples.count;
      this.stats.phosphorLoad = samples.count > 0 ? samples.intensitySum / samples.count : 0;
      this.stats.simulatedRefreshHz = this.params.refreshHz;
      if (!temporalSweep) {
        this.renderSweepIncrement(this.sweepTotalLength, time, 0);
      }
    }
    if (temporalSweep) {
      this.renderSweepProgress(time, carrierOverdrive);
    }

    this.front = this.front === 0 ? 1 : 0;
    this.compositeMaterial.uniforms.phosphor.value = next.texture;
    this.compositeMaterial.uniforms.texel.value.set(1 / this.targetWidth, 1 / this.targetHeight);
    this.compositeMaterial.uniforms.exposure.value = this.params.exposure;
    this.compositeMaterial.uniforms.contrast.value = this.params.contrast;
    this.compositeMaterial.uniforms.bloom.value = this.params.bloom;
    this.compositeMaterial.uniforms.grain.value = this.params.phosphorGrain;
    this.compositeMaterial.uniforms.blackLevel.value = this.params.blackLevel;
    this.compositeMaterial.uniforms.convergence.value = this.params.convergence;
    this.compositeMaterial.uniforms.antiAlias.value = this.params.antiAlias ? 1 : 0;
    this.compositeMaterial.uniforms.vignette.value = this.params.vignette;
    this.compositeMaterial.uniforms.curvature.value = this.params.glassCurvature;
    this.compositeMaterial.uniforms.time.value = time;
    this.beamLineMaterial.uniforms.antiAlias.value = this.params.antiAlias ? 1 : 0;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.compositeScene, this.camera);
  }

  getStats() {
    return this.stats;
  }

  clear() {
    this.nextBeamRefreshTime = 0;
    this.sweepSegmentCount = 0;
    this.sweepSegmentCursor = 0;
    this.sweepCursorLength = 0;
    this.sweepDrawnLength = 0;
    this.sweepTotalLength = 0;
    this.sweepSampleCount = 0;
    if (this.contextLost) {
      return;
    }
    this.renderer.setRenderTarget(this.targetA);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.targetB);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this.disposed = true;
    this.targetA.dispose();
    this.targetB.dispose();
    this.beamGeometry.dispose();
    this.beamLineGeometry.dispose();
    this.beamMaterial.dispose();
    this.beamLineMaterial.dispose();
    this.decayMaterial.dispose();
    this.compositeMaterial.dispose();
    this.resizeObserver?.disconnect();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost, false);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored, false);
    this.renderer.dispose();
  }

  private prepareSweep(samples: SampleBuffer, startTime: number, period: number) {
    const pointScale = this.beamPixelScale();
    const focusScale = 1 + (1 - this.params.focus) * 1.8;
    this.buildStraightVectorSegments(pointScale, focusScale, startTime);
    this.sweepStartedAt = startTime;
    this.sweepPeriod = period;
    this.sweepDrawnLength = 0;
    this.sweepSegmentCursor = 0;
    this.sweepCursorLength = 0;
    this.sweepSampleCount = samples.count;
    this.sweepTotalLength = 0;
    for (let i = 0; i < this.sweepSegmentCount; i += 1) {
      this.sweepTotalLength += this.sweepSegments.length[i];
    }
    if (this.sweepTotalLength <= 0 && samples.count > 0) {
      this.sweepTotalLength = samples.count;
    }
  }

  private renderSweepProgress(time: number, carrierOverdrive: number) {
    if (this.sweepTotalLength <= 0 && this.sweepSampleCount <= 0) {
      return;
    }
    const progress = Math.min(1, Math.max(0, (time - this.sweepStartedAt) / this.sweepPeriod));
    this.renderSweepIncrement(this.sweepTotalLength * progress, time, carrierOverdrive);
  }

  private renderSweepIncrement(targetLength: number, time: number, carrierOverdrive: number) {
    const nextLength = Math.min(this.sweepTotalLength, Math.max(this.sweepDrawnLength, targetLength));
    if (nextLength <= this.sweepDrawnLength && this.sweepSampleCount <= 0) {
      return;
    }

    const pointScale = this.beamPixelScale();
    const focusScale = 1 + (1 - this.params.focus) * 1.8;
    const pointStart = this.sweepTotalLength > 0 ? Math.floor((this.sweepDrawnLength / this.sweepTotalLength) * this.sweepSampleCount) : 0;
    const pointEnd = this.sweepTotalLength > 0 ? Math.floor((nextLength / this.sweepTotalLength) * this.sweepSampleCount) : this.sweepSampleCount;
    const pointCount = this.uploadPointSamples(this.sampleBuffer, pointStart, pointEnd, pointScale, focusScale);
    const lineVertexCount = this.uploadLineSweepSlice(this.sweepDrawnLength, nextLength, time, carrierOverdrive);

    if (pointCount === 0 && lineVertexCount === 0) {
      this.sweepDrawnLength = nextLength;
      return;
    }

    this.renderer.render(this.beamScene, this.camera);
    this.sweepDrawnLength = nextLength;
  }

  private uploadPointSamples(samples: SampleBuffer, start: number, end: number, pointScale: number, focusScale: number) {
    const positions = this.beamPositionAttribute.array as Float32Array;
    const colors = this.beamColorAttribute.array as Float32Array;
    const infos = this.beamInfoAttribute.array as Float32Array;
    const convergence = this.params.preset === "arcade-rgb" ? this.params.convergence : 0;
    const linePointEnergyScale = 0.05 + clamp01(this.params.dwellGain) * 0.95;
    const rangeStart = Math.max(0, Math.min(start, samples.count));
    const rangeEnd = Math.max(rangeStart, Math.min(end, samples.count));
    const sourceCount = rangeEnd - rangeStart;
    let pointCount = 0;

    if (convergence === 0) {
      for (let i = 0; i < sourceCount; i += 1) {
        const sampleIndex = rangeStart + i;
        const pointEnergy = samples.pointEnergy[sampleIndex] * linePointEnergyScale;
        if (pointEnergy <= 0.0001) {
          continue;
        }
        const positionIndex = pointCount * 3;
        const infoIndex = pointCount * 2;
        positions[positionIndex] = samples.x[sampleIndex];
        positions[positionIndex + 1] = samples.y[sampleIndex];
        positions[positionIndex + 2] = 0;
        colors[positionIndex] = samples.r[sampleIndex];
        colors[positionIndex + 1] = samples.g[sampleIndex];
        colors[positionIndex + 2] = samples.b[sampleIndex];
        infos[infoIndex] = samples.intensity[sampleIndex] * pointEnergy;
        infos[infoIndex + 1] = samples.size[sampleIndex] * pointScale * focusScale * (0.52 + pointEnergy * 0.3);
        pointCount += 1;
      }
    } else {
      const splitCount = Math.min(sourceCount, Math.floor(MAX_POINT_VERTICES / 3));
      for (let i = 0; i < splitCount; i += 1) {
        const sampleIndex = rangeStart + i;
        const pointEnergy = samples.pointEnergy[sampleIndex] * linePointEnergyScale;
        if (pointEnergy <= 0.0001) {
          continue;
        }
        const x = samples.x[sampleIndex];
        const y = samples.y[sampleIndex];
        const intensity = samples.intensity[sampleIndex] * pointEnergy;
        const size = samples.size[sampleIndex] * pointScale * focusScale * (0.52 + pointEnergy * 0.3);
        const split = convergence * (0.65 + Math.min(1, Math.abs(x) + Math.abs(y)) * 0.35);
        const pointIndex = pointCount;
        writeBeamPoint(positions, colors, infos, pointIndex, x + split, y - split * 0.22, 1, 0, 0, intensity * samples.r[sampleIndex], size);
        writeBeamPoint(positions, colors, infos, pointIndex + 1, x, y + split * 0.32, 0, 1, 0, intensity * samples.g[sampleIndex], size);
        writeBeamPoint(positions, colors, infos, pointIndex + 2, x - split, y - split * 0.12, 0.16, 0.38, 1, intensity * samples.b[sampleIndex], size);
        pointCount += 3;
      }
    }
    markAttributeRange(this.beamPositionAttribute, 3, pointCount);
    markAttributeRange(this.beamColorAttribute, 3, pointCount);
    markAttributeRange(this.beamInfoAttribute, 2, pointCount);
    this.beamGeometry.setDrawRange(0, pointCount);
    return pointCount;
  }

  private uploadLineSweepSlice(fromLength: number, toLength: number, time: number, carrierOverdrive: number) {
    const linePositions = this.beamLinePositionAttribute.array as Float32Array;
    const lineColors = this.beamLineColorAttribute.array as Float32Array;
    const lineSides = this.beamLineSideAttribute.array as Float32Array;
    let vertex = 0;
    let cursorLength = this.sweepCursorLength;
    let segmentIndex = this.sweepSegmentCursor;

    while (segmentIndex < this.sweepSegmentCount && cursorLength + this.sweepSegments.length[segmentIndex] <= fromLength) {
      cursorLength += this.sweepSegments.length[segmentIndex];
      segmentIndex += 1;
    }
    this.sweepSegmentCursor = segmentIndex;
    this.sweepCursorLength = cursorLength;

    for (let i = segmentIndex; i < this.sweepSegmentCount && vertex <= MAX_LINE_VERTICES - 6; i += 1) {
      const segmentLength = this.sweepSegments.length[i];
      const segmentStart = cursorLength;
      const segmentEnd = cursorLength + segmentLength;
      cursorLength = segmentEnd;

      const sliceStart = Math.max(fromLength, segmentStart);
      const sliceEnd = Math.min(toLength, segmentEnd);
      if (sliceEnd <= sliceStart || segmentLength <= 0) {
        continue;
      }

      const startT = (sliceStart - segmentStart) / segmentLength;
      const endT = (sliceEnd - segmentStart) / segmentLength;
      const heat = this.sweepSegments.heat[i] * carrierOverdrive;
      let r = this.sweepSegments.r[i];
      let g = this.sweepSegments.g[i];
      let b = this.sweepSegments.b[i];
      let width = this.sweepSegments.width[i];
      if (heat > 0.001) {
        const seed = this.sweepSegments.seed[i];
        const pulse = Math.sin(time * 391 + seed * 37.1) * 0.5 + Math.sin(time * 157 + seed * 13.7) * 0.5;
        const sparkle = 0.9 + hashNoise(seed * 97.3 + Math.floor(time * 180)) * 0.28;
        const gain = 1 + heat * pulse * sparkle * 0.18;
        r *= gain;
        g *= gain;
        b *= gain;
        width *= 1 + heat * Math.max(0, pulse) * 0.08;
      }
      vertex = writeBeamRibbon(
        linePositions,
        lineColors,
        lineSides,
        vertex,
        lerp(this.sweepSegments.x1[i], this.sweepSegments.x2[i], startT),
        lerp(this.sweepSegments.y1[i], this.sweepSegments.y2[i], startT),
        lerp(this.sweepSegments.x1[i], this.sweepSegments.x2[i], endT),
        lerp(this.sweepSegments.y1[i], this.sweepSegments.y2[i], endT),
        width,
        width,
        r,
        g,
        b,
        r,
        g,
        b,
        this.targetWidth,
        this.targetHeight,
      );
    }

    markAttributeRange(this.beamLinePositionAttribute, 3, vertex);
    markAttributeRange(this.beamLineColorAttribute, 3, vertex);
    markAttributeRange(this.beamLineSideAttribute, 1, vertex);
    this.beamLineGeometry.setDrawRange(0, vertex);
    return vertex;
  }

  private buildStraightVectorSegments(pointScale: number, focusScale: number, beamTime: number) {
    const tint = tintForPreset(this.params.preset);
    const transform = createVectorTransform(this.params);
    const cursor = { x: 0, y: 0, r: tint[0], g: tint[1], b: tint[2], intensity: 1, previousAngle: 0, continuousLine: false };
    const from = { x: 0, y: 0 };
    const to = { x: 0, y: 0 };
    const overlapPoint = { x: 0, y: 0 };
    let segmentCount = 0;

    for (let i = 0; i < this.commands.length; i += 1) {
      const command = this.commands[i];
      if (command.type === "color") {
        [cursor.r, cursor.g, cursor.b] = command.color;
        continue;
      }

      if (command.type === "intensity") {
        cursor.intensity = command.intensity;
        continue;
      }

      if (command.type === "dwell") {
        continue;
      }

      const dx = command.x - cursor.x;
      const dy = command.y - cursor.y;
      projectAnalogPoint(cursor.x, cursor.y, dx, dy, 0, this.params.deflectionLag, this.params.ringing, transform, from);
      projectAnalogPoint(cursor.x, cursor.y, dx, dy, 1, this.params.deflectionLag, this.params.ringing, transform, to);
      const dxPixels = (to.x - from.x) * this.targetWidth * 0.5;
      const dyPixels = (to.y - from.y) * this.targetHeight * 0.5;
      const length = Math.hypot(dxPixels, dyPixels);
      const angle = Math.atan2(dy, dx);

      const isBlankedMove = command.type === "move";
      const commandColor = command.type === "line" ? command.color : undefined;
      const sourceR = commandColor?.[0] ?? cursor.r;
      const sourceG = commandColor?.[1] ?? cursor.g;
      const sourceB = commandColor?.[2] ?? cursor.b;
      const color = phosphorColor(this.params.preset, sourceR, sourceG, sourceB);
      const intensity = isBlankedMove
        ? Math.min(0.12, this.params.blankingLeakage * 0.4 + this.params.retraceVisibility * 0.58)
        : (command.intensity ?? cursor.intensity) * this.params.beamIntensity;
      const dwellAmount = clamp01(this.params.dwellGain);
      const dwellResponse = isBlankedMove ? 1 : 0.22 + Math.pow(dwellAmount, 1.18) * 0.9;
      const slowStrokeHeat = isBlankedMove ? 1 : 0.55 + Math.min(0.7, 28 / Math.max(48, length)) * dwellAmount;
      const lineWidthScale = this.params.preset === "asteroids-bw" ? 0.24 : 0.2;
      const baseWidth = Math.max(0.72, this.params.beamWidth * pointScale * focusScale * (isBlankedMove ? 0.09 : lineWidthScale));

      if (intensity >= LINE_INTENSITY_FLOOR) {
        const glow =
          this.params.preset === "asteroids-bw"
            ? Math.min(1.35, (0.38 + intensity * 3.8) * slowStrokeHeat)
            : Math.min(1.18, intensity * 1.04 * slowStrokeHeat);

        const pieceCount = Math.min(10, Math.max(1, Math.ceil(length / 140)));
        let previousX = from.x;
        let previousY = from.y;
        for (let piece = 1; piece <= pieceCount; piece += 1) {
          projectAnalogPoint(cursor.x, cursor.y, dx, dy, piece / pieceCount, this.params.deflectionLag, this.params.ringing, transform, to);
          const pieceDx = (to.x - previousX) * this.targetWidth * 0.5;
          const pieceDy = (to.y - previousY) * this.targetHeight * 0.5;
          const pieceLength = Math.hypot(pieceDx, pieceDy);
          segmentCount = this.appendSweepSegment(
            segmentCount,
            previousX,
            previousY,
            to.x,
            to.y,
            baseWidth,
            color.r * glow,
            color.g * glow,
            color.b * glow,
            pieceLength,
            0,
            vertexSeedFromPoints(previousX, previousY, to.x, to.y, piece),
          );
          previousX = to.x;
          previousY = to.y;
        }

        if (!isBlankedMove && cursor.continuousLine && this.params.cornerBrightening > 0 && dwellResponse > 0.012 && length > 1.5) {
          const turn = Math.abs(Math.atan2(Math.sin(angle - cursor.previousAngle), Math.cos(angle - cursor.previousAngle)));
          if (turn > 0.08) {
            const vertexSeed = hashNoise(cursor.x * 17.31 + cursor.y * 29.17 + command.x * 43.11 + command.y * 71.37 + i * 0.619);
            const flickerStep = Math.floor(beamTime * Math.max(1, this.params.refreshHz) + i * 2.7);
            const vertexFlicker = 0.78 + hashNoise(vertexSeed * 193.7 + flickerStep * 11.13) * 0.38;
            const analogFlutter = 1 + Math.sin(beamTime * 82.0 + vertexSeed * 6.28318) * 0.07;
            const overlapJitter = 0.78 + vertexSeed * 0.58;
            const overlapT = Math.min(0.2, Math.max(0.018, (14 / length) * overlapJitter));
            const turnHeat = 0.5 + Math.min(1, turn / Math.PI) * 1.05;
            const overlapSparkle = 0.88 + hashNoise(vertexSeed * 257.1 + flickerStep * 17.9) * 0.34;
            const hotSpotFlicker = vertexFlicker * analogFlutter * overlapSparkle;
            const overlapGlow =
              glow * dwellResponse * this.params.cornerBrightening * turnHeat * hotSpotFlicker * (this.params.preset === "asteroids-bw" ? 1.58 : 0.82);
            const overlapWidth = baseWidth * (1.06 + turnHeat * (0.24 + vertexSeed * 0.24));
            projectAnalogPoint(cursor.x, cursor.y, dx, dy, overlapT, this.params.deflectionLag, this.params.ringing, transform, overlapPoint);
            segmentCount = this.appendSweepSegment(
              segmentCount,
              from.x,
              from.y,
              overlapPoint.x,
              overlapPoint.y,
              overlapWidth,
              color.r * overlapGlow,
              color.g * overlapGlow,
              color.b * overlapGlow,
              length * overlapT,
              1,
              vertexSeed,
            );
            if (this.params.preset === "asteroids-bw" && vertexSeed > 0.58 && turn > 0.35) {
              const secondaryT = Math.min(0.13, overlapT * (0.42 + hashNoise(vertexSeed * 31.7 + flickerStep) * 0.34));
              const secondaryGlow = overlapGlow * (0.34 + hashNoise(vertexSeed * 83.3 + flickerStep * 2.1) * 0.26);
              projectAnalogPoint(cursor.x, cursor.y, dx, dy, secondaryT, this.params.deflectionLag, this.params.ringing, transform, overlapPoint);
              segmentCount = this.appendSweepSegment(
                segmentCount,
                from.x,
                from.y,
                overlapPoint.x,
                overlapPoint.y,
                overlapWidth * 1.18,
                color.r * secondaryGlow,
                color.g * secondaryGlow,
                color.b * secondaryGlow,
                length * secondaryT,
                0.82,
                vertexSeed * 1.37,
              );
            }
          }
        }
      }

      if (command.type === "line") {
        cursor.previousAngle = angle;
        cursor.continuousLine = true;
      } else {
        cursor.continuousLine = false;
      }
      cursor.x = command.x;
      cursor.y = command.y;
    }

    this.sweepSegmentCount = segmentCount;
  }

  private appendSweepSegment(
    segmentCount: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    r: number,
    g: number,
    b: number,
    length: number,
    heat = 0,
    seed = 0,
  ) {
    if (segmentCount >= MAX_SAMPLES) {
      return segmentCount;
    }
    this.sweepSegments.x1[segmentCount] = x1;
    this.sweepSegments.y1[segmentCount] = y1;
    this.sweepSegments.x2[segmentCount] = x2;
    this.sweepSegments.y2[segmentCount] = y2;
    this.sweepSegments.width[segmentCount] = width;
    this.sweepSegments.r[segmentCount] = r;
    this.sweepSegments.g[segmentCount] = g;
    this.sweepSegments.b[segmentCount] = b;
    this.sweepSegments.length[segmentCount] = length;
    this.sweepSegments.heat[segmentCount] = heat;
    this.sweepSegments.seed[segmentCount] = seed;
    return segmentCount + 1;
  }

  private beamPixelScale() {
    return Math.max(this.aperturePixelWidth, this.aperturePixelHeight) / 760;
  }
}

function markAttributeRange(attribute: THREE.BufferAttribute, itemSize: number, count: number) {
  attribute.clearUpdateRanges();
  if (count > 0) {
    const rangedAttribute = attribute as THREE.BufferAttribute & { vectorMonitorUpdateRange?: { start: number; count: number } };
    const range = rangedAttribute.vectorMonitorUpdateRange ?? { start: 0, count: 0 };
    range.start = 0;
    range.count = count * itemSize;
    rangedAttribute.vectorMonitorUpdateRange = range;
    attribute.updateRanges.push(range);
    attribute.needsUpdate = true;
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function hashNoise(value: number) {
  return fract(Math.sin(value * 12.9898) * 43758.5453);
}

function vertexSeedFromPoints(x1: number, y1: number, x2: number, y2: number, index: number) {
  return hashNoise(x1 * 37.7 + y1 * 61.3 + x2 * 89.9 + y2 * 113.1 + index * 0.173);
}

function fract(value: number) {
  return value - Math.floor(value);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function highRefreshOverdrive(deltaTime: number, beamFramePeriod: number) {
  if (deltaTime <= 0 || beamFramePeriod <= 0) {
    return 0;
  }
  const carrierFramesPerVg = beamFramePeriod / deltaTime;
  return clamp01((carrierFramesPerVg - 1.1) / 1.7);
}

function projectAnalogPoint(
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
  t: number,
  deflectionLag: number,
  ringing: number,
  transform: ReturnType<typeof createVectorTransform>,
  out: { x: number; y: number },
) {
  const lag = deflectionLag * Math.sin(t * Math.PI) * 0.018;
  const ring = Math.sin(t * Math.PI * 6) * ringing * 0.012 * (1 - t);
  const x = fromX + dx * t - dx * lag + dy * ring;
  const y = fromY + dy * t - dy * lag - dx * ring;
  transformVectorPointInto(x, y, transform, out);
  return out;
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

function createSweepSegmentArrays(count: number): SweepSegmentArrays {
  return {
    x1: new Float32Array(count),
    y1: new Float32Array(count),
    x2: new Float32Array(count),
    y2: new Float32Array(count),
    width: new Float32Array(count),
    r: new Float32Array(count),
    g: new Float32Array(count),
    b: new Float32Array(count),
    length: new Float32Array(count),
    heat: new Float32Array(count),
    seed: new Float32Array(count),
  };
}

function writeBeamPoint(
  positions: Float32Array,
  colors: Float32Array,
  infos: Float32Array,
  pointIndex: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  intensity: number,
  size: number,
) {
  const positionIndex = pointIndex * 3;
  const infoIndex = pointIndex * 2;
  positions[positionIndex] = x;
  positions[positionIndex + 1] = y;
  positions[positionIndex + 2] = 0;
  colors[positionIndex] = r;
  colors[positionIndex + 1] = g;
  colors[positionIndex + 2] = b;
  infos[infoIndex] = intensity;
  infos[infoIndex + 1] = size;
}

function writeBeamRibbon(
  positions: Float32Array,
  colors: Float32Array,
  sides: Float32Array,
  vertex: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width1: number,
  width2: number,
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  targetWidth: number,
  targetHeight: number,
) {
  const dxPixels = (x2 - x1) * targetWidth * 0.5;
  const dyPixels = (y2 - y1) * targetHeight * 0.5;
  const length = Math.hypot(dxPixels, dyPixels);
  if (length < 0.001) {
    return vertex;
  }

  const nx = -dyPixels / length;
  const ny = dxPixels / length;
  const xOffset1 = nx * width1 / targetWidth;
  const yOffset1 = ny * width1 / targetHeight;
  const xOffset2 = nx * width2 / targetWidth;
  const yOffset2 = ny * width2 / targetHeight;

  vertex = writeColoredVertex(positions, colors, sides, vertex, x1 - xOffset1, y1 - yOffset1, r1, g1, b1, -1);
  vertex = writeColoredVertex(positions, colors, sides, vertex, x2 - xOffset2, y2 - yOffset2, r2, g2, b2, -1);
  vertex = writeColoredVertex(positions, colors, sides, vertex, x2 + xOffset2, y2 + yOffset2, r2, g2, b2, 1);
  vertex = writeColoredVertex(positions, colors, sides, vertex, x1 - xOffset1, y1 - yOffset1, r1, g1, b1, -1);
  vertex = writeColoredVertex(positions, colors, sides, vertex, x2 + xOffset2, y2 + yOffset2, r2, g2, b2, 1);
  vertex = writeColoredVertex(positions, colors, sides, vertex, x1 + xOffset1, y1 + yOffset1, r1, g1, b1, 1);
  return vertex;
}

function writeColoredVertex(
  positions: Float32Array,
  colors: Float32Array,
  sides: Float32Array,
  vertex: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  side: number,
) {
  const vertexIndex = vertex * 3;
  positions[vertexIndex] = x;
  positions[vertexIndex + 1] = y;
  positions[vertexIndex + 2] = 0;
  colors[vertexIndex] = r;
  colors[vertexIndex + 1] = g;
  colors[vertexIndex + 2] = b;
  sides[vertex] = side;
  return vertex + 1;
}

const fullScreenVert = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function chooseRenderTargetType(renderer: THREE.WebGLRenderer): THREE.TextureDataType {
  const gl = renderer.getContext();
  if (renderer.capabilities.isWebGL2) {
    return gl.getExtension("EXT_color_buffer_float") ? THREE.HalfFloatType : THREE.UnsignedByteType;
  }
  return gl.getExtension("OES_texture_half_float") &&
    gl.getExtension("OES_texture_half_float_linear") &&
    gl.getExtension("EXT_color_buffer_half_float")
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;
}

function makeTarget(width: number, height: number, type: THREE.TextureDataType) {
  return new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    type,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
  });
}
