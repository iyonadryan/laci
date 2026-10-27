import { useState } from 'react';
import type { ReactNode } from 'react';
import type { EntryStatus, JsonSchema, JsonValue } from '@lacijs/core';
import type { ApiEntry, Validation } from '../api';
import { errorText, isConflict, relativeTime, useDebounced, useEditor, useLoad } from '../context';
import { diffValues } from '../model/diff';
import { isObject, pretty } from '../model/json';
import { sampleData } from '../model/schema';
import { PromoteDialog, ReviewDialog, selectorOf } from './Review';
import type { Draft } from './Review';
import { Icon, Notice, StatusBadge } from './ui';

/** The top of a page: where you are, the environment picker, and the page's actions. */
export function PageHeader(props: {
  crumb: string;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  onEnvironment: (environment: string) => void;
}) {
  const { messages, session, environment } = useEditor();
  const production = environment === 'production';
  return (
    <header className={production ? 'laci-header laci-header-production' : 'laci-header'}>
      <div className="laci-header-row">
        <div className="laci-header-title">
          <span className="laci-muted laci-small">{props.crumb}</span>
          <h1>{props.title}</h1>
        </div>
        {session.label ? (
          <span className={`laci-pill${/prod/i.test(session.label) ? ' laci-pill-error' : ''}`}>
            {messages.database(session.label)}
          </span>
        ) : null}
        <label className="laci-row laci-env">
          {messages.environment}
          <select
            className={
              production
                ? 'laci-input laci-input-narrow laci-env-production'
                : 'laci-input laci-input-narrow'
            }
            value={environment}
            onChange={(event) => {
              props.onEnvironment(event.target.value);
            }}
          >
            {session.environments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {props.actions}
      </div>
      {production ? (
        <div className="laci-production-banner" role="status">
          <Icon name="warning" size={16} /> {messages.productionWarning}
        </div>
      ) : null}
      {props.children}
    </header>
  );
}

/** Entries to pick from, with search and optional filter chips. */
export function EntryList(props: {
  entries: readonly ApiEntry[];
  selected: string | undefined;
  onSelect: (entry: ApiEntry) => void;
  searchLabel: string;
  filters?: readonly string[];
  filterOf?: (entry: ApiEntry) => string;
  tag?: (entry: ApiEntry) => ReactNode;
  loading?: boolean;
  error?: string | null;
}) {
  const { messages } = useEditor();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const text = search.trim().toLowerCase();
  const shown = props.entries.filter(
    (entry) =>
      (text === '' ||
        entry.key.toLowerCase().includes(text) ||
        (entry.description ?? '').toLowerCase().includes(text)) &&
      (filter === null || props.filterOf?.(entry) === filter),
  );
  return (
    <section className="laci-list-pane" aria-label={props.searchLabel}>
      <label className="laci-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          aria-label={props.searchLabel}
          placeholder={props.searchLabel}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </label>
      {props.filters && props.filters.length > 0 ? (
        <div className="laci-chips-row">
          {[null, ...props.filters].map((name) => (
            <button
              key={name ?? ''}
              type="button"
              aria-pressed={filter === name}
              className={filter === name ? 'laci-filter laci-filter-on' : 'laci-filter'}
              onClick={() => {
                setFilter(name);
              }}
            >
              {name ?? messages.all}
            </button>
          ))}
        </div>
      ) : null}
      {props.error ? <Notice tone="error">{messages.loadFailed(props.error)}</Notice> : null}
      {props.loading && props.entries.length === 0 ? (
        <span className="laci-muted">{messages.loading}</span>
      ) : null}
      {!props.loading && shown.length === 0 && !props.error ? (
        <span className="laci-muted">{messages.noEntries}</span>
      ) : null}
      <ul className="laci-entries">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              aria-current={entry.key === props.selected ? 'true' : undefined}
              className={entry.key === props.selected ? 'laci-entry laci-entry-on' : 'laci-entry'}
              onClick={() => {
                props.onSelect(entry);
              }}
            >
              <span className="laci-row">
                <span className="laci-mono laci-entry-key">{entry.key}</span>
                {props.tag ? props.tag(entry) : <StatusBadge status={entry.status} />}
              </span>
              {entry.description ? (
                <span className="laci-muted laci-small">{entry.description}</span>
              ) : null}
              <span className="laci-muted laci-small">
                {messages.versionMeta(
                  entry.version,
                  relativeTime(entry.updatedAt),
                  entry.updatedBy,
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Key, status, version, and the actions on a saved entry. */
export function EntryHeader(props: {
  entry: ApiEntry;
  /** Called after a status change or a promotion. */
  onChanged: (entry: ApiEntry | null) => void;
  children?: ReactNode;
  dirty: boolean;
}) {
  const { api, messages, notify } = useEditor();
  const { entry } = props;
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStatus = async (status: EntryStatus) => {
    setError(null);
    try {
      const saved = await api.update(entry.key, selectorOf(entry), {
        status,
        expectedVersion: entry.version,
      });
      notify(messages.saved(saved.version));
      props.onChanged(saved);
    } catch (caught) {
      setError(isConflict(caught) ? messages.conflict : errorText(caught));
    }
  };
  const statusAction: [EntryStatus, string] | null =
    entry.status === 'DRAFT'
      ? ['PUBLISHED', messages.publish]
      : entry.status === 'PUBLISHED'
        ? ['DISABLED', messages.disable]
        : ['PUBLISHED', messages.enable];
  return (
    <div className="laci-entry-header">
      <div className="laci-row laci-wrap">
        <h2 className="laci-mono">{entry.key}</h2>
        <StatusBadge status={entry.status} />
        {props.children}
        <span className="laci-muted laci-small">
          {messages.versionMeta(entry.version, relativeTime(entry.updatedAt), entry.updatedBy)}
        </span>
        <span className="laci-spacer" />
        <button
          type="button"
          className="laci-button laci-button-small"
          onClick={() => {
            // Missing outside secure contexts.
            void (navigator.clipboard as Clipboard | undefined)?.writeText(entry.key);
            notify(messages.copied);
          }}
        >
          {messages.copyKey}
        </button>
        <button
          type="button"
          className="laci-button laci-button-small"
          disabled={props.dirty}
          onClick={() => void setStatus(statusAction[0])}
        >
          {statusAction[1]}
        </button>
        <button
          type="button"
          className="laci-button laci-button-small"
          disabled={props.dirty}
          onClick={() => {
            setPromoting(true);
          }}
        >
          {messages.promote}
        </button>
      </div>
      {entry.description ? <p className="laci-muted">{entry.description}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {promoting ? (
        <PromoteDialog
          entry={entry}
          onClose={() => {
            setPromoting(false);
          }}
          onDone={() => {
            setPromoting(false);
            props.onChanged(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The editable copy of an entry, validated by the server as it changes. */
export function useDraft(entry: ApiEntry) {
  const { api } = useEditor();
  const [value, setValue] = useState<JsonValue>(entry.value);
  const [schema, setSchema] = useState<JsonSchema>(entry.schema);
  const [description, setDescription] = useState<string | null>(entry.description);
  const changes =
    diffValues(entry.value, value).length +
    diffValues(entry.schema, schema).length +
    (description === entry.description ? 0 : 1);
  const content = useDebounced(JSON.stringify([value, schema]), 300);
  const validation = useLoad<Validation>(() => {
    const [currentValue, currentSchema] = JSON.parse(content) as [JsonValue, JsonSchema];
    return api.validate({
      kind: entry.kind,
      channel: entry.channel,
      schema: currentSchema,
      value: currentValue,
      previous: entry.value,
    });
  }, [entry.id, content]);
  const result = validation.data;
  const valueIssues = result?.target === 'value' ? result.issues : [];
  const schemaIssues = result?.target === 'schema' ? result.issues : [];
  return {
    value,
    setValue,
    schema,
    setSchema,
    description,
    setDescription,
    changes,
    validation: result,
    valueIssues,
    schemaIssues,
    errorCount: result?.issues.length ?? 0,
    reset: () => {
      setValue(entry.value);
      setSchema(entry.schema);
      setDescription(entry.description);
    },
    draft: (): Draft => ({ value, schema, description }),
  };
}

export type EntryDraft = ReturnType<typeof useDraft>;

/** The bar at the bottom of an editor: what is unsaved, Discard, and Review. */
export function SaveBar(props: {
  entry: ApiEntry;
  draft: EntryDraft;
  onSaved: (entry: ApiEntry) => void;
  children?: ReactNode;
}) {
  const { messages } = useEditor();
  const { draft, entry } = props;
  const [reviewing, setReviewing] = useState(false);
  const dirty = draft.changes > 0;
  return (
    <div className="laci-savebar">
      <span className={dirty ? 'laci-dot laci-dot-warn' : 'laci-dot'} aria-hidden="true" />
      <span className="laci-spacer">
        {dirty ? messages.unsavedChanges(draft.changes) : messages.noChanges}
        {draft.errorCount > 0 ? ` · ${messages.validationErrors(draft.errorCount)}` : ''}
      </span>
      {props.children}
      <button type="button" className="laci-button" disabled={!dirty} onClick={draft.reset}>
        {messages.discard}
      </button>
      <button
        type="button"
        className="laci-button laci-button-primary"
        disabled={!dirty}
        onClick={() => {
          setReviewing(true);
        }}
      >
        {entry.status === 'DRAFT' ? messages.reviewAndPublish : messages.reviewAndSave}
      </button>
      {reviewing ? (
        <ReviewDialog
          entry={entry}
          draft={draft.draft()}
          onClose={() => {
            setReviewing(false);
          }}
          onSaved={(saved) => {
            setReviewing(false);
            props.onSaved(saved);
          }}
        />
      ) : null}
    </div>
  );
}

/** The sample data sets of a template: its schema's `examples`, then one made from the schema. */
export function samplesOf(schema: JsonSchema): JsonValue[] {
  const examples = Array.isArray(schema.examples) ? schema.examples.filter(isObject) : [];
  return [...examples, sampleData(schema)];
}

/** Picks and edits the data a preview renders with. */
export function SamplePicker(props: {
  schema: JsonSchema;
  data: JsonValue;
  onData: (data: JsonValue) => void;
  onSaveExample: (data: JsonValue) => void;
}) {
  const { messages } = useEditor();
  const samples = samplesOf(props.schema);
  const examples = samples.length - 1;
  const [choice, setChoice] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => pretty(props.data));
  const [error, setError] = useState<string | null>(null);
  const pick = (index: number) => {
    const sample = samples[index] as JsonValue;
    setChoice(index);
    setText(pretty(sample));
    setError(null);
    props.onData(sample);
  };
  return (
    <div className="laci-samples">
      <label className="laci-row">
        <span className="laci-small laci-muted">{messages.sampleData}</span>
        <select
          className="laci-input laci-input-narrow"
          value={String(choice)}
          onChange={(event) => {
            pick(Number(event.target.value));
          }}
        >
          {samples.map((_, index) => (
            <option key={index} value={String(index)}>
              {index < examples ? messages.sampleExample(index + 1) : messages.sampleGenerated}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="laci-link-button"
        aria-expanded={editing}
        onClick={() => {
          setEditing(!editing);
        }}
      >
        {messages.editSample}
      </button>
      {editing ? (
        <div className="laci-field">
          <textarea
            aria-label={messages.editSample}
            className="laci-input laci-textarea laci-mono"
            rows={8}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              try {
                props.onData(JSON.parse(event.target.value) as JsonValue);
                setError(null);
              } catch (caught) {
                setError(messages.invalidJson((caught as Error).message));
              }
            }}
          />
          {error ? <p className="laci-error">{error}</p> : null}
          <button
            type="button"
            className="laci-button laci-button-small"
            disabled={error !== null}
            onClick={() => {
              props.onSaveExample(props.data);
            }}
          >
            {messages.saveSample}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A schema with `data` added to its examples. */
export function withExample(schema: JsonSchema, data: JsonValue): JsonSchema {
  const examples = Array.isArray(schema.examples) ? schema.examples : [];
  return { ...schema, examples: [...examples, data] };
}

/** Code that reads the entry from the app. */
export function usageCode(entry: ApiEntry): string {
  const key = JSON.stringify(entry.key).replace(/"/g, "'");
  const environment =
    entry.environment === 'production' ? '' : `, { environment: '${entry.environment}' }`;
  if (entry.kind === 'CONFIG') {
    return `const value = await laci.get(${key}${environment});`;
  }
  const options = [
    entry.channel ? `channel: '${entry.channel}'` : null,
    entry.locale ? `locale: '${entry.locale}'` : null,
    entry.environment === 'production' ? null : `environment: '${entry.environment}'`,
  ].filter(Boolean);
  const method = entry.kind === 'EMAIL_TEMPLATE' ? 'renderEmail' : 'renderMessage';
  return `const rendered = await laci.${method}(${key}, data, { ${options.join(', ')} });`;
}
