import { VectorProgram } from "../core/VectorProgram";
import { ASTEROIDS_VECTOR_HZ } from "../core/presets";
import type { VectorCommand } from "../core/types";

const WORLD_W = 2;
const WORLD_H = 1.5;
const HALF_W = WORLD_W / 2;
const HALF_H = WORLD_H / 2;
const MAX_PLAYER_SHOTS = 4;
const SHIP_DRAW_SCALE = 0.00115;
const SHIP_RADIUS = 0.032;
const RESPAWN_TIME = 1.8;
const ASTEROIDS_VG_HZ = ASTEROIDS_VECTOR_HZ;
const SAUCER_UPDATE_PERIOD = 4 / ASTEROIDS_VG_HZ;
const SAUCER_ACTION_PERIOD = 40 / ASTEROIDS_VG_HZ;
const SAUCER_Y_CHANGE_PERIOD = 128 / ASTEROIDS_VG_HZ;
const SAUCER_RELOAD_MIN_TICKS = 32;
const SAUCER_RELOAD_STEP_TICKS = 6;
const SAUCER_START_RELOAD_TICKS = 0x92;
const EMPTY_SOUND_EVENTS: AsteroidsSoundEvent[] = [];

type Vec2 = { x: number; y: number };
type InputState = {
  left: boolean;
  right: boolean;
  thrust: boolean;
  fire: boolean;
  hyperspace: boolean;
  start: boolean;
};

type Shot = Vec2 & {
  vx: number;
  vy: number;
  life: number;
  owner: "ship" | "saucer";
};

type Rock = Vec2 & {
  vx: number;
  vy: number;
  size: 3 | 2 | 1;
  shape: number;
  spin: number;
  angle: number;
};

type Saucer = Vec2 & {
  vx: number;
  vy: number;
  size: "large" | "small";
  actionTimer: number;
  yChangeTimer: number;
  life: number;
};

type Particle = Vec2 & {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  shape: number;
};

type RockExplosion = Vec2 & {
  life: number;
  maxLife: number;
  scale: number;
};

type Ship = Vec2 & {
  vx: number;
  vy: number;
  angle: number;
  visible: boolean;
  invulnerable: number;
  respawn: number;
};

export type AsteroidsSnapshot = {
  score: number;
  highScore: number;
  lives: number;
  wave: number;
  rocks: number;
  mode: "attract" | "playing" | "game-over";
};

export type AsteroidsSoundEvent =
  | "fire"
  | "bangLarge"
  | "bangMedium"
  | "bangSmall"
  | "beat1"
  | "beat2"
  | "extraShip"
  | "thrustStart"
  | "thrustStop"
  | "saucerBigStart"
  | "saucerSmallStart"
  | "saucerStop";

export class AsteroidsGame {
  readonly input: InputState = {
    left: false,
    right: false,
    thrust: false,
    fire: false,
    hyperspace: false,
    start: false,
  };

  private ship: Ship = makeShip();
  private rocks: Rock[] = [];
  private shots: Shot[] = [];
  private saucerShots: Shot[] = [];
  private particles: Particle[] = [];
  private rockExplosions: RockExplosion[] = [];
  private saucer: Saucer | null = null;
  private saucerReloadTicks = SAUCER_START_RELOAD_TICKS;
  private mode: AsteroidsSnapshot["mode"] = "attract";
  private score = 0;
  private highScore = 0;
  private lives = 3;
  private nextBonus = 10000;
  private wave = 0;
  private fireLatch = false;
  private hyperLatch = false;
  private queuedFire = false;
  private queuedHyperspace = false;
  private saucerTimer = 8;
  private beatTimer = 0.75;
  private beatToggle = false;
  private lastThrusting = false;
  private gameOverTimer = 0;
  private attractSpin = 0;
  private heartbeat = 0;
  private program = new VectorProgram();
  private soundEvents: AsteroidsSoundEvent[] = [];
  private drainedSoundEvents: AsteroidsSoundEvent[] = [];

  update(dt: number) {
    const step = Math.min(dt, 1 / 30);
    this.attractSpin += step;
    this.heartbeat = (this.heartbeat + step) % 2;

    if (this.input.start && this.mode !== "playing") {
      this.startGame();
    }

    if (this.mode === "playing") {
      this.updateShip(step);
      this.updateShots(step);
      this.updateRocks(step);
      this.updateSaucer(step);
      this.updateParticles(step);
      this.updateRockExplosions(step);
      this.updateBeat(step);
      this.collide();
      if (this.readyForNextWave()) {
        this.nextWave();
      }
    } else {
      this.updateAttract(step);
      this.updateParticles(step);
      this.updateRockExplosions(step);
      if (this.mode === "game-over") {
        this.gameOverTimer -= step;
        if (this.gameOverTimer <= 0) {
          this.mode = "attract";
        }
      }
    }
  }

  requestStart() {
    if (this.mode !== "playing") {
      this.startGame();
    }
  }

  requestFire() {
    this.queuedFire = true;
  }

  requestHyperspace() {
    this.queuedHyperspace = true;
  }

  releaseControlsAndAudio() {
    this.input.left = false;
    this.input.right = false;
    this.input.thrust = false;
    this.input.fire = false;
    this.input.hyperspace = false;
    this.input.start = false;
    this.fireLatch = false;
    this.hyperLatch = false;
    this.queuedFire = false;
    this.queuedHyperspace = false;
    this.emit("thrustStop");
    this.lastThrusting = false;
    this.clearSaucer(true, true);
  }

  drainSoundEvents(): AsteroidsSoundEvent[] {
    if (this.soundEvents.length === 0) {
      return EMPTY_SOUND_EVENTS;
    }
    const events = this.soundEvents;
    this.soundEvents = this.drainedSoundEvents;
    this.soundEvents.length = 0;
    this.drainedSoundEvents = events;
    return events;
  }

  snapshot(): AsteroidsSnapshot {
    return {
      score: this.score,
      highScore: this.highScore,
      lives: this.lives,
      wave: Math.max(1, this.wave),
      rocks: this.rocks.length,
      mode: this.mode,
    };
  }

