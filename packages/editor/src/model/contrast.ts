const HEX = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i;

/** `#RGB` or `#RRGGBB` as `[r, g, b]` (0–255), or `null`. */
export function parseHex(color: string): [number, number, number] | null {
  const match = HEX.exec(color.trim());
  if (!match) return null;
  const hex = match[1]
    ? Array.from(match[1], (digit) => digit + digit).join('')
    : (match[2] as string);
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Relative luminance (WCAG 2). */
function luminance([r, g, b]: [number, number, number]): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio of two colors, 1–21; `null` when one is not a hex color. */
export function contrastRatio(foreground: string, background: string): number | null {
  const a = parseHex(foreground);
  const b = parseHex(background);
  if (!a || !b) return null;
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Normal text needs 4.5:1 (WCAG AA). */
export const MIN_CONTRAST = 4.5;
