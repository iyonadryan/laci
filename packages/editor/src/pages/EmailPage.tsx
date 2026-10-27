import { useState } from 'react';
import type { JsonObject, JsonValue, RenderedEmail } from '@lacijs/core';
import type { ApiEntry } from '../api';
import {
  EntryHeader,
  EntryList,
  PageHeader,
  SamplePicker,
  SaveBar,
  samplesOf,
  useDraft,
  withExample,
} from '../components/entry';
import { HistoryTimeline } from '../components/Review';
import {
  groupByKey,
  LocalePicker,
  pickLocale,
  SchemaDialog,
  useInserter,
  VariablesPanel,
  visualHtml,
} from '../components/template';
import { Icon, Notice, Tabs, TextField } from '../components/ui';
import { errorText, useDebounced, useEditor, useLoad } from '../context';
import { isObject } from '../model/json';

export function EmailPage(props: {
  selected?: string;
  locale?: string;
  onEnvironment: (environment: string) => void;
}) {
  const { api, messages, session, environment, navigate, changed } = useEditor();
  const list = useLoad(
    () => api.list({ kind: 'EMAIL_TEMPLATE', environment, limit: 500 }),
    [environment],
  );
  const entries = list.data?.items ?? [];
  const variants = entries.filter((entry) => entry.key === props.selected);
  const locale = pickLocale(variants, props.locale, session.defaultLocale);
  const entry = useLoad(
    () =>
      props.selected && locale
        ? api.entry(props.selected, { kind: 'EMAIL_TEMPLATE', environment, locale })
        : Promise.resolve(null),
    [props.selected, environment, locale],
  );
  const current =
    entry.data && entry.data.key === props.selected && entry.data.locale === locale
      ? entry.data
      : null;
  const refresh = () => {
    list.reload();
    entry.reload();
    changed();
  };
  return (
    <>
      <PageHeader
        crumb={`${messages.navContent} / ${messages.navEmail}`}
        title={messages.navEmail}
        onEnvironment={props.onEnvironment}
        actions={
          <button
            type="button"
            className="laci-button laci-button-primary"
            onClick={() => {
              navigate({ page: 'new', kind: 'EMAIL_TEMPLATE' });
            }}
          >
            <Icon name="plus" size={16} /> {messages.newTemplate}
          </button>
        }
      />
      <div className="laci-body">
        <EntryList
          entries={groupByKey(entries, session.defaultLocale)}
          selected={props.selected}
          searchLabel={messages.searchTemplates}
          loading={list.loading}
          error={list.error}
          onSelect={(item) => {
            navigate({ page: 'email', key: item.key });
          }}
        />
        {current ? (
          <EmailEditor
            key={`${current.id}:${current.version}`}
            entry={current}
            locales={variants.map((variant) => variant.locale as string)}
            onLocale={(next) => {
              navigate({ page: 'email', key: current.key, locale: next });
            }}
            onSaved={refresh}
          />
        ) : (
          <section className="laci-panel laci-editor-pane">
            {entry.error ? (
              <Notice tone="error">{messages.loadFailed(entry.error)}</Notice>
            ) : (
              <p className="laci-muted laci-empty">
                {props.selected ? messages.loading : messages.selectEntry}
              </p>
            )}
          </section>
        )}
      </div>
    </>
  );
}

const FIELDS = ['fromName', 'subject', 'html', 'text'] as const;
type Mode = 'visual' | 'html' | 'text';