  commands(time: number): VectorCommand[] {
    const p = this.program;
    p.commands.length = 0;
    p.color(ASTEROIDS_BASE_COLOR[0], ASTEROIDS_BASE_COLOR[1], ASTEROIDS_BASE_COLOR[2]).intensity(ASTEROIDS_BASE_INTENSITY);
    this.drawHud(p, time);

    for (const rock of this.rocks) {
      drawWrappedRock(p, rock);
    }

    if (this.ship.visible && (this.ship.invulnerable <= 0 || Math.floor(time * 12) % 2 === 0)) {
      drawWrappedShip(p, this.ship, this.input.thrust && this.mode === "playing", time);
    }

    for (const shot of this.shots) {
      drawWrappedShot(p, shot, 0.95);
    }
    for (const shot of this.saucerShots) {
      drawWrappedShot(p, shot, 0.86);
    }

    if (this.saucer) {
      drawWrappedSaucer(p, this.saucer);
    }

    for (const explosion of this.rockExplosions) {
      drawWrappedExplosion(p, explosion);
    }

    for (const particle of this.particles) {
      drawShipExplosionPiece(p, particle);
    }

    if (this.mode === "attract") {
      drawText(p, "PUSH START", -0.34, -0.18, 0.042, 0.72);
      drawText(p, "1 PLAYER", -0.25, -0.29, 0.032, 0.55);
      drawText(p, "ARROWS  SPACE  H", -0.43, -0.57, 0.022, 0.38);
    }
    if (this.mode === "game-over") {
      drawText(p, "GAME OVER", -0.31, 0.04, 0.046, 0.78);
      drawText(p, "PUSH START", -0.29, -0.14, 0.032, 0.52);
    }

    p.dwell(0.4);
    return p.commands;
  }

  private startGame() {
    this.score = 0;
    this.nextBonus = 10000;
    this.lives = 3;
    this.wave = 0;
    this.saucerReloadTicks = SAUCER_START_RELOAD_TICKS;
    this.shots = [];
    this.particles = [];
    this.rockExplosions = [];
    this.clearSaucer(true, true);
    this.emit("thrustStop");
    this.lastThrusting = false;
    this.beatTimer = 0.75;
    this.beatToggle = false;
    this.ship = makeShip();
    this.mode = "playing";
    this.nextWave();
  }

  private nextWave() {
    this.wave += 1;
    this.clearSaucer(true, false);
    this.resetSaucerTimer();
    this.spawnRocks(Math.min(11, 4 + (this.wave - 1) * 2));
    this.ship.visible = true;
    this.ship.respawn = 0;
    this.ship.invulnerable = 2.2;
  }

  private spawnRocks(count: number) {
    this.rocks = [];
    for (let i = 0; i < count; i += 1) {
      const side = i % 4;
      const pos = edgeSpawn(side);
      const angle = Math.atan2(-pos.y, -pos.x) + rand(-0.65, 0.65);
      const speed = rand(0.045, 0.105) + this.wave * 0.004;
      this.rocks.push({
        x: pos.x,
        y: pos.y,
        vx: Math.sin(angle) * speed,
        vy: Math.cos(angle) * speed,
        size: 3,
        shape: i % ROCK_SHAPES.length,
        spin: rand(-1, 1),
        angle: rand(0, Math.PI * 2),
      });
    }
  }

  private updateShip(dt: number) {
    if (!this.ship.visible) {
      this.ship.respawn -= dt;
      if (this.ship.respawn <= 0 && this.clearToRespawn()) {
      this.ship = makeShip();
      this.ship.invulnerable = 2.4;
      }
      return;
    }

    const rotate = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    this.ship.angle += rotate * 5.2 * dt;
    if (this.input.thrust) {
      this.ship.vx += Math.sin(this.ship.angle) * 0.52 * dt;
      this.ship.vy += Math.cos(this.ship.angle) * 0.52 * dt;
    }

    this.ship.vx *= Math.pow(0.992, dt * 60);
    this.ship.vy *= Math.pow(0.992, dt * 60);
    const speed = Math.hypot(this.ship.vx, this.ship.vy);
    if (speed > 0.62) {
      this.ship.vx = (this.ship.vx / speed) * 0.62;
      this.ship.vy = (this.ship.vy / speed) * 0.62;
    }
    this.ship.x += this.ship.vx * dt;
    this.ship.y += this.ship.vy * dt;
    wrap(this.ship);
    this.ship.invulnerable = Math.max(0, this.ship.invulnerable - dt);
    const thrusting = this.input.thrust && this.ship.visible;
    if (thrusting !== this.lastThrusting) {
      this.emit(thrusting ? "thrustStart" : "thrustStop");
      this.lastThrusting = thrusting;
    }

    if ((this.input.fire && !this.fireLatch) || this.queuedFire) {
      this.fireShipShot();
    }
    this.queuedFire = false;
    this.fireLatch = this.input.fire;

    if ((this.input.hyperspace && !this.hyperLatch) || this.queuedHyperspace) {
      this.hyperspace();
    }
    this.queuedHyperspace = false;
    this.hyperLatch = this.input.hyperspace;
  }

  private fireShipShot() {
    if (this.shots.length >= MAX_PLAYER_SHOTS || !this.ship.visible) {
      return;
    }
    const sin = Math.sin(this.ship.angle);
    const cos = Math.cos(this.ship.angle);
    this.shots.push({
      x: this.ship.x + sin * 0.052,
      y: this.ship.y + cos * 0.052,
      vx: this.ship.vx + sin * 0.88,
      vy: this.ship.vy + cos * 0.88,
      life: 1.05,
      owner: "ship",
    });
    this.emit("fire");
  }

  private hyperspace() {
    if (!this.ship.visible) {
      return;
    }
    this.ship.x = rand(-0.82, 0.82);
    this.ship.y = rand(-0.56, 0.56);
    this.ship.vx *= 0.25;
    this.ship.vy *= 0.25;
    this.ship.invulnerable = 0.65;
    const failureChance = Math.min(0.48, 0.06 + this.rocks.length / 18);
    if (Math.random() < failureChance) {
      this.killShip();
    }
  }

  private updateShots(dt: number) {
    compactShots(this.shots, dt);
    compactShots(this.saucerShots, dt);
  }

