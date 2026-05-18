// Guardrail de contraste — PURO, sin red ni DOM (ADR-0005 §8).
//
// La landing deriva `--accent-strong` a mano en CSS (`globals.css`), no como
// función TS reutilizable; importar de `features/landing` está prohibido por
// el paradigma. Acá vive la versión pura, reusable por la saga (S5b), el
// wizard (S8) y la propuesta del LLM (S10). Mismo umbral que la landing:
// WCAG 2.x AA para texto normal = 4.5:1.
//
// Contrato del guardrail: deriva una variante que cumpla y AVISA qué ajustó;
// nunca bloquea el guardado ni aplica un par inaccesible en silencio. `bg`
// jamás se toca (es el lienzo elegido por el owner); se ajusta el color de
// texto (`ink`) y se deriva `accentStrong` (acento usado como texto).

export const WCAG_AA_NORMAL = 4.5;

export type Palette = { accent: string; bg: string; ink: string };

export type ContrastAdjustment = {
  token: "ink" | "accentStrong";
  from: string;
  to: string;
  ratioBefore: number;
  ratioAfter: number;
};

export type GuardrailResult = {
  /** Tokens que se PERSISTEN (los 3 del owner; `ink` posiblemente ajustado). */
  palette: Palette;
  /** Derivado en render (NO se persiste, ADR-0005 §7): acento para textos. */
  accentStrong: string;
  /** Qué se ajustó, para avisarle al owner (ADR-0005 §8). */
  adjustments: ContrastAdjustment[];
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normaliza a `#rrggbb` lowercase (expande la forma de 3 dígitos). */
export function normalizeHex(hex: string): string {
  const m = hex.trim().toLowerCase();
  if (!HEX.test(m)) throw new Error(`hex inválido: ${hex}`);
  const body = m.slice(1);
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return `#${full}`;
}

function channelLin(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (
    0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b)
  );
}

/** Razón de contraste WCAG (1..21), simétrica. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= WCAG_AA_NORMAL;
}

function toRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Mezcla `fg` hacia `target` en fracción `t` (0 = fg, 1 = target). */
function blend(
  fg: [number, number, number],
  target: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    fg[0] + (target[0] - fg[0]) * t,
    fg[1] + (target[1] - fg[1]) * t,
    fg[2] + (target[2] - fg[2]) * t,
  ];
}

/**
 * Empuja `fg` hacia el extremo (#000 o #fff) que más contrasta con `bg`,
 * lo mínimo necesario para alcanzar AA. Si ni el extremo llega (par
 * patológico, p.ej. bg gris medio), devuelve el extremo: mejor esfuerzo,
 * nunca lanza (ADR-0005 §8: el guardrail no bloquea).
 */
function deriveToContrast(fg: string, bg: string): string {
  if (meetsAA(fg, bg)) return normalizeHex(fg);
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  const target =
    contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg)
      ? black
      : white;
  const fgRgb = toRgb(fg);
  for (let i = 1; i <= 64; i++) {
    const candidate = toHex(blend(fgRgb, target, i / 64));
    if (meetsAA(candidate, bg)) return candidate;
  }
  return toHex(target);
}

/** Aplica el guardrail de contraste a la paleta del owner (ADR-0005 §8). */
export function applyContrastGuardrail(input: Palette): GuardrailResult {
  const accent = normalizeHex(input.accent);
  const bg = normalizeHex(input.bg);
  const inkIn = normalizeHex(input.ink);
  const adjustments: ContrastAdjustment[] = [];

  // 1. Texto principal (ink) sobre el lienzo (bg). Se ajusta ink, no bg.
  let ink = inkIn;
  if (!meetsAA(inkIn, bg)) {
    const before = contrastRatio(inkIn, bg);
    ink = deriveToContrast(inkIn, bg);
    adjustments.push({
      token: "ink",
      from: inkIn,
      to: ink,
      ratioBefore: before,
      ratioAfter: contrastRatio(ink, bg),
    });
  }

  // 2. Acento usado como texto: se deriva accentStrong (no se persiste).
  const accentStrong = deriveToContrast(accent, bg);
  if (accentStrong !== accent) {
    adjustments.push({
      token: "accentStrong",
      from: accent,
      to: accentStrong,
      ratioBefore: contrastRatio(accent, bg),
      ratioAfter: contrastRatio(accentStrong, bg),
    });
  }

  return { palette: { accent, bg, ink }, accentStrong, adjustments };
}
