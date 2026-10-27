import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { EntryKind, MessageChannel } from '@lacijs/core';
import type { LaciApi, Session } from './api';
import { ApiError } from './api';
import type { Messages } from './messages';

/** Which page the editor shows. */
export type View =
  | { page: 'config'; key?: string }
  | { page: 'email'; key?: string; locale?: string }
  | { page: 'message'; channel: MessageChannel; key?: string; locale?: string }
  | { page: 'history' }
  | { page: 'new'; kind?: EntryKind; channel?: MessageChannel };

export interface EditorContextValue {
  api: LaciApi;
  messages: Messages;
  session: Session;
  /** The data environment shown on every page. */
  environment: string;
  navigate: (view: View) => void;
  /** Tells the sidebar that entries were created or changed. */
  changed: () => void;
  /** Shows a short notice. */
  notify: (text: string) => void;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error('Laci: editor components must be inside <LaciEditor>.');
  return value;
}

/** The message of an error, for people. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The result of an async load, run again when `deps` (strings, numbers, booleans) change. While
 * a new load runs, the previous `data` stays.
 */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly (string | number | boolean | null | undefined)[],
): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([...deps, tick]);
  const [state, setState] = useState<{
    key: string | null;
    data: T | undefined;
    error: string | null;
  }>({ key: null, data: undefined, error: null });
  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (active) setState({ key, data, error: null });
      },
      (error: unknown) => {
        if (active) setState({ key, data: undefined, error: errorText(error) });
      },
    );
    return () => {
      active = false;
    };
    // `load` is a new function on every render; `key` says when its result changes.
  }, [key]);
  const reload = useCallback(() => {
    setTick((value) => value + 1);
  }, []);
  const loading = state.key !== key;
  return { data: state.data, error: loading ? null : state.error, loading, reload };
}

/** `value`, once it has not changed for `delay` ms. */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
}

/** Whether `error` is a version conflict from the API. */
export const isConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409;

/** "2 h ago", "yesterday", …; relative to now. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}

/** `1234` as "1.2 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