function EmailEditor(props: {
  entry: ApiEntry;
  locales: readonly string[];
  onLocale: (locale: string) => void;
  onSaved: () => void;
}) {
  const { api, messages, session, notify } = useEditor();
  const { entry } = props;
  const draft = useDraft(entry);
  const value: JsonObject = isObject(draft.value) ? draft.value : {};
  const text = (field: string) => (typeof value[field] === 'string' ? value[field] : '');
  const set = (field: string, next: string) => {
    const copy: JsonObject = { ...value, [field]: next };
    if (field === 'fromName' && next === '') delete copy.fromName;
    draft.setValue(copy);
  };
  const inserter = useInserter(FIELDS, set);
  const [mode, setMode] = useState<Mode>('html');
  const [editingSchema, setEditingSchema] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [data, setData] = useState<JsonValue>(() => samplesOf(entry.schema)[0] as JsonValue);
  const errors = (field: string) =>
    draft.valueIssues.filter((issue) => issue.path === field).map((issue) => issue.message);
  const request = useDebounced(
    JSON.stringify({ value: draft.value, schema: draft.schema, data }),
    400,
  );
  const preview = useLoad<RenderedEmail>(() => {
    const body = JSON.parse(request) as { value: JsonValue; schema: JsonObject; data: JsonValue };
    return api.previewEmail({ ...body, locale: entry.locale as string });
  }, [request]);
  const bodyField = mode === 'text' ? 'text' : 'html';
  const insertVariable = (name: string) => {
    inserter.insert(`{{ ${name} }}`);
  };

  return (
    <>
      <section className="laci-panel laci-editor-pane" aria-label={messages.navEmail}>
        <EntryHeader entry={entry} dirty={draft.changes > 0} onChanged={props.onSaved}>
          <LocalePicker
            entry={entry}
            locales={props.locales}
            onLocale={props.onLocale}
            onAdded={props.onSaved}
          />
        </EntryHeader>
        {(entry.warnings ?? []).map((warning) => (
          <Notice key={warning.code} tone="warn">
            {warning.message}
          </Notice>
        ))}
        <div className="laci-grid">
          <TextField
            label={messages.optionalSuffix(messages.fromName)}
            value={text('fromName')}
            onChange={(next) => {
              set('fromName', next);
            }}
            errors={errors('fromName')}
            {...inserter.bind('fromName')}
          />
          <TextField
            label={messages.subject}
            value={text('subject')}
            onChange={(next) => {
              set('subject', next);
            }}
            errors={errors('subject')}
            {...inserter.bind('subject')}
          />
        </div>
        <div className="laci-toolbar">
          <Tabs
            label={messages.body}
            variant="segmented"
            value={mode}
            onChange={setMode}
            tabs={[
              { id: 'visual', label: messages.modeVisual },
              { id: 'html', label: messages.modeHtml },
              { id: 'text', label: messages.modeText },
            ]}
          />
          <span className="laci-spacer" />
          {mode === 'html' ? (
            <>
              <button
                type="button"
                className="laci-icon-button laci-bold"
                aria-label={messages.bold}
                onClick={() => {
                  inserter.insert('<strong>', '</strong>', 'html');
                }}
              >
                B
              </button>
              <button
                type="button"
                className="laci-icon-button laci-italic"
                aria-label={messages.italic}
                onClick={() => {
                  inserter.insert('<em>', '</em>', 'html');
                }}
              >
                I
              </button>
              <button
                type="button"
                className="laci-button laci-button-small"
                onClick={() => {
                  inserter.insert('<a href="https://">', '</a>', 'html');
                }}
              >
                {messages.insertLink}
              </button>
              <button
                type="button"
                className="laci-button laci-button-small"
                onClick={() => {
                  inserter.insert(
                    '<a href="https://" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#8A5A44;color:#FFFFFF;text-decoration:none">',
                    'Button</a>',
                    'html',
                  );
                }}
              >
                {messages.insertButton}
              </button>
            </>
          ) : null}
        </div>
        {mode === 'visual' ? (
          <>
            <p className="laci-help">{messages.visualHint}</p>
            <iframe
              title={messages.modeVisual}
              className="laci-email-frame"
              sandbox=""
              srcDoc={visualHtml(text('html'))}
            />
          </>
        ) : (
          <TextField
            label={mode === 'html' ? messages.modeHtml : messages.modeText}
            value={text(bodyField)}
            multiline
            mono
            rows={16}
            onChange={(next) => {
              set(bodyField, next);
            }}
            errors={errors(bodyField)}
            {...inserter.bind(bodyField)}
          />
        )}
        <button
          type="button"
          className="laci-link-button"
          aria-expanded={showHistory}
          onClick={() => {
            setShowHistory(!showHistory);
          }}
        >
          {messages.historyTitle}
        </button>
        {showHistory ? <HistoryTimeline entry={entry} onRolledBack={props.onSaved} /> : null}
        <SaveBar entry={entry} draft={draft} onSaved={props.onSaved}>
          {session.sendTest ? (
            <SendTest
              send={(to) =>
                api.sendTest({
                  kind: 'EMAIL_TEMPLATE',
                  value: draft.value,
                  schema: draft.schema,
                  data,
                  locale: entry.locale as string,
                  to,
                })
              }
              onSent={(to) => {
                notify(messages.sendTestDone(to));
              }}
            />
          ) : null}
        </SaveBar>
      </section>
      <aside className="laci-side-pane" aria-label={messages.preview}>
        <VariablesPanel
          schema={draft.schema}
          onInsert={insertVariable}
          onEditSchema={() => {
            setEditingSchema(true);
          }}
        />
        <div className="laci-panel laci-preview">
          <div className="laci-row">
            <h3 className="laci-spacer">{messages.preview}</h3>
          </div>
          <SamplePicker
            schema={draft.schema}
            data={data}
            onData={setData}
            onSaveExample={(example) => {
              draft.setSchema(withExample(draft.schema, example));
            }}
          />
          {preview.error ? (
            <Notice tone="error">{messages.previewFailed(preview.error)}</Notice>
          ) : null}
          {preview.data && !preview.error ? (
            <div className="laci-mail">
              <div className="laci-mail-head">
                <strong>{preview.data.subject}</strong>
                <span className="laci-muted laci-small">
                  {preview.data.fromName ?? entry.key} · {preview.data.locale}
                </span>
              </div>
              <iframe
                title={messages.preview}
                className="laci-email-frame"
                sandbox=""
                srcDoc={preview.data.html}
              />
              <details>
                <summary>{messages.modeText}</summary>
                <pre className="laci-code laci-small">{preview.data.text}</pre>
              </details>
            </div>
          ) : null}
        </div>
      </aside>
      {editingSchema ? (
        <SchemaDialog
          schema={draft.schema}
          rootLabel={entry.key}
          onClose={() => {
            setEditingSchema(false);
          }}
          onApply={(schema) => {
            draft.setSchema(schema);
            setEditingSchema(false);
          }}
        />
      ) : null}
    </>
  );
}

/** "Send test" with the address to send to. */
export function SendTest(props: {
  send: (to: string) => Promise<unknown>;
  onSent: (to: string) => void;
}) {
  const { messages } = useEditor();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="laci-button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {messages.sendTest}
      </button>
    );
  }
  return (
    <span className="laci-row laci-send-test">
      <input
        aria-label={messages.sendTestTo}
        placeholder={messages.sendTestTo}
        className="laci-input laci-input-narrow"
        value={to}
        onChange={(event) => {
          setTo(event.target.value);
        }}
      />
      <button
        type="button"
        className="laci-button"
        disabled={to.trim() === '' || sending}
        onClick={() => {
          setSending(true);
          setError(null);
          props.send(to.trim()).then(
            () => {
              setSending(false);
              setOpen(false);
              props.onSent(to.trim());
            },
            (caught: unknown) => {
              setSending(false);
              setError(errorText(caught));
            },
          );
        }}
      >
        {messages.sendTest}
      </button>
      {error ? <span className="laci-error">{error}</span> : null}
    </span>
  );
}
