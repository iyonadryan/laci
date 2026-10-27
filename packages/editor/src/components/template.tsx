import { useRef, useState } from 'react';
import type { JsonSchema } from '@lacijs/core';
import type { ApiEntry } from '../api';
import { errorText, useEditor } from '../context';
import { variablesOf } from '../model/schema';
import { SchemaBuilder } from './SchemaBuilder';
import { Dialog, Notice } from './ui';

/** The entries of each key: one per locale (and channel). */
export function groupByKey(entries: readonly ApiEntry[], defaultLocale: string): ApiEntry[] {
  const groups = new Map<string, ApiEntry[]>();
  for (const entry of entries) groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry]);
  return [...groups.values()].map(
    (variants) =>
      variants.find((entry) => entry.locale === defaultLocale) ?? (variants[0] as ApiEntry),
  );
}

/** The locale to show: the requested one, else the default, else the first there is. */
export function pickLocale(
  variants: readonly ApiEntry[],
  requested: string | undefined,
  defaultLocale: string,
): string | undefined {
  const locales = variants.map((entry) => entry.locale as string);
  if (requested && locales.includes(requested)) return requested;
  if (locales.includes(defaultLocale)) return defaultLocale;
  return locales[0];
}

/** The locale select of a template, with "Add locale…" (a draft copy of the current one). */
export function LocalePicker(props: {
  entry: ApiEntry;
  locales: readonly string[];
  onLocale: (locale: string) => void;
  /** Called with a locale just added, before switching to it. */
  onAdded: () => void;
}) {
  const { api, messages, notify } = useEditor();
  const [adding, setAdding] = useState(false);
  const [locale, setLocale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    try {
      const { entry } = props;
      await api.create({
        key: entry.key,
        kind: entry.kind,
        environment: entry.environment,
        locale: locale.trim(),
        channel: entry.channel,
        schema: entry.schema,
        value: entry.value,
        ...(entry.description ? { description: entry.description } : {}),
        status: 'DRAFT',
      });
      notify(messages.created(`${entry.key} (${locale.trim()})`));
      setAdding(false);
      props.onAdded();
      props.onLocale(locale.trim());
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  return (
    <>
      <label className="laci-row">
        <span className="laci-small laci-muted">{messages.locale}</span>
        <select
          className="laci-input laci-input-narrow"
          value={props.entry.locale ?? ''}
          onChange={(event) => {
            if (event.target.value === '+') setAdding(true);
            else props.onLocale(event.target.value);
          }}
        >
          {props.locales.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value="+">{messages.addLocale}</option>
        </select>
      </label>
      {adding ? (
        <Dialog
          title={messages.addLocale}
          onClose={() => {
            setAdding(false);
          }}
          footer={
            <>
              <span className="laci-spacer" />
              <button
                type="button"
                className="laci-button laci-button-primary"
                disabled={locale.trim() === ''}
                onClick={() => void create()}
              >
                {messages.addLocaleCreate}
              </button>
            </>
          }
        >
          <label className="laci-field">
            <span className="laci-label">{messages.addLocalePrompt}</span>
            <input
              className="laci-input laci-mono"
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value);
              }}
            />
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </Dialog>
      ) : null}
    </>
  );
}

/** The variables a template declares, to insert them. */
export function VariablesPanel(props: {
  schema: JsonSchema;
  onInsert: (name: string) => void;
  onEditSchema: () => void;
}) {
  const { messages } = useEditor();
  const variables = variablesOf(props.schema);
  return (
    <div className="laci-panel laci-variables">
      <div className="laci-row">
        <h3 className="laci-spacer">{messages.variables}</h3>
        <button type="button" className="laci-link-button" onClick={props.onEditSchema}>
          {messages.editSchema}
        </button>
      </div>
      {variables.length === 0 ? <span className="laci-muted">{messages.noVariables}</span> : null}
      <ul className="laci-variable-list">
        {variables.map((variable) => (
          <li key={variable.name} className="laci-row">
            <button
              type="button"
              className="laci-chip laci-chip-button laci-mono"
              aria-label={`${messages.insertVariable}: ${variable.name}`}
              onClick={() => {
                props.onInsert(variable.name);
              }}
            >
              {variable.name}
            </button>
            <span className="laci-spacer laci-muted laci-small">{variable.type}</span>
            <span className={variable.required ? 'laci-pill laci-pill-error' : 'laci-pill'}>
              {variable.required ? messages.required : messages.optional}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Edits a template's variable schema. */
export function SchemaDialog(props: {
  schema: JsonSchema;
  rootLabel: string;
  onClose: () => void;
  onApply: (schema: JsonSchema) => void;
}) {
  const { messages } = useEditor();
  const [schema, setSchema] = useState(props.schema);
  return (
    <Dialog
      wide
      title={`${messages.editSchema} · ${props.rootLabel}`}
      onClose={props.onClose}
      footer={
        <>
          <span className="laci-spacer" />
          <button
            type="button"
            className="laci-button laci-button-primary"
            onClick={() => {
              props.onApply(schema);
            }}
          >
            {messages.applyJson}
          </button>
        </>
      }
    >
      <SchemaBuilder schema={schema} onChange={setSchema} rootLabel={props.rootLabel} template />
    </Dialog>
  );
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

/**
 * Remembers the template field that had focus last, to insert variables and snippets at its
 * cursor.
 */
export function useInserter(fields: readonly string[], set: (field: string, text: string) => void) {
  const elements = useRef(new Map<string, Editable>());
  const [last, setLast] = useState(fields[0] as string);
  return {
    last,
    bind: (field: string) => ({
      register: (element: Editable | null) => {
        if (element) elements.current.set(field, element);
        else elements.current.delete(field);
      },
      onFocus: () => {
        setLast(field);
      },
    }),
    /** Inserts `before` + selection + `after` at the cursor of `field` (default: the last one). */
    insert: (before: string, after = '', field = last) => {
      const element = elements.current.get(field);
      if (!element) return;
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      const selected = element.value.slice(start, end);
      set(
        field,
        element.value.slice(0, start) + before + selected + after + element.value.slice(end),
      );
    },
  };
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CHIP =
  'padding:1px 6px;border-radius:4px;background:#F5EDE8;color:#5E3A28;font-family:monospace;font-size:12px';
const TAG =
  'padding:1px 6px;border-radius:4px;background:#EDEDE8;color:#44474D;font-family:monospace;font-size:11px';

/** The HTML of a template with its `{{ }}` and `{% %}` shown as chips, for the Visual tab. */
export function visualHtml(source: string): string {
  return source.replace(
    /\{\{-?\s*([\s\S]*?)\s*-?\}\}|\{%-?\s*([\s\S]*?)\s*-?%\}/g,
    (_, output: string | undefined, tag: string | undefined) =>
      output !== undefined
        ? `<span style="${CHIP}">${escape(output)}</span>`
        : `<span style="${TAG}">${escape(tag ?? '')}</span>`,
  );
}

/** A template with each `{{ }}` numbered from `{{1}}`, as WhatsApp providers register it. */
export function numberedText(source: string): string {
  let count = 0;
  return source.replace(/\{\{-?[\s\S]*?-?\}\}/g, () => `{{${++count}}}`);
}
