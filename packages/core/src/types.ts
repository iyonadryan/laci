/** A JSON primitive. */
export type JsonPrimitive = string | number | boolean | null;

/** Any value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** A JSON Schema (draft-07 / 2019-09 keywords supported by Ajv), plus Laci's own keywords. */
export type JsonSchema = JsonObject;

export const ENTRY_KINDS = ['CONFIG', 'EMAIL_TEMPLATE', 'MESSAGE_TEMPLATE'] as const;
/** What an entry holds: a config value, an email template, or a message template. */
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_STATUSES = ['DRAFT', 'PUBLISHED', 'DISABLED'] as const;
/**
 * - `DRAFT`: not live yet; only the editor and previews see it.
 * - `PUBLISHED`: read by `get`, `find`, `renderEmail`, and `renderMessage`.
 * - `DISABLED`: switched off; reads behave as if the entry did not exist.
 */
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const MESSAGE_CHANNELS = ['WHATSAPP', 'SMS', 'PUSH', 'IN_APP'] as const;
/** Channel of a message template. */
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * What identifies one entry. `(key, environment, locale, channel)` is unique.
 *
 * - `locale` is `null` for configs and set for templates.
 * - `channel` is `null` except for message templates.
 */
export interface EntryAddress {
  key: string;
  /** Data environment, e.g. `"production"` or `"staging"`. Not `NODE_ENV`. */
  environment: string;
  locale: string | null;
  channel: MessageChannel | null;
}

/** One stored entry. */
export interface Entry extends EntryAddress {
  id: string;
  kind: EntryKind;
  description: string | null;
  /** Shape of `value` (configs) or of the variables a template uses (templates). */
  schema: JsonSchema;
  value: JsonValue;
  status: EntryStatus;
  /** Starts at 1 and goes up by one with every change. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One version of an entry, as recorded in its append-only history. */
export interface EntryHistory {
  id: string;
  entryId: string;
  version: number;
  value: JsonValue;
  schema: JsonSchema;
  status: EntryStatus;
  changedBy: string | null;
  changedAt: Date;
  /** Why it changed, e.g. "Add customer Toko Sinar" or "Rolled back to version 3". */
  note: string | null;
}