  private updateRocks(dt: number) {
    for (const rock of this.rocks) {
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.angle += rock.spin * dt;
      wrap(rock);
    }
  }

  private updateSaucer(dt: number) {
    if (!this.saucer) {
      this.saucerTimer -= dt;
      if (this.saucerTimer <= 0 && this.mode === "playing" && this.ship.visible && this.ship.respawn <= 0) {
        if (this.rocks.length === 0) {
          this.saucerTimer = SAUCER_UPDATE_PERIOD;
          return;
        }
        this.spawnSaucer();
      }
      return;
    }

    this.saucer.x += this.saucer.vx * dt;
    this.saucer.y += this.saucer.vy * dt;
    wrapY(this.saucer);
    this.saucer.life -= dt;
    this.saucer.actionTimer -= dt;
    this.saucer.yChangeTimer -= dt;
    if (this.saucer.yChangeTimer <= 0) {
      this.saucer.vy = randomSaucerYVelocity();
      this.saucer.yChangeTimer += SAUCER_Y_CHANGE_PERIOD;
    }
    if (this.saucer.actionTimer <= 0 && this.ship.visible && this.ship.respawn <= 0) {
      this.fireSaucerShot();
      this.saucer.actionTimer += SAUCER_ACTION_PERIOD;
    }
    if (this.saucer.life <= 0 || this.saucer.x < -1.18 || this.saucer.x > 1.18) {
      this.clearSaucer(false, false, true);
    }
  }

  private spawnSaucer() {
    const fromLeft = Math.random() < 0.5;
    this.saucerReloadTicks = Math.max(SAUCER_RELOAD_MIN_TICKS, this.saucerReloadTicks - SAUCER_RELOAD_STEP_TICKS);
    const small = chooseSmallSaucer(this.score, this.saucerReloadTicks);
    const xSpeed = 0.16;
    this.saucer = {
      x: fromLeft ? -1.12 : 1.12,
      y: rand(-0.44, 0.52),
      vx: (fromLeft ? 1 : -1) * xSpeed,
      vy: randomSaucerYVelocity(),
      size: small ? "small" : "large",
      actionTimer: SAUCER_ACTION_PERIOD,
      yChangeTimer: SAUCER_Y_CHANGE_PERIOD,
      life: 14,
    };
    this.emit(small ? "saucerSmallStart" : "saucerBigStart");
  }

  private fireSaucerShot() {
    if (!this.saucer || this.saucerShots.length >= 2) {
      return;
    }
    let angle = rand(0, Math.PI * 2);
    if (this.saucer.size === "small" && this.ship.visible) {
      const leadX = this.ship.x + this.ship.vx * 0.34;
      const leadY = this.ship.y + this.ship.vy * 0.34;
      const inaccuracy = this.score >= 35000 ? 0.12 : 0.45;
      angle = Math.atan2(leadX - this.saucer.x, leadY - this.saucer.y) + rand(-inaccuracy, inaccuracy);
    }
    this.saucerShots.push({
      x: this.saucer.x,
      y: this.saucer.y,
      vx: Math.sin(angle) * 0.62,
      vy: Math.cos(angle) * 0.62,
      life: 1.65,
      owner: "saucer",
    });
    this.emit("fire");
  }

