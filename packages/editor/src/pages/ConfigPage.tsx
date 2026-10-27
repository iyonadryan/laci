import { useState } from 'react';
import type { JsonValue } from '@lacijs/core';
import type { ApiEntry } from '../api';
import {
  EntryHeader,
  EntryList,
  PageHeader,
  SaveBar,
  useDraft,
  usageCode,
} from '../components/entry';
import { HistoryTimeline } from '../components/Review';
import { SchemaBuilder } from '../components/SchemaBuilder';
import { Icon, Notice, Tabs } from '../components/ui';
import { useEditor, useLoad } from '../context';
import { SchemaForm } from '../form/SchemaForm';
import { pretty } from '../model/json';
import type { PathSegment } from '../model/json';
import { entryTypeLabel, typeLabel } from '../model/schema';

type Tab = 'form' | 'json' | 'schema' | 'history' | 'usage';

export function ConfigPage(props: {
  selected?: string;
  onEnvironment: (environment: string) => void;
}) {
  const { api, messages, environment, navigate, changed } = useEditor();
  const list = useLoad(() => api.list({ kind: 'CONFIG', environment, limit: 500 }), [environment]);
  const entry = useLoad(
    () =>
      props.selected
        ? api.entry(props.selected, { kind: 'CONFIG', environment })
        : Promise.resolve(null),
    [props.selected, environment],
  );
  const entries = list.data?.items ?? [];
  const types = [...new Set(entries.map((item) => entryTypeLabel(item.schema)))].sort();
  const refresh = () => {
    list.reload();
    entry.reload();
    changed();
  };
  const current = entry.data && entry.data.key === props.selected ? entry.data : null;
  return (
    <>
      <PageHeader
        crumb={`${messages.navContent} / ${messages.navConfig}`}
        title={messages.navConfig}
        onEnvironment={props.onEnvironment}
        actions={
          <button
            type="button"
            className="laci-button laci-button-primary"
            onClick={() => {
              navigate({ page: 'new', kind: 'CONFIG' });
            }}
          >
            <Icon name="plus" size={16} /> {messages.newConfig}
          </button>
        }
      />
      <div className="laci-body">
        <EntryList
          entries={entries}
          selected={props.selected}
          searchLabel={messages.searchConfigs}
          filters={types}
          filterOf={(item) => entryTypeLabel(item.schema)}
          loading={list.loading}
          error={list.error}
          tag={(item) => <span className="laci-pill">{entryTypeLabel(item.schema)}</span>}
          onSelect={(item) => {
            navigate({ page: 'config', key: item.key });
          }}
        />
        <section className="laci-panel laci-editor-pane" aria-label={messages.navConfig}>
          {current ? (
            <ConfigEditor
              key={`${current.id}:${current.version}`}
              entry={current}
              onSaved={refresh}
            />
          ) : entry.error ? (
            <Notice tone="error">{messages.loadFailed(entry.error)}</Notice>
          ) : (
            <p className="laci-muted laci-empty">
              {props.selected ? messages.loading : messages.selectEntry}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function ConfigEditor(props: { entry: ApiEntry; onSaved: () => void }) {
  const { messages } = useEditor();
  const { entry } = props;
  const draft = useDraft(entry);
  const [tab, setTab] = useState<Tab>('form');
  const [focus, setFocus] = useState<readonly PathSegment[]>([]);
  return (
    <>
      <EntryHeader entry={entry} dirty={draft.changes > 0} onChanged={props.onSaved}>
        <span className="laci-pill">{typeLabel(draft.schema)}</span>
      </EntryHeader>
      <Tabs
        label={entry.key}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'form', label: messages.tabForm },
          { id: 'json', label: messages.tabJson },
          { id: 'schema', label: messages.tabSchema },
          { id: 'history', label: messages.tabHistory },
          { id: 'usage', label: messages.tabUsage },
        ]}
      />
      <div className="laci-tab-body">
        {tab === 'form' ? (
          <>
            <nav className="laci-breadcrumb laci-mono" aria-label="Path">
              {[
                entry.key,
                ...focus.map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment)),
              ].map((part, index, parts) => (
                <span
                  key={index}
                  className={index === parts.length - 1 ? 'laci-crumb-current' : undefined}
                >
                  {index > 0 ? <span aria-hidden="true"> › </span> : null}
                  {part}
                </span>
              ))}
            </nav>
            <SchemaForm
              schema={draft.schema}
              value={draft.value}
              original={entry.value}
              issues={draft.valueIssues}
              messages={messages}
              onFocusPath={setFocus}
              onChange={(value) => {
                draft.setValue(value ?? null);
              }}
            />
          </>
        ) : null}
        {tab === 'json' ? (
          <JsonTab value={draft.value} onChange={draft.setValue} issues={draft.valueIssues} />
        ) : null}
        {tab === 'schema' ? (
          <>
            <label className="laci-field">
              <span className="laci-label">{messages.description}</span>
              <input
                className="laci-input"
                value={draft.description ?? ''}
                onChange={(event) => {
                  draft.setDescription(event.target.value === '' ? null : event.target.value);
                }}
              />
            </label>
            {draft.schemaIssues.length > 0 ? (
              <Notice tone="error">
                <ul>
                  {draft.schemaIssues.map((issue) => (
                    <li key={`${issue.path}:${issue.message}`}>
                      <code>{issue.path || '(root)'}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <SchemaBuilder schema={draft.schema} onChange={draft.setSchema} rootLabel={entry.key} />
          </>
        ) : null}
        {tab === 'history' ? <HistoryTimeline entry={entry} onRolledBack={props.onSaved} /> : null}
        {tab === 'usage' ? (
          <div className="laci-usage">
            <h3>{messages.usageTitle}</h3>
            <pre className="laci-code">{usageCode(entry)}</pre>
          </div>
        ) : null}
      </div>
      <SaveBar entry={entry} draft={draft} onSaved={props.onSaved} />
    </>
  );
}

/** The value as raw JSON, applied while it parses. */
function JsonTab(props: {
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  issues: readonly { path: string; message: string }[];
}) {
  const { messages } = useEditor();
  const [text, setText] = useState(() => pretty(props.value));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="laci-field">
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : props.issues.length > 0 ? (
        <Notice tone="error">
          <ul>
            {props.issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <code>{issue.path || '(root)'}</code> {issue.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        <span className="laci-check-ok">
          <Icon name="check" size={16} /> {messages.validAgainstSchema}
        </span>
      )}
      <textarea
        aria-label={messages.tabJson}
        className="laci-input laci-textarea laci-code-input laci-mono"
        rows={20}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            props.onChange(JSON.parse(event.target.value) as JsonValue);
            setError(null);
          } catch (caught) {
            setError(messages.invalidJson((caught as Error).message));
          }
        }}
      />
    </div>
  );
}
