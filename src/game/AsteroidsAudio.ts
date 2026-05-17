import type { AsteroidsSoundEvent } from "./AsteroidsGame";

type ClipName =
  | "bangLarge"
  | "bangMedium"
  | "bangSmall"
  | "beat1"
  | "beat2"
  | "extraShip"
  | "fire";

type LoopName = "thrust" | "saucerBig" | "saucerSmall";

const basePath = `${import.meta.env.BASE_URL}sounds/asteroids/`;

const clipFiles: Record<ClipName, string> = {
  bangLarge: "bangLarge.wav",
  bangMedium: "bangMedium.wav",
  bangSmall: "bangSmall.wav",
  beat1: "beat1.wav",
  beat2: "beat2.wav",
  extraShip: "extraShip.wav",
  fire: "fire.wav",
};

const loopFiles: Record<LoopName, string> = {
  thrust: "thrust.wav",
  saucerBig: "saucerBig.wav",
  saucerSmall: "saucerSmall.wav",
};

export class AsteroidsAudio {
  private clips = new Map<ClipName, HTMLAudioElement>();
  private loops = new Map<LoopName, HTMLAudioElement>();
  private unlocked = false;

  constructor() {
    for (const [name, file] of Object.entries(clipFiles) as Array<[ClipName, string]>) {
      const audio = new Audio(basePath + file);
      audio.preload = "auto";
      this.clips.set(name, audio);
    }
    for (const [name, file] of Object.entries(loopFiles) as Array<[LoopName, string]>) {
      const audio = new Audio(basePath + file);
      audio.preload = "auto";
      audio.loop = true;
      audio.volume = name === "thrust" ? 0.52 : 0.34;
      this.loops.set(name, audio);
    }
  }

  unlock() {
    this.unlocked = true;
  }

  handleEvents(events: AsteroidsSoundEvent[]) {
    if (events.length === 0) {
      return;
    }
    this.unlock();
    for (const event of events) {
      switch (event) {
        case "thrustStart":
          this.startLoop("thrust");
          break;
        case "thrustStop":
          this.stopLoop("thrust");
          break;
        case "saucerBigStart":
          this.stopLoop("saucerSmall");
          this.startLoop("saucerBig");
          break;
        case "saucerSmallStart":
          this.stopLoop("saucerBig");
          this.startLoop("saucerSmall");
          break;
        case "saucerStop":
          this.stopLoop("saucerBig");
          this.stopLoop("saucerSmall");
          break;
        default:
          this.playClip(event);
          break;
      }
    }
  }

  dispose() {
    for (const loop of this.loops.values()) {
      loop.pause();
      loop.currentTime = 0;
    }
  }

  private playClip(name: ClipName) {
    if (!this.unlocked) {
      return;
    }
    const source = this.clips.get(name);
    if (!source) {
      return;
    }
    const clip = source.cloneNode(true) as HTMLAudioElement;
    clip.volume = name.startsWith("beat") ? 0.45 : 0.75;
    void clip.play().catch(() => undefined);
  }

  private startLoop(name: LoopName) {
    if (!this.unlocked) {
      return;
    }
    const loop = this.loops.get(name);
    if (!loop || !loop.paused) {
      return;
    }
    loop.currentTime = 0;
    void loop.play().catch(() => undefined);
  }

  private stopLoop(name: LoopName) {
    const loop = this.loops.get(name);
    if (!loop) {
      return;
    }
    loop.pause();
    loop.currentTime = 0;
  }
}