  private updateParticles(dt: number) {
    let write = 0;
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      wrap(particle);
      if (particle.life > 0) {
        this.particles[write] = particle;
        write += 1;
      }
    }
    this.particles.length = write;
  }

  private updateRockExplosions(dt: number) {
    let write = 0;
    for (let i = 0; i < this.rockExplosions.length; i += 1) {
      const explosion = this.rockExplosions[i];
      explosion.life -= dt;
      wrap(explosion);
      if (explosion.life > 0) {
        this.rockExplosions[write] = explosion;
        write += 1;
      }
    }
    this.rockExplosions.length = write;
  }

  private updateBeat(dt: number) {
    this.beatTimer -= dt;
    if (this.beatTimer > 0 || this.mode !== "playing") {
      return;
    }
    this.emit(this.beatToggle ? "beat2" : "beat1");
    this.beatToggle = !this.beatToggle;
    const pressure = 1 - Math.min(1, this.rocks.length / Math.max(4, 4 + (this.wave - 1) * 2));
    this.beatTimer = 0.78 - pressure * 0.42;
  }

  private collide() {
    for (let shotIndex = this.shots.length - 1; shotIndex >= 0; shotIndex -= 1) {
      const shot = this.shots[shotIndex];
      let rockHit: Rock | null = null;
      for (const rock of this.rocks) {
        if (distanceWrapped(shot, rock) < radiusForRock(rock)) {
          rockHit = rock;
          break;
        }
      }
      if (rockHit) {
        this.destroyRock(rockHit, shot);
        this.shots.splice(shotIndex, 1);
      }
    }

    for (let shotIndex = this.saucerShots.length - 1; shotIndex >= 0; shotIndex -= 1) {
      const shot = this.saucerShots[shotIndex];
      let rockHit: Rock | null = null;
      for (const rock of this.rocks) {
        if (distanceWrapped(shot, rock) < radiusForRock(rock)) {
          rockHit = rock;
          break;
        }
      }
      if (rockHit) {
        this.destroyRock(rockHit, shot, false);
        this.saucerShots.splice(shotIndex, 1);
      }
    }

    if (this.saucer) {
      let hitIndex = -1;
      const hitRadius = this.saucer.size === "small" ? 0.045 : 0.07;
      for (let i = 0; i < this.shots.length; i += 1) {
        if (distanceWrapped(this.shots[i], this.saucer) < hitRadius) {
          hitIndex = i;
          break;
        }
      }
      if (hitIndex >= 0) {
        this.addScore(this.saucer.size === "small" ? 990 : 200);
        this.spawnRockExplosion(this.saucer, 1.1);
        this.emit("bangLarge");
        this.clearSaucer(false, false, true);
        this.shots.splice(hitIndex, 1);
      }
    }

    if (this.saucer) {
      const saucerRadius = this.saucer.size === "small" ? 0.045 : 0.07;
      let rockHit: Rock | null = null;
      for (const rock of this.rocks) {
        if (distanceWrapped(this.saucer, rock) < radiusForRock(rock) + saucerRadius) {
          rockHit = rock;
          break;
        }
      }
      if (rockHit) {
        this.destroyRock(rockHit, this.saucer, false);
        this.spawnRockExplosion(this.saucer, 1.1);
        this.emit("bangLarge");
        this.clearSaucer(false, false, true);
      }
    }

    if (this.ship.visible && this.ship.invulnerable <= 0) {
      let rockHit: Rock | null = null;
      for (const rock of this.rocks) {
        if (distanceWrapped(this.ship, rock) < radiusForRock(rock) + SHIP_RADIUS) {
          rockHit = rock;
          break;
        }
      }
      const saucerHit = this.saucer && distanceWrapped(this.ship, this.saucer) < (this.saucer.size === "small" ? 0.075 : 0.1) ? this.saucer : null;
      let shotHitIndex = -1;
      for (let i = 0; i < this.saucerShots.length; i += 1) {
        const shot = this.saucerShots[i];
        if (distanceWrapped(this.ship, shot) < SHIP_RADIUS) {
          shotHitIndex = i;
          break;
        }
      }
      if (rockHit || saucerHit || shotHitIndex >= 0) {
        if (rockHit) {
          this.destroyRock(rockHit, this.ship, true);
        }
        if (saucerHit) {
          this.spawnRockExplosion(saucerHit, 1.1);
          this.clearSaucer(false, false, true);
        }
        if (shotHitIndex >= 0) {
          this.saucerShots.splice(shotHitIndex, 1);
        }
        this.killShip();
      }
    }
  }

  private destroyRock(rock: Rock, shot: Vec2, awardScore = true) {
    const rockIndex = this.rocks.indexOf(rock);
    if (rockIndex >= 0) {
      this.rocks.splice(rockIndex, 1);
    }
    if (awardScore) {
      this.addScore(rock.size === 3 ? 20 : rock.size === 2 ? 50 : 100);
    }
    this.spawnRockExplosion(rock, rock.size === 3 ? 1.1 : rock.size === 2 ? 0.72 : 0.44);
    this.emit(rock.size === 3 ? "bangLarge" : rock.size === 2 ? "bangMedium" : "bangSmall");

    if (rock.size > 1) {
      const nextSize = (rock.size - 1) as 2 | 1;
      for (let i = 0; i < 2; i += 1) {
        const angle = Math.atan2(rock.y - shot.y, rock.x - shot.x) + (i === 0 ? -0.75 : 0.75) + rand(-0.28, 0.28);
        const speed = Math.hypot(rock.vx, rock.vy) * 1.12 + rand(0.045, 0.09);
        this.rocks.push({
          x: rock.x + Math.sin(angle) * 0.02,
          y: rock.y + Math.cos(angle) * 0.02,
          vx: Math.sin(angle) * speed,
          vy: Math.cos(angle) * speed,
          size: nextSize,
          shape: (rock.shape + i + 1) % ROCK_SHAPES.length,
          spin: rand(-1.8, 1.8),
          angle: rock.angle + i,
        });
      }
    }
  }

  private killShip() {
    if (!this.ship.visible) {
      return;
    }
    this.spawnShipDebris();
    this.emit("bangLarge");
    this.emit("thrustStop");
    this.lastThrusting = false;
    this.ship.visible = false;
    this.ship.respawn = RESPAWN_TIME;
    this.lives -= 1;
    if (this.lives <= 0) {
      this.mode = "game-over";
      this.gameOverTimer = 6;
      this.ship.visible = false;
      this.clearSaucer(true, false, true);
    }
  }

  private addScore(points: number) {
    this.score += points;
    if (this.score >= this.nextBonus) {
      this.lives += 1;
      this.nextBonus += 10000;
      this.emit("extraShip");
    }
    this.highScore = Math.max(this.highScore, this.score);
  }

  private spawnRockExplosion(pos: Vec2, scale: number) {
    this.rockExplosions.push({
      x: pos.x,
      y: pos.y,
      life: ROCK_EXPLOSION_LIFE,
      maxLife: ROCK_EXPLOSION_LIFE,
      scale,
    });
  }

  private spawnShipDebris() {
    for (let i = 0; i < SHIP_EXPLOSION_DIRS.length; i += 1) {
      const dir = SHIP_EXPLOSION_DIRS[i];
      this.particles.push({
        x: this.ship.x + (dir.x / 16) * SHIP_EXPLOSION_SCALE,
        y: this.ship.y + (dir.y / 16) * SHIP_EXPLOSION_SCALE,
        vx: (dir.x / 256) * SHIP_EXPLOSION_SCALE * ASTEROIDS_VG_HZ,
        vy: (dir.y / 256) * SHIP_EXPLOSION_SCALE * ASTEROIDS_VG_HZ,
        life: SHIP_EXPLOSION_LIFE,
        maxLife: SHIP_EXPLOSION_LIFE,
        shape: i,
      });
    }
    this.ship.vx = 0;
    this.ship.vy = 0;
  }

  private clearToRespawn() {
    return this.rocks.every((rock) => Math.hypot(rock.x, rock.y) > 0.22) && (!this.saucer || Math.hypot(this.saucer.x, this.saucer.y) > 0.24);
  }

  private readyForNextWave() {
    return (
      this.rocks.length === 0 &&
      !this.saucer &&
      this.saucerShots.length === 0 &&
      this.rockExplosions.length === 0 &&
      this.particles.length === 0 &&
      this.ship.visible
    );
  }

  private clearSaucer(clearShots: boolean, forceStop: boolean, resetTimer = false) {
    if (this.saucer || forceStop) {
      this.emit("saucerStop");
    }
    this.saucer = null;
    if (clearShots) {
      this.saucerShots = [];
    }
    if (resetTimer) {
      this.resetSaucerTimer();
    }
  }

  private resetSaucerTimer() {
    this.saucerTimer = saucerTicksToSeconds(this.saucerReloadTicks);
  }

  private updateAttract(dt: number) {
    if (this.rocks.length === 0) {
      this.spawnRocks(4);
      this.ship.visible = true;
      this.ship.x = 0;
      this.ship.y = 0.05;
    }
    this.updateRocks(dt * 0.72);
    this.ship.angle += dt * 0.55;
  }

  private emit(event: AsteroidsSoundEvent) {
    this.soundEvents.push(event);
  }

  private drawHud(p: VectorProgram, time: number) {
    drawText(p, padScore(this.score), -0.88, 0.61, 0.034, 0.72);
    drawText(p, "HI", -0.1, 0.69, 0.022, 0.48);
    drawText(p, padScore(Math.max(this.highScore, 10000)), -0.02, 0.67, 0.034, 0.62);
    if (this.mode === "playing") {
      for (let i = 0; i < Math.max(0, this.lives); i += 1) {
        drawShip(p, -0.86 + i * 0.068, 0.515, 0, false, time, 0.62);
      }
    }
  }
}

