/** How an SMS is encoded: GSM-7 when every character is in the GSM 03.38 alphabet, else UCS-2. */
export type SmsEncoding = 'GSM-7' | 'UCS-2';

/** What {@link countSmsSegments} returns. */
export interface SmsSegments {
  encoding: SmsEncoding;
  /** Characters as people count them (an emoji is one). */
  characters: number;
  /**
   * What the limits count: septets for GSM-7, where `^ { } [ ] ~ \ | €` and form feed take two,
   * or UTF-16 code units for UCS-2, where an emoji takes two.
   */
  units: number;
  /** SMS messages the text is sent as; `0` for an empty text. */
  segments: number;
  /** Units per segment: 160 / 70 for a single SMS, 153 / 67 per part of a longer one. */
  perSegment: number;
  /** Units left in the last segment before another one is needed. */
  remaining: number;
  /** Characters outside GSM-7 that make the text UCS-2, each listed once. */
  nonGsmCharacters: string[];
}

const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
/** Sent as an escape plus a character, so they count twice. */
const GSM_EXTENSION = new Set('\f^{}\\[~]|€');

const LIMITS: Record<SmsEncoding, { single: number; part: number }> = {
  'GSM-7': { single: 160, part: 153 },
  'UCS-2': { single: 70, part: 67 },
};

/**
 * Counts the characters and SMS segments of `text`. GSM-7 fits 160 characters in one SMS and
 * 153 per part of a longer message; any character outside GSM-7 (an emoji, curly quotes) makes
 * the whole text UCS-2, which fits 70 and 67. A two-unit character is never split across parts.
 * National language shift tables are not used.
 */
export function countSmsSegments(text: string): SmsSegments {
  const characters = Array.from(text);
  const nonGsm = new Set<string>();
  for (const character of characters) {
    if (!GSM_BASIC.has(character) && !GSM_EXTENSION.has(character)) nonGsm.add(character);
  }
  const encoding: SmsEncoding = nonGsm.size === 0 ? 'GSM-7' : 'UCS-2';
  const weights = characters.map((character) =>
    encoding === 'GSM-7' ? (GSM_EXTENSION.has(character) ? 2 : 1) : character.length,
  );
  const units = weights.reduce((sum, weight) => sum + weight, 0);
  const { single, part } = LIMITS[encoding];

  let segments: number;
  let used: number;
  if (units <= single) {
    segments = units === 0 ? 0 : 1;
    used = units;
  } else {
    segments = 1;
    used = 0;
    for (const weight of weights) {
      if (used + weight > part) {
        segments++;
        used = 0;
      }
      used += weight;
    }
  }
  const perSegment = segments > 1 ? part : single;
  return {
    encoding,
    characters: characters.length,
    units,
    segments,
    perSegment,
    remaining: perSegment - used,
    nonGsmCharacters: [...nonGsm],
  };
}
