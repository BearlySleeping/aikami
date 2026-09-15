// packages/frontend/theme/src/lib/theme/theme_color.ts
//
// C-529 — the trusted color serializer.
//
// A theme never contributes a CSS string. It contributes a *typed* color value
// that this module parses into numbers, re-serializes canonically, and can also
// evaluate for WCAG relative luminance so the validator can report a contrast
// failure before anything renders.
//
// 🔴 This is the only place in the theme pipeline that turns a value into text
// destined for a stylesheet. Anything this module cannot parse is rejected —
// there is no pass-through path for `var()`, `url()`, `calc()` or an arbitrary
// identifier.

/** Parsed color: sRGB channels in 0..1 plus an alpha channel. */
export type RgbaColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

/** Channel tolerance for round-tripping a parsed color. */
const EPSILON = 1e-4;

/** Clamp a value into 0..1. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** sRGB transfer function (linear → encoded). */
const encodeSrgb = (value: number): number => {
  const magnitude = Math.abs(value);
  const encoded =
    magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return Math.sign(value) * encoded;
};

/** sRGB transfer function (encoded → linear). */
const decodeSrgb = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

/** Parses a `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` literal. */
const parseHex = (raw: string): RgbaColor | undefined => {
  const hex = raw.slice(1);
  const expand = (chunk: string): number => Number.parseInt(chunk + chunk, 16) / 255;
  if (hex.length === 3 || hex.length === 4) {
    if (!/^[0-9a-f]{3,4}$/i.test(hex)) {
      return undefined;
    }
    const [r, g, b, a] = [hex[0], hex[1], hex[2], hex[3] ?? 'f'].map(expand);
    return r === undefined || g === undefined || b === undefined || a === undefined
      ? undefined
      : { r, g, b, a };
  }
  if (hex.length === 6 || hex.length === 8) {
    if (!/^[0-9a-f]{6,8}$/i.test(hex)) {
      return undefined;
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16) / 255,
      g: Number.parseInt(hex.slice(2, 4), 16) / 255,
      b: Number.parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return undefined;
};

/** Splits a functional-notation body into numeric arguments and an optional alpha. */
const parseFunctionArguments = (
  body: string,
): { readonly parts: readonly string[]; readonly alpha: number | undefined } | undefined => {
  // `rgb(1 2 3 / 50%)` and `rgb(1, 2, 3, 0.5)` are both valid CSS. Only digits,
  // separators and percent signs survive this filter.
  if (!/^[0-9.,%/\s+-]*$/.test(body)) {
    return undefined;
  }
  const slashSegments = body.split('/');
  if (slashSegments.length > 2) {
    return undefined;
  }
  const [head, tail] = slashSegments;
  if (head === undefined) {
    return undefined;
  }
  let parts = head
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (tail !== undefined && !/^\s*[0-9.]+%?\s*$/.test(tail)) {
    return undefined;
  }
  const positionalAlpha =
    tail === undefined && body.includes(',') && parts.length === 4 ? parts.at(-1) : undefined;
  if (positionalAlpha !== undefined) {
    parts = parts.slice(0, 3);
  }
  const alphaRaw = tail?.trim() ?? positionalAlpha;
  const alpha = alphaRaw === undefined ? undefined : parseAlpha(alphaRaw);
  if (alphaRaw !== undefined && alpha === undefined) {
    return undefined;
  }
  return { parts, alpha };
};

/** Parses an alpha token (`0.5` or `50%`). */
const parseAlpha = (raw: string): number | undefined => {
  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw.slice(0, -1));
    return Number.isFinite(percent) ? clamp01(percent / 100) : undefined;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? clamp01(value) : undefined;
};

/** Parses one rgb()/rgba() channel (`128` or `50%`). */
const parseChannel = (raw: string): number | undefined => {
  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw.slice(0, -1));
    return Number.isFinite(percent) ? clamp01(percent / 100) : undefined;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? clamp01(value / 255) : undefined;
};

/** Parses `rgb()` / `rgba()`. */
const parseRgbFunction = (body: string): RgbaColor | undefined => {
  const parsed = parseFunctionArguments(body);
  if (parsed === undefined || parsed.parts.length !== 3) {
    return undefined;
  }
  const [r, g, b] = parsed.parts.map(parseChannel);
  if (r === undefined || g === undefined || b === undefined) {
    return undefined;
  }
  return { r, g, b, a: parsed.alpha ?? 1 };
};

/** RGB channel triple for one HSL hue sector. */
type HueSector = readonly [number, number, number];

/**
 * Picks the HSL hue sector.
 *
 * Written as a lookup rather than a chain of ternaries so each sector is a
 * single readable row.
 */
const hueSector = (h: number, c: number, x: number): HueSector => {
  if (h < 1) {
    return [c, x, 0];
  }
  if (h < 2) {
    return [x, c, 0];
  }
  if (h < 3) {
    return [0, c, x];
  }
  if (h < 4) {
    return [0, x, c];
  }
  if (h < 5) {
    return [x, 0, c];
  }
  return [c, 0, x];
};