function compactShots(shots: Shot[], dt: number) {
  let write = 0;
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    wrap(shot);
    if (shot.life > 0) {
      shots[write] = shot;
      write += 1;
    }
  }
  shots.length = write;
}

function makeShip(): Ship {
  return { x: 0, y: 0, vx: 0, vy: 0, angle: 0, visible: true, invulnerable: 0, respawn: 0 };
}

function saucerTicksToSeconds(ticks: number) {
  return ticks * SAUCER_UPDATE_PERIOD;
}

function chooseSmallSaucer(score: number, saucerReloadTicks: number) {
  if (saucerReloadTicks >= 0x80) {
    return false;
  }
  if (score >= 3000) {
    return true;
  }
  const largeChance = Math.min(0.92, Math.max(0.06, saucerReloadTicks / 512));
  return Math.random() >= largeChance;
}

function randomSaucerYVelocity() {
  const index = Math.floor(Math.random() * 4);
  if (index === 0) {
    return -0.12;
  }
  if (index === 3) {
    return 0.12;
  }
  return 0;
}

function edgeSpawn(side: number): Vec2 {
  if (side === 0) return { x: rand(-0.9, 0.9), y: HALF_H + 0.08 };
  if (side === 1) return { x: HALF_W + 0.08, y: rand(-0.62, 0.62) };
  if (side === 2) return { x: rand(-0.9, 0.9), y: -HALF_H - 0.08 };
  return { x: -HALF_W - 0.08, y: rand(-0.62, 0.62) };
}

function wrap(p: Vec2) {
  if (p.x < -HALF_W) p.x += WORLD_W;
  if (p.x > HALF_W) p.x -= WORLD_W;
  if (p.y < -HALF_H) p.y += WORLD_H;
  if (p.y > HALF_H) p.y -= WORLD_H;
}

function wrapY(p: Vec2) {
  if (p.y < -HALF_H) p.y += WORLD_H;
  if (p.y > HALF_H) p.y -= WORLD_H;
}

function distanceWrapped(a: Vec2, b: Vec2) {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  dx = Math.min(dx, WORLD_W - dx);
  dy = Math.min(dy, WORLD_H - dy);
  return Math.hypot(dx, dy);
}

function drawWrappedRock(p: VectorProgram, rock: Rock) {
  const radius = radiusForRock(rock);
  const ox = wrapOffsetX(rock.x, radius);
  const oy = wrapOffsetY(rock.y, radius);
  drawRockAt(p, rock, 0, 0);
  if (ox !== 0) drawRockAt(p, rock, ox, 0);
  if (oy !== 0) drawRockAt(p, rock, 0, oy);
  if (ox !== 0 && oy !== 0) drawRockAt(p, rock, ox, oy);
}

function drawWrappedShip(p: VectorProgram, ship: Ship, thrust: boolean, time: number) {
  const ox = wrapOffsetX(ship.x, 0.07);
  const oy = wrapOffsetY(ship.y, 0.07);
  drawShip(p, ship.x, ship.y, ship.angle, thrust, time);
  if (ox !== 0) drawShip(p, ship.x + ox, ship.y, ship.angle, thrust, time);
  if (oy !== 0) drawShip(p, ship.x, ship.y + oy, ship.angle, thrust, time);
  if (ox !== 0 && oy !== 0) drawShip(p, ship.x + ox, ship.y + oy, ship.angle, thrust, time);
}

function drawWrappedShot(p: VectorProgram, shot: Shot, intensity: number) {
  const ox = wrapOffsetX(shot.x, 0.02);
  const oy = wrapOffsetY(shot.y, 0.02);
  drawShot(p, shot.x, shot.y, intensity);
  if (ox !== 0) drawShot(p, shot.x + ox, shot.y, intensity);
  if (oy !== 0) drawShot(p, shot.x, shot.y + oy, intensity);
  if (ox !== 0 && oy !== 0) drawShot(p, shot.x + ox, shot.y + oy, intensity);
}

function drawWrappedSaucer(p: VectorProgram, saucer: Saucer) {
  const scale = saucer.size === "small" ? 0.62 : 0.92;
  const ox = wrapOffsetX(saucer.x, 0.12);
  const oy = wrapOffsetY(saucer.y, 0.12);
  drawSaucer(p, saucer.x, saucer.y, scale);
  if (ox !== 0) drawSaucer(p, saucer.x + ox, saucer.y, scale);
  if (oy !== 0) drawSaucer(p, saucer.x, saucer.y + oy, scale);
  if (ox !== 0 && oy !== 0) drawSaucer(p, saucer.x + ox, saucer.y + oy, scale);
}

function drawWrappedExplosion(p: VectorProgram, explosion: RockExplosion) {
  const step = rockExplosionStep(explosion);
  const radius = 0.12 * explosion.scale;
  const ox = wrapOffsetX(explosion.x, radius);
  const oy = wrapOffsetY(explosion.y, radius);
  drawExplosionPic(p, explosion.x, explosion.y, explosion.scale, step);
  if (ox !== 0) drawExplosionPic(p, explosion.x + ox, explosion.y, explosion.scale, step);
  if (oy !== 0) drawExplosionPic(p, explosion.x, explosion.y + oy, explosion.scale, step);
  if (ox !== 0 && oy !== 0) drawExplosionPic(p, explosion.x + ox, explosion.y + oy, explosion.scale, step);
}

