import type { VectorCommand } from "./types";

export class VectorProgram {
  readonly commands: VectorCommand[] = [];

  moveTo(x: number, y: number): this {
    this.commands.push({ type: "move", x, y });
    return this;
  }

  lineTo(x: number, y: number, intensity?: number, color?: [number, number, number]): this {
    this.commands.push({ type: "line", x, y, intensity, color });
    return this;
  }

  color(r: number, g: number, b: number): this {
    this.commands.push({ type: "color", color: [r, g, b] });
    return this;
  }

  intensity(intensity: number): this {
    this.commands.push({ type: "intensity", intensity });
    return this;
  }

  dwell(duration = 1): this {
    this.commands.push({ type: "dwell", duration });
    return this;
  }

  close(intensity?: number): this {
    const first = this.commands.find((command) => command.type === "move");
    if (first?.type === "move") {
      this.lineTo(first.x, first.y, intensity);
    }
    return this;
  }

  append(other: VectorProgram): this {
    this.commands.push(...other.commands);
    return this;
  }
}
