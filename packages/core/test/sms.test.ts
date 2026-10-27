import { describe, expect, it } from 'vitest';
import { countSmsSegments } from '../src';

describe('countSmsSegments', () => {
  it('counts an empty text as no SMS', () => {
    expect(countSmsSegments('')).toEqual({
      encoding: 'GSM-7',
      characters: 0,
      units: 0,
      segments: 0,
      perSegment: 160,
      remaining: 160,
      nonGsmCharacters: [],
    });
  });

  it('fits 160 GSM-7 characters in one SMS and 153 per part after that', () => {
    expect(countSmsSegments('a'.repeat(160))).toMatchObject({ segments: 1, remaining: 0 });
    expect(countSmsSegments('a'.repeat(161))).toMatchObject({
      units: 161,
      segments: 2,
      perSegment: 153,
      remaining: 145,
    });
    expect(countSmsSegments('a'.repeat(153 * 3))).toMatchObject({ segments: 3, remaining: 0 });
  });

  it('knows the whole GSM-7 alphabet, and counts the extension characters twice', () => {
    const basic =
      '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
      '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
    expect(countSmsSegments(basic)).toMatchObject({ encoding: 'GSM-7', units: basic.length });
    expect(countSmsSegments('\f^{}\\[~]|€')).toMatchObject({
      encoding: 'GSM-7',
      characters: 10,
      units: 20,
    });
    expect(countSmsSegments('€'.repeat(80))).toMatchObject({ units: 160, segments: 1 });
    // 76 pairs fill a part (152 of 153): a pair is never split.
    expect(countSmsSegments('€'.repeat(81))).toMatchObject({
      units: 162,
      segments: 2,
      remaining: 143,
    });
  });

  it('switches to UCS-2 for any other character: 70, then 67 per part', () => {
    expect(countSmsSegments('Halo 😀')).toEqual({
      encoding: 'UCS-2',
      characters: 6,
      units: 7,
      segments: 1,
      perSegment: 70,
      remaining: 63,
      nonGsmCharacters: ['😀'],
    });
    expect(countSmsSegments('ă'.repeat(70))).toMatchObject({ segments: 1, remaining: 0 });
    expect(countSmsSegments('ă'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
    expect(countSmsSegments('“quoted” ăă').nonGsmCharacters).toEqual(['“', '”', 'ă']);
  });

  it('never splits an emoji across parts', () => {
    // 66 + 2 would overflow the first part (67), so the emoji starts the second.
    expect(countSmsSegments(`${'a'.repeat(66)}😀${'a'.repeat(10)}`)).toMatchObject({
      units: 78,
      segments: 2,
      remaining: 55,
    });
  });
});
