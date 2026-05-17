import { VectorProgram } from "../core/VectorProgram";

type GlyphSegment = readonly [number, number, number, number];

const glyphs: Record<string, string[]> = {
  A: ["01 05", "05 91", "23 73"],
  B: ["00 08", "08 66", "66 44", "44 02", "24 64"],
  C: ["80 20", "20 02", "02 08", "08 80"],
  D: ["00 08", "08 76", "76 20", "20 00"],
  E: ["80 00", "08 88", "04 64", "00 08"],
  F: ["00 08", "08 88", "04 64"],
  G: ["80 20", "20 02", "02 08", "08 80", "40 44"],
  H: ["00 08", "80 88", "04 84"],
  I: ["00 80", "40 48", "08 88"],
  J: ["80 88", "84 82", "82 20"],
  K: ["00 08", "08 40", "40 88", "40 00"],
  L: ["08 00", "00 80"],
  M: ["00 08", "08 44", "44 88", "88 80"],
  N: ["00 08", "08 80", "80 88"],
  O: ["20 02", "02 08", "08 86", "86 20"],
  P: ["00 08", "08 86", "86 44", "44 04"],
  Q: ["20 02", "02 08", "08 86", "86 20", "42 80"],
  R: ["00 08", "08 86", "86 44", "44 04", "44 80"],
  S: ["80 20", "20 02", "02 64", "64 86", "86 08"],
  T: ["08 88", "48 40"],
  U: ["08 02", "02 20", "20 88"],
  V: ["08 40", "40 88"],
  W: ["08 20", "20 44", "44 68", "68 88"],
  X: ["08 80", "00 88"],
  Y: ["08 44", "88 44", "44 40"],
  Z: ["08 88", "88 00", "00 80"],
  "0": ["20 02", "02 08", "08 86", "86 20", "08 80"],
  "1": ["24 48", "48 40", "20 80"],
  "2": ["08 86", "86 44", "44 00", "00 80"],
  "3": ["08 88", "88 44", "44 80", "44 00"],
  "4": ["08 04", "04 84", "88 80"],
  "5": ["88 08", "08 04", "04 82", "82 20"],
  "6": ["80 20", "20 02", "02 08", "08 64", "64 82"],
  "7": ["08 88", "88 40"],
  "8": ["20 02", "02 08", "08 86", "86 20", "04 84"],
  "9": ["80 88", "88 86", "86 64", "64 20"],
  "-": ["04 84"],
  ".": ["30 30"],
};

const compiledGlyphs: Record<string, GlyphSegment[]> = Object.fromEntries(
  Object.entries(glyphs).map(([char, segments]) => [
    char,
    segments.map((segment) => {
      const a = segment.charCodeAt(0) - 48;
      const b = segment.charCodeAt(1) - 48;
      const c = segment.charCodeAt(3) - 48;
      const d = segment.charCodeAt(4) - 48;
      return [a, b, c, d] as const;
    }),
  ]),
) as Record<string, GlyphSegment[]>;

export function drawText(program: VectorProgram, text: string, x: number, y: number, size: number, intensity = 0.75) {
  let cursor = x;
  const scale = size / 8;
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const raw = upper[i];
    if (raw === " ") {
      cursor += size * 0.75;
      continue;
    }
    const glyph = compiledGlyphs[raw];
    if (!glyph) {
      cursor += size * 0.72;
      continue;
    }
    for (const [x1, y1, x2, y2] of glyph) {
      const ax = x1 * scale + cursor;
      const ay = y1 * scale + y;
      const bx = x2 * scale + cursor;
      const by = y2 * scale + y;
      program.moveTo(ax, ay).lineTo(bx, by, intensity);
    }
    cursor += size * 0.72;
  }
}