/** Parses `hsl()` / `hsla()`. */
const parseHslFunction = (body: string): RgbaColor | undefined => {
  const parsed = parseFunctionArguments(body);
  if (parsed === undefined || parsed.parts.length !== 3) {
    return undefined;
  }
  const [hueRaw, satRaw, lightRaw] = parsed.parts;
  if (hueRaw === undefined || satRaw === undefined || lightRaw === undefined) {
    return undefined;
  }
  const hue = Number.parseFloat(hueRaw.replace(/deg$/i, ''));
  const saturation = Number.parseFloat(satRaw.replace(/%$/, ''));
  const lightness = Number.parseFloat(lightRaw.replace(/%$/, ''));
  if (![hue, saturation, lightness].every(Number.isFinite)) {
    return undefined;
  }
  const s = clamp01(saturation / 100);
  const l = clamp01(lightness / 100);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] = hueSector(h, c, x);
  const m = l - c / 2;
  return { r: clamp01(r1 + m), g: clamp01(g1 + m), b: clamp01(b1 + m), a: parsed.alpha ?? 1 };
};

/** Parses `oklch()` — the format the shipped palette is authored in. */
const parseOklchFunction = (body: string): RgbaColor | undefined => {
  const parsed = parseFunctionArguments(body);
  if (parsed === undefined || parsed.parts.length !== 3) {
    return undefined;
  }
  const [lightRaw, chromaRaw, hueRaw] = parsed.parts;
  if (lightRaw === undefined || chromaRaw === undefined || hueRaw === undefined) {
    return undefined;
  }
  const lightness =
    Number.parseFloat(lightRaw.replace(/%$/, '')) / (lightRaw.endsWith('%') ? 100 : 1);
  const chroma = Number.parseFloat(chromaRaw);
  const hue = Number.parseFloat(hueRaw.replace(/deg$/i, ''));
  if (![lightness, chroma, hue].every(Number.isFinite)) {
    return undefined;
  }
  return { ...oklchToRgba(lightness, chroma, hue), a: parsed.alpha ?? 1 };
};

/** Converts OKLCH to sRGB (clamped — out-of-gamut colors clamp per channel). */
const oklchToRgba = (lightness: number, chroma: number, hue: number): RgbaColor => {
  const hueRadians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const linearR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linearG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linearB = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: clamp01(encodeSrgb(linearR)),
    g: clamp01(encodeSrgb(linearG)),
    b: clamp01(encodeSrgb(linearB)),
    a: 1,
  };
};

/**
 * Parses a color literal into channels.
 *
 * Accepts exactly the forms the profile documents: hex, `rgb()`/`rgba()`,
 * `hsl()`/`hsla()` and `oklch()`. Everything else — `var()`, `url()`, `color()`,
 * `light-dark()`, named colors, expressions — returns `undefined` so the caller
 * rejects the theme instead of forwarding an unvalidated string to the browser.
 */
export const parseColor = (raw: string): RgbaColor | undefined => {
  const value = raw.trim();
  if (value.length === 0 || value.length > 160) {
    return undefined;
  }
  if (value.startsWith('#')) {
    return parseHex(value);
  }
  const match = /^([a-z]+)\(([\s\S]*)\)$/i.exec(value);
  if (match === null) {
    return undefined;
  }
  const [, name, body] = match;
  if (name === undefined || body === undefined) {
    return undefined;
  }
  switch (name.toLowerCase()) {
    case 'rgb':
    case 'rgba':
      return parseRgbFunction(body);
    case 'hsl':
    case 'hsla':
      return parseHslFunction(body);
    case 'oklch':
      return parseOklchFunction(body);
    default:
      return undefined;
  }
};

/** Re-serializes a parsed color. The only string a theme color becomes. */
export const serializeColor = (color: RgbaColor): string => {
  const channel = (value: number): string => {
    const rounded = Math.round(clamp01(value) * 255);
    return rounded.toString(16).padStart(2, '0');
  };
  const alpha = Math.round(clamp01(color.a) * 255);
  const base = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
  return alpha === 255 ? base : `${base}${channel(color.a)}`;
};

/** WCAG relative luminance of a color (alpha composited over its own channels). */
export const relativeLuminance = (color: RgbaColor): number =>
  0.2126 * decodeSrgb(clamp01(color.r)) +
  0.7152 * decodeSrgb(clamp01(color.g)) +
  0.0722 * decodeSrgb(clamp01(color.b));

/**
 * WCAG contrast ratio between two colors.
 *
 * An alpha channel is composited over the *other* color first, which is what
 * makes a translucent surface evaluate honestly instead of pretending it is
 * opaque.
 */
export const contrastRatio = (foreground: RgbaColor, background: RgbaColor): number => {
  const composited: RgbaColor = {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
  const lightest = Math.max(relativeLuminance(composited), relativeLuminance(background));
  const darkest = Math.min(relativeLuminance(composited), relativeLuminance(background));
  return (lightest + 0.05) / (darkest + 0.05);
};

/** Rounds a contrast ratio for stable diagnostics. */
export const roundContrast = (ratio: number): number => Math.round(ratio * 100) / 100;

/** True when two parsed colors are visually identical within tolerance. */
export const colorsEqual = (left: RgbaColor, right: RgbaColor): boolean =>
  Math.abs(left.r - right.r) < EPSILON &&
  Math.abs(left.g - right.g) < EPSILON &&
  Math.abs(left.b - right.b) < EPSILON &&
  Math.abs(left.a - right.a) < EPSILON;