function drawRockAt(p: VectorProgram, rock: Rock, ox: number, oy: number) {
  drawPoly(p, ROCK_SHAPES[rock.shape], rock.x + ox, rock.y + oy, scaleForRock(rock), rock.angle, true, 0.74);
}

function wrapOffsetX(x: number, radius: number) {
  if (x - radius < -HALF_W) return WORLD_W;
  if (x + radius > HALF_W) return -WORLD_W;
  return 0;
}

function wrapOffsetY(y: number, radius: number) {
  if (y - radius < -HALF_H) return WORLD_H;
  if (y + radius > HALF_H) return -WORLD_H;
  return 0;
}

function drawPoly(p: VectorProgram, pts: Vec2[], x: number, y: number, scale: number, angle: number, closed: boolean, intensity = 0.78) {
  if (pts.length === 0) {
    return;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const first = pts[0];
  const firstX = x + (first.x * cos + first.y * sin) * scale;
  const firstY = y + (-first.x * sin + first.y * cos) * scale;
  p.moveTo(firstX, firstY);
  for (let i = 1; i < pts.length; i += 1) {
    const pt = pts[i];
    p.lineTo(x + (pt.x * cos + pt.y * sin) * scale, y + (-pt.x * sin + pt.y * cos) * scale, intensity);
  }
  if (closed) {
    p.lineTo(firstX, firstY, intensity);
  }
}

function drawShip(p: VectorProgram, x: number, y: number, angle: number, thrust: boolean, time: number, scale = 1) {
  drawPoly(p, SHIP_SHAPE, x, y, SHIP_DRAW_SCALE * scale, angle, false, 0.9);
  if (thrust && Math.floor(time * 22) % 2 === 0) {
    drawPoly(p, FLAME_SHAPE, x, y, SHIP_DRAW_SCALE * scale, angle, false, 0.86);
  }
}

function drawSaucer(p: VectorProgram, x: number, y: number, scale: number) {
  drawPoly(p, SAUCER_OUTLINE, x, y, 0.00135 * scale, 0, false, 0.9);
  lineLocal(p, x, y, -38, 0, 38, 0, 0.00135 * scale, 0.76);
  lineLocal(p, x, y, -18, 14, 18, 14, 0.00135 * scale, 0.68);
}

function drawShot(p: VectorProgram, x: number, y: number, intensity: number) {
  p.moveTo(x - 0.006, y).lineTo(x + 0.006, y, intensity);
  p.moveTo(x, y - 0.006).lineTo(x, y + 0.006, intensity);
  p.dwell(0.12);
}

function drawExplosionPic(p: VectorProgram, x: number, y: number, scale: number, step: RockExplosionStep) {
  const points = SHARPNEL_PATTERNS[step.pic] ?? SHARPNEL_PATTERNS[SHARPNEL_PATTERNS.length - 1];
  const pointScale = 0.19 * scale * step.scale;
  p.color(1, 1, 1).intensity(ROCK_EXPLOSION_INTENSITY);
  for (const point of points) {
    const px = x + point.x * pointScale;
    const py = y + point.y * pointScale;
    drawHotShrapnelDot(p, px, py);
  }
  p.color(ASTEROIDS_BASE_COLOR[0], ASTEROIDS_BASE_COLOR[1], ASTEROIDS_BASE_COLOR[2]).intensity(ASTEROIDS_BASE_INTENSITY);
}

function drawHotShrapnelDot(p: VectorProgram, x: number, y: number) {
  p.moveTo(x, y).lineTo(x, y, ROCK_EXPLOSION_INTENSITY, [1, 1, 1]);
  p.dwell(ROCK_EXPLOSION_DOT_DWELL);
}

function drawShipExplosionPiece(p: VectorProgram, particle: Particle) {
  if (!shipExplosionPieceVisible(particle.shape, particle)) {
    return;
  }
  const piece = SHIP_EXPLOSION_PIECES[particle.shape % SHIP_EXPLOSION_PIECES.length];
  p.moveTo(particle.x, particle.y).lineTo(particle.x + piece.x * SHIP_EXPLOSION_SCALE, particle.y + piece.y * SHIP_EXPLOSION_SCALE, SHIP_EXPLOSION_INTENSITY);
}

function lineLocal(p: VectorProgram, x: number, y: number, x1: number, y1: number, x2: number, y2: number, scale: number, intensity: number) {
  p.moveTo(x + x1 * scale, y + y1 * scale).lineTo(x + x2 * scale, y + y2 * scale, intensity);
}

function radiusForRock(rock: Rock) {
  return rock.size === 3 ? 0.125 : rock.size === 2 ? 0.076 : 0.044;
}

function scaleForRock(rock: Rock) {
  return rock.size === 3 ? 0.0022 : rock.size === 2 ? 0.00135 : 0.00078;
}

type RockExplosionStep = {
  pic: number;
  scale: number;
};

function rockExplosionStep(explosion: RockExplosion) {
  const elapsed = 1 - explosion.life / explosion.maxLife;
  const frame = Math.min(ROCK_EXPLOSION_STEPS.length - 1, Math.max(0, Math.floor(elapsed * ROCK_EXPLOSION_STEPS.length)));
  return ROCK_EXPLOSION_STEPS[frame];
}

function shipExplosionPieceVisible(shape: number, particle: Particle) {
  const elapsed = 1 - particle.life / particle.maxLife;
  const frame = Math.min(SHIP_EXPLOSION_STEPS.length - 1, Math.max(0, Math.floor(elapsed * SHIP_EXPLOSION_STEPS.length)));
  return shape * 2 <= SHIP_EXPLOSION_STEPS[frame].startIndex;
}

function padScore(score: number) {
  return Math.floor(score).toString().padStart(5, "0");
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

const ASTEROIDS_BASE_COLOR: [number, number, number] = [0.88, 0.95, 1];
const ASTEROIDS_BASE_INTENSITY = 0.88;
const ROCK_EXPLOSION_INTENSITY = 0.96;
const ROCK_EXPLOSION_DOT_DWELL = 0.05;
const SHIP_EXPLOSION_INTENSITY = ROCK_EXPLOSION_INTENSITY * (12 / 7);

const SHARPNEL_SOURCE_NORMALIZER = 2048;

// Source-derived asteroid/saucer shrapnel. The ROM uses b=0 moves followed by
// b=7 zero-vectors, so these are cumulative dot positions rather than line
// segments. The local game stores rocks by center, while the arcade vector
// routines are beam-anchor based, so the converted clouds are box-centered.
const SHARPNEL_PATTERNS: Vec2[][] = [
  sourcePatternFromMoves([
    { x: -640, y: 0 },
    { x: -640, y: -640 },
    { x: 640, y: -640 },
    { x: 960, y: 320 },
    { x: 640, y: -320 },
    { x: 0, y: 640 },
    { x: 320, y: 960 },
    { x: -320, y: 960 },
    { x: -640, y: -160 },
    { x: -960, y: 320 },
  ]),
  sourcePatternFromMoves([
    { x: -768, y: 0 },
    { x: -768, y: -768 },
    { x: 768, y: -768 },
    { x: 576, y: 192 },
    { x: 768, y: -384 },
    { x: 0, y: 768 },
    { x: 192, y: 576 },
    { x: -192, y: 576 },
    { x: -768, y: -192 },
    { x: -576, y: 192 },
  ]),
  sourcePatternFromMoves([
    { x: -896, y: 0 },
    { x: -896, y: -896 },
    { x: 896, y: -896 },
    { x: 672, y: 224 },
    { x: 896, y: -448 },
    { x: 0, y: 896 },
    { x: 224, y: 672 },
    { x: -224, y: 672 },
    { x: -896, y: -224 },
    { x: -672, y: 224 },
  ]),
  sourcePatternFromMoves([
    { x: -1024, y: 0 },
    { x: -1024, y: -1024 },
    { x: 1024, y: -1024 },
    { x: 768, y: 256 },
    { x: 512, y: -256 },
    { x: 0, y: 1024 },
    { x: 256, y: 768 },
    { x: -256, y: 768 },
    { x: -512, y: -128 },
    { x: -768, y: 256 },
  ]),
];
const ROCK_EXPLOSION_STEPS = buildRockExplosionSteps();
const ROCK_EXPLOSION_LIFE = ROCK_EXPLOSION_STEPS.length / ASTEROIDS_VG_HZ;

// Asteroids-style timing modeled from public 6502 disassembly notes, with local
// hand-authored vectors. Keep this provenance clear before redistributing builds.
function buildRockExplosionSteps(): RockExplosionStep[] {
  const steps: RockExplosionStep[] = [];
  let obj = 0xa0;
  while (steps.length < 64) {
    const remaining = twosComplementByte(obj);
    obj = (obj + (remaining >> 4) + 1) & 0xff;
    if (signedByte(obj) >= 0) {
      break;
    }
    const vgSize = ((obj & 0xf0) + 0x10) & 0xff;
    steps.push({ pic: (obj & 0x0c) >> 2, scale: vectorScaleForVgSize(vgSize) });
  }
  return steps;
}

type ShipExplosionStep = {
  startIndex: number;
};

const SHIP_EXPLOSION_SCALE = 0.003;
const SHIP_EXPLOSION_PIECES: Vec2[] = [
  { x: -8, y: -12 },
  { x: 4, y: -8 },
  { x: 6, y: 2 },
  { x: -8, y: 8 },
  { x: -6, y: 2 },
  { x: 4, y: -4 },
];
const SHIP_EXPLOSION_DIRS: Vec2[] = [
  { x: -40, y: 30 },
  { x: 50, y: -20 },
  { x: 0, y: -60 },
  { x: 60, y: 20 },
  { x: 10, y: 70 },
  { x: -40, y: -40 },
];
const SHIP_EXPLOSION_STEPS = buildShipExplosionSteps();
const SHIP_EXPLOSION_LIFE = SHIP_EXPLOSION_STEPS.length / ASTEROIDS_VG_HZ;

// Approximation of the original ship-breakup stepping; piece vectors are local
// simplified geometry for this monitor demo rather than ROM/vector-table assets.
function buildShipExplosionSteps(): ShipExplosionStep[] {
  const steps: ShipExplosionStep[] = [];
  let obj = 0xa0;
  while (steps.length < 96) {
    const remaining = twosComplementByte(obj);
    obj = (obj + (remaining >> 4) + (steps.length & 1)) & 0xff;
    if (signedByte(obj) >= 0) {
      break;
    }
    steps.push({ startIndex: ((obj ^ 0xff) & 0x70) >> 3 });
  }
  return steps;
}

function sourcePatternFromMoves(moves: Vec2[]) {
  let x = 0;
  let y = 0;
  const points = moves.map((move) => {
    x += move.x;
    y += move.y;
    return { x, y };
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return points.map((point) => ({
    x: (point.x - centerX) / SHARPNEL_SOURCE_NORMALIZER,
    y: (point.y - centerY) / SHARPNEL_SOURCE_NORMALIZER,
  }));
}

function twosComplementByte(value: number) {
  return ((value ^ 0xff) + 1) & 0xff;
}

function signedByte(value: number) {
  return value & 0x80 ? value - 0x100 : value;
}

function vectorScaleForVgSize(vgSize: number) {
  const nibble = (vgSize & 0xf0) >> 4;
  return nibble === 0 ? 1 : 2 ** (nibble - 16);
}

// Local Asteroids-style silhouettes for play/renderer tuning. They intentionally
// live as project geometry so the demo is not loading ROM vector tables.
const SHIP_SHAPE: Vec2[] = [
  { x: -24, y: -16 },
  { x: 0, y: 48 },
  { x: 24, y: -16 },
  { x: 8, y: -2 },
  { x: -8, y: -2 },
  { x: -24, y: -16 },
];

const FLAME_SHAPE: Vec2[] = [
  { x: -9, y: -8 },
  { x: 0, y: -34 },
  { x: 9, y: -8 },
];

const SAUCER_OUTLINE: Vec2[] = [
  { x: -40, y: 0 },
  { x: -24, y: 16 },
  { x: 24, y: 16 },
  { x: 40, y: 0 },
  { x: 24, y: -16 },
  { x: -24, y: -16 },
  { x: -40, y: 0 },
  { x: -16, y: 28 },
  { x: 16, y: 28 },
  { x: 24, y: 16 },
];

const ROCK_SHAPES: Vec2[][] = [
  [
    { x: 0, y: 32 },
    { x: 28, y: 24 },
    { x: 36, y: 0 },
    { x: 20, y: -24 },
    { x: -4, y: -34 },
    { x: -28, y: -22 },
    { x: -38, y: 4 },
    { x: -18, y: 18 },
  ],
  [
    { x: 10, y: 34 },
    { x: 34, y: 20 },
    { x: 24, y: 4 },
    { x: 36, y: -18 },
    { x: 8, y: -36 },
    { x: -12, y: -24 },
    { x: -32, y: -30 },
    { x: -38, y: -2 },
    { x: -22, y: 28 },
  ],
  [
    { x: -10, y: 34 },
    { x: 16, y: 32 },
    { x: 36, y: 12 },
    { x: 20, y: -4 },
    { x: 30, y: -30 },
    { x: -2, y: -34 },
    { x: -16, y: -16 },
    { x: -36, y: -24 },
    { x: -32, y: 12 },
  ],
  [
    { x: 4, y: 36 },
    { x: 34, y: 14 },
    { x: 20, y: -4 },
    { x: 34, y: -22 },
    { x: 4, y: -36 },
    { x: -12, y: -18 },
    { x: -36, y: -20 },
    { x: -28, y: 8 },
    { x: -36, y: 22 },
    { x: -10, y: 30 },
  ],
];

type Segment = [number, number, number, number];
const GLYPHS: Record<string, Segment[]> = {
  "0": [[0, 0, 1, 0], [1, 0, 1, 1.4], [1, 1.4, 0, 1.4], [0, 1.4, 0, 0]],
  "1": [[0.5, 0, 0.5, 1.4], [0.28, 1.18, 0.5, 1.4]],
  "2": [[0, 1.4, 1, 1.4], [1, 1.4, 1, 0.72], [1, 0.72, 0, 0], [0, 0, 1, 0]],
  "3": [[0, 1.4, 1, 1.4], [1, 1.4, 1, 0], [0.18, 0.72, 1, 0.72], [0, 0, 1, 0]],
  "4": [[0, 1.4, 0, 0.72], [0, 0.72, 1, 0.72], [1, 1.4, 1, 0]],
  "5": [[1, 1.4, 0, 1.4], [0, 1.4, 0, 0.72], [0, 0.72, 1, 0.72], [1, 0.72, 1, 0], [1, 0, 0, 0]],
  "6": [[1, 1.4, 0, 1.4], [0, 1.4, 0, 0], [0, 0.72, 1, 0.72], [1, 0.72, 1, 0], [1, 0, 0, 0]],
  "7": [[0, 1.4, 1, 1.4], [1, 1.4, 0.42, 0]],
  "8": [[0, 0, 1, 0], [1, 0, 1, 1.4], [1, 1.4, 0, 1.4], [0, 1.4, 0, 0], [0, 0.72, 1, 0.72]],
  "9": [[1, 0, 1, 1.4], [1, 1.4, 0, 1.4], [0, 1.4, 0, 0.72], [0, 0.72, 1, 0.72], [1, 0, 0, 0]],
  A: [[0, 0, 0, 1.1], [0, 1.1, 0.5, 1.4], [0.5, 1.4, 1, 1.1], [1, 1.1, 1, 0], [0, 0.72, 1, 0.72]],
  C: [[1, 1.4, 0, 1.4], [0, 1.4, 0, 0], [0, 0, 1, 0]],
  E: [[1, 1.4, 0, 1.4], [0, 1.4, 0, 0], [0, 0.72, 0.78, 0.72], [0, 0, 1, 0]],
  G: [[1, 1.4, 0, 1.4], [0, 1.4, 0, 0], [0, 0, 1, 0], [1, 0, 1, 0.62], [1, 0.62, 0.5, 0.62]],
  H: [[0, 0, 0, 1.4], [1, 0, 1, 1.4], [0, 0.72, 1, 0.72]],
  I: [[0, 1.4, 1, 1.4], [0.5, 1.4, 0.5, 0], [0, 0, 1, 0]],
  L: [[0, 1.4, 0, 0], [0, 0, 1, 0]],
  M: [[0, 0, 0, 1.4], [0, 1.4, 0.5, 0.82], [0.5, 0.82, 1, 1.4], [1, 1.4, 1, 0]],
  O: [[0, 0, 1, 0], [1, 0, 1, 1.4], [1, 1.4, 0, 1.4], [0, 1.4, 0, 0]],
  P: [[0, 0, 0, 1.4], [0, 1.4, 1, 1.4], [1, 1.4, 1, 0.72], [1, 0.72, 0, 0.72]],
  R: [[0, 0, 0, 1.4], [0, 1.4, 1, 1.4], [1, 1.4, 1, 0.72], [1, 0.72, 0, 0.72], [0, 0.72, 1, 0]],
  S: [[1, 1.4, 0, 1.4], [0, 1.4, 0, 0.72], [0, 0.72, 1, 0.72], [1, 0.72, 1, 0], [1, 0, 0, 0]],
  T: [[0, 1.4, 1, 1.4], [0.5, 1.4, 0.5, 0]],
  U: [[0, 1.4, 0, 0], [0, 0, 1, 0], [1, 0, 1, 1.4]],
  V: [[0, 1.4, 0.5, 0], [0.5, 0, 1, 1.4]],
  W: [[0, 1.4, 0.18, 0], [0.18, 0, 0.5, 0.55], [0.5, 0.55, 0.82, 0], [0.82, 0, 1, 1.4]],
  Y: [[0, 1.4, 0.5, 0.74], [1, 1.4, 0.5, 0.74], [0.5, 0.74, 0.5, 0]],
  " ": [],
};

function drawText(p: VectorProgram, text: string, x: number, y: number, scale: number, intensity = 0.65) {
  let pen = x;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char] ?? [];
    for (const [x1, y1, x2, y2] of glyph) {
      p.moveTo(pen + x1 * scale, y + y1 * scale).lineTo(pen + x2 * scale, y + y2 * scale, intensity);
    }
    pen += (char === " " ? 0.72 : 1.28) * scale;
  }
}
