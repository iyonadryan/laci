/**
 * ISO 8601 date and time with a mandatory offset (RFC 3339), e.g. `2026-11-01T09:00:00+07:00`
 * or `2026-11-01T02:00:00Z`. The same rule as `"format": "date-time"`.
 */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * The moment `text` stands for, in Unix milliseconds, or `null` when it is not an ISO 8601 date
 * and time with an offset. Text without an offset (`2026-11-01T09:00:00`) or without a time
 * (`2026-11-01`) is rejected on purpose: its moment would depend on the server's time zone.
 */
export function parseInstant(text: string): number | null {
  const match = INSTANT.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  // Date.parse rolls invalid dates over (Feb 30 -> Mar 2); reject those.
  const offset = (match[8] as string).toUpperCase();
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset.startsWith('-') ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(time + offsetMinutes * 60_000);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return null;
  }
  return time;
}
