import { useState } from 'react';
import type {
  JsonObject,
  JsonValue,
  MessageChannel,
  MessageWarning,
  RenderedMessage,
} from '@lacijs/core';
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
import { HistoryTimeline, selectorOf } from '../components/Review';
import {
  groupByKey,
  LocalePicker,
  numberedText,
  pickLocale,
  SchemaDialog,
  useInserter,
  VariablesPanel,
} from '../components/template';
import { Icon, Notice, Tabs, TextField } from '../components/ui';
import { errorText, relativeTime, useDebounced, useEditor, useLoad } from '../context';
import { isObject, omit } from '../model/json';
import { SendTest } from './EmailPage';

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
const PROVIDER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

/** The template fields of each channel; the first ones get variables inserted. */
const TEXT_FIELDS: Record<MessageChannel, readonly string[]> = {
  WHATSAPP: ['body', 'header'],
  SMS: ['body'],
  PUSH: ['body', 'title', 'deepLink', 'imageUrl'],
  IN_APP: ['body', 'title', 'deepLink'],
};

export function MessagePage(props: {
  channel: MessageChannel;
  selected?: string;
  locale?: string;
  onEnvironment: (environment: string) => void;
}) {
  const { api, messages, session, environment, navigate, changed } = useEditor();
  const list = useLoad(
    () => api.list({ kind: 'MESSAGE_TEMPLATE', environment, limit: 500 }),
    [environment],
  );
  const all = list.data?.items ?? [];
  const inChannel = all.filter((entry) => entry.channel === props.channel);
  const variants = inChannel.filter((entry) => entry.key === props.selected);
  const locale = pickLocale(variants, props.locale, session.defaultLocale);
  const entry = useLoad(
    () =>
      props.selected && locale
        ? api.entry(props.selected, {
            kind: 'MESSAGE_TEMPLATE',
            environment,
            locale,
            channel: props.channel,
          })
        : Promise.resolve(null),
    [props.selected, environment, locale, props.channel],
  );
  const current =
    entry.data &&
    entry.data.key === props.selected &&
    entry.data.locale === locale &&
    entry.data.channel === props.channel
      ? entry.data
      : null;
  const count = (channel: MessageChannel) =>
    new Set(all.filter((item) => item.channel === channel).map((item) => item.key)).size;
  const refresh = () => {
    list.reload();
    entry.reload();
    changed();
  };
  return (
    <>
      <PageHeader
        crumb={`${messages.navContent} / ${messages.navMessage}`}
        title={messages.navMessage}
        onEnvironment={props.onEnvironment}
        actions={
          <button
            type="button"
            className="laci-button laci-button-primary"
            onClick={() => {
              navigate({ page: 'new', kind: 'MESSAGE_TEMPLATE', channel: props.channel });
            }}
          >
            <Icon name="plus" size={16} /> {messages.newMessage}
          </button>
        }
      >
        <Tabs
          label={messages.channel}
          value={props.channel}
          onChange={(channel) => {
            navigate({ page: 'message', channel });
          }}
          tabs={session.channels.map((channel) => ({
            id: channel,
            label: (
              <>
                {messages.channels[channel]}{' '}
                <span className="laci-muted laci-small">{count(channel)}</span>
              </>
            ),
          }))}
        />
      </PageHeader>
      <div className="laci-body">
        <EntryList
          entries={groupByKey(inChannel, session.defaultLocale)}
          selected={props.selected}
          searchLabel={messages.searchTemplates}
          loading={list.loading}
          error={list.error}
          onSelect={(item) => {
            navigate({ page: 'message', channel: props.channel, key: item.key });
          }}
        />
        {current ? (
          <MessageEditor
            key={`${current.id}:${current.version}`}
            entry={current}
            channel={props.channel}
            locales={variants.map((variant) => variant.locale as string)}
            onLocale={(next) => {
              navigate({ page: 'message', channel: props.channel, key: current.key, locale: next });
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

const unique = (warnings: readonly MessageWarning[]) => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const id = `${warning.path}:${warning.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

function MessageEditor(props: {
  entry: ApiEntry;
  channel: MessageChannel;
  locales: readonly string[];
  onLocale: (locale: string) => void;
  onSaved: () => void;
}) {
  const { api, messages, session, notify } = useEditor();
  const { entry, channel } = props;
  const draft = useDraft(entry);
  const value: JsonObject = isObject(draft.value) ? draft.value : {};
  const text = (field: string) => (typeof value[field] === 'string' ? value[field] : '');
  const setField = (field: string, next: JsonValue | undefined) => {
    draft.setValue(
      next === undefined || next === '' ? omit(value, field) : { ...value, [field]: next },
    );
  };
  const inserter = useInserter(TEXT_FIELDS[channel], (field, next) => {
    setField(field, next);
  });
  const [editingSchema, setEditingSchema] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [data, setData] = useState<JsonValue>(() => samplesOf(entry.schema)[0] as JsonValue);
  const errors = (field: string) =>
    draft.valueIssues
      .filter((issue) => issue.path === field || issue.path.startsWith(`${field}[`))
      .map((issue) => (issue.path === field ? issue.message : `${issue.path}: ${issue.message}`));
  const request = useDebounced(
    JSON.stringify({ value: draft.value, schema: draft.schema, data }),
    400,
  );
  const preview = useLoad<RenderedMessage>(() => {
    const body = JSON.parse(request) as { value: JsonValue; schema: JsonObject; data: JsonValue };
    return api.previewMessage({ ...body, channel, locale: entry.locale as string });
  }, [request, channel]);
  const rendered = preview.error ? null : (preview.data ?? null);
  const warnings = unique([...(draft.validation?.warnings ?? []), ...(rendered?.warnings ?? [])]);
  const field = (
    name: string,
    label: string,
    options: { multiline?: boolean; hint?: string; mono?: boolean } = {},
  ) => (
    <TextField
      label={label}
      value={text(name)}
      multiline={options.multiline}
      rows={6}
      mono={options.mono}
      hint={options.hint}
      onChange={(next) => {
        setField(name, next);
      }}
      errors={errors(name)}
      {...inserter.bind(name)}
    />
  );
  const counter = (() => {
    if (!rendered) return undefined;
    if (rendered.channel === 'SMS') {
      const { units, perSegment, segments, encoding } = rendered.segments;
      return messages.smsCounter(units, perSegment, segments, encoding);
    }
    if (rendered.channel === 'WHATSAPP') return messages.characters(rendered.body.length, 1024);
    if (rendered.channel === 'PUSH')
      return messages.characters(Array.from(rendered.body).length, 178);
    return messages.characters(Array.from(rendered.body).length, 1000);
  })();
  const sync = async () => {
    setSyncError(null);
    try {
      await api.syncProviderStatus(entry.key, selectorOf(entry));
      props.onSaved();
    } catch (caught) {
      setSyncError(errorText(caught));
    }
  };

  return (
    <>
      <section className="laci-panel laci-editor-pane" aria-label={messages.navMessage}>
        <EntryHeader entry={entry} dirty={draft.changes > 0} onChanged={props.onSaved}>
          <span className="laci-pill">{messages.channels[channel]}</span>
          <LocalePicker
            entry={entry}
            locales={props.locales}
            onLocale={props.onLocale}
            onAdded={props.onSaved}
          />
        </EntryHeader>
        {channel === 'WHATSAPP' ? (
          <div className="laci-provider">
            <TextField
              label={messages.providerTemplateName}
              value={text('providerTemplateName')}
              mono
              onChange={(next) => {
                setField('providerTemplateName', next);
              }}
              errors={errors('providerTemplateName')}
            />
            <label className="laci-field">
              <span className="laci-label">{messages.category}</span>
              <select
                className="laci-input"
                value={text('category')}
                onChange={(event) => {
                  setField('category', event.target.value);
                }}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <div className="laci-field">
              <label className="laci-label" htmlFor={`${entry.id}-approval`}>
                {messages.providerApproval}
              </label>
              <select
                id={`${entry.id}-approval`}
                className={`laci-input laci-approval-${(text('providerStatus') || 'none').toLowerCase()}`}
                value={text('providerStatus')}
                onChange={(event) => {
                  setField('providerStatus', event.target.value);
                }}
              >
                <option value="">{messages.providerStatuses.NONE}</option>
                {PROVIDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {messages.providerStatuses[status]}
                  </option>
                ))}
              </select>
              {text('providerSyncedAt') ? (
                <span className="laci-muted laci-small">
                  {messages.syncedAt(relativeTime(text('providerSyncedAt')))}
                </span>
              ) : null}
            </div>
            {session.providerSync ? (
              <button
                type="button"
                className="laci-button laci-button-small"
                disabled={draft.changes > 0}
                onClick={() => void sync()}
              >
                {messages.syncStatus}
              </button>
            ) : null}
            {syncError ? <Notice tone="error">{syncError}</Notice> : null}
          </div>
        ) : null}
        {channel === 'WHATSAPP' ? field('header', messages.optionalSuffix(messages.header)) : null}
        {channel === 'PUSH' ? field('title', messages.title) : null}
        {channel === 'IN_APP' ? field('title', messages.optionalSuffix(messages.title)) : null}
        {field('body', messages.body, { multiline: true, ...(counter ? { hint: counter } : {}) })}
        <VariableChips
          schema={draft.schema}
          onInsert={(name) => {
            inserter.insert(`{{ ${name} }}`);
          }}
        />
        {channel === 'WHATSAPP' ? (
          <>
            {field('footer', messages.optionalSuffix(messages.footer))}
            <ButtonsEditor
              value={Array.isArray(value.buttons) ? value.buttons : []}
              errors={errors('buttons')}
              onChange={(buttons) => {
                setField('buttons', buttons.length === 0 ? undefined : buttons);
              }}
            />
            <details className="laci-provider-text">
              <summary>{messages.providerText}</summary>
              <pre className="laci-code laci-small">
                {[
                  text('header') ? numberedText(text('header')) : null,
                  numberedText(text('body')),
                  text('footer') || null,
                ]
                  .filter(Boolean)
                  .join('\n\n')}
              </pre>
            </details>
          </>
        ) : null}
        {channel === 'SMS'
          ? field('senderId', messages.optionalSuffix(messages.senderId), { mono: true })
          : null}
        {channel === 'PUSH' ? (
          <div className="laci-grid">
            {field('deepLink', messages.optionalSuffix(messages.deepLink), { mono: true })}
            {field('imageUrl', messages.optionalSuffix(messages.imageUrl), { mono: true })}
          </div>
        ) : null}
        {channel === 'IN_APP'
          ? field('deepLink', messages.optionalSuffix(messages.deepLink), { mono: true })
          : null}
        {warnings.map((warning) => (
          <Notice key={`${warning.path}:${warning.message}`} tone="warn">
            <code>{warning.path}</code> {warning.message}
          </Notice>
        ))}
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
                  kind: 'MESSAGE_TEMPLATE',
                  channel,
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
        <h3>{messages.preview}</h3>
        <Phone channel={channel} rendered={rendered} error={preview.error} />
        <SamplePicker
          schema={draft.schema}
          data={data}
          onData={setData}
          onSaveExample={(example) => {
            draft.setSchema(withExample(draft.schema, example));
          }}
        />
        <VariablesPanel
          schema={draft.schema}
          onInsert={(name) => {
            inserter.insert(`{{ ${name} }}`);
          }}
          onEditSchema={() => {
            setEditingSchema(true);
          }}
        />
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

function VariableChips(props: { schema: JsonObject; onInsert: (name: string) => void }) {
  const { messages } = useEditor();
  const names = Object.keys(isObject(props.schema.properties) ? props.schema.properties : {});
  if (names.length === 0) return null;
  return (
    <div className="laci-row laci-wrap">
      <span className="laci-muted laci-small">{messages.insertVariable}</span>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className="laci-chip laci-chip-button laci-mono"
          onClick={() => {
            props.onInsert(name);
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function ButtonsEditor(props: {
  value: JsonValue[];
  errors: string[];
  onChange: (buttons: JsonValue[]) => void;
}) {
  const { messages } = useEditor();
  const buttons = props.value.filter(isObject);
  const update = (index: number, patch: JsonObject) => {
    props.onChange(
      buttons.map((button, position) => {
        if (position !== index) return button;
        const next: JsonObject = { ...button, ...patch };
        if (next.type === 'QUICK_REPLY') delete next.url;
        return next;
      }),
    );
  };
  return (
    <fieldset className="laci-buttons">
      <legend className="laci-label">{messages.buttons}</legend>
      {buttons.map((button, index) => (
        <div key={index} className="laci-row laci-wrap">
          <select
            aria-label={`${messages.buttonType} ${index + 1}`}
            className="laci-input laci-input-narrow"
            value={typeof button.type === 'string' ? button.type : 'QUICK_REPLY'}
            onChange={(event) => {
              update(
                index,
                event.target.value === 'URL'
                  ? { type: 'URL', url: 'https://' }
                  : { type: 'QUICK_REPLY' },
              );
            }}
          >
            <option value="QUICK_REPLY">QUICK_REPLY</option>
            <option value="URL">URL</option>
          </select>
          <input
            aria-label={`${messages.buttonText} ${index + 1}`}
            className="laci-input"
            value={typeof button.text === 'string' ? button.text : ''}
            onChange={(event) => {
              update(index, { text: event.target.value });
            }}
          />
          {button.type === 'URL' ? (
            <input
              aria-label={`${messages.buttonUrl} ${index + 1}`}
              className="laci-input laci-mono"
              value={typeof button.url === 'string' ? button.url : ''}
              onChange={(event) => {
                update(index, { url: event.target.value });
              }}
            />
          ) : null}
          <button
            type="button"
            className="laci-link-button laci-danger"
            aria-label={`${messages.removeButton} ${index + 1}`}
            onClick={() => {
              props.onChange(buttons.filter((_, position) => position !== index));
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="laci-button laci-button-dashed laci-button-small"
        onClick={() => {
          props.onChange([...buttons, { type: 'QUICK_REPLY', text: 'OK' }]);
        }}
      >
        {messages.addButton}
      </button>
      {props.errors.map((message) => (
        <p key={message} className="laci-error">
          {message}
        </p>
      ))}
    </fieldset>
  );
}

/** The rendered message in a phone frame, as the channel shows it. */
function Phone(props: {
  channel: MessageChannel;
  rendered: RenderedMessage | null;
  error: string | null;
}) {
  const { messages } = useEditor();
  const { rendered } = props;
  const frame = messages.phonePreview[props.channel];
  return (
    <div className={`laci-phone laci-phone-${props.channel.toLowerCase()}`}>
      <div className="laci-phone-bar">
        <span className="laci-phone-avatar" aria-hidden="true" />
        <span className="laci-phone-name">
          <strong>
            {rendered?.channel === 'SMS' && rendered.senderId ? rendered.senderId : frame.name}
          </strong>
          <span className="laci-small">{frame.sub}</span>
        </span>
      </div>
      <div className="laci-phone-screen">
        {props.error ? <Notice tone="error">{messages.previewFailed(props.error)}</Notice> : null}
        {rendered ? (
          <div className="laci-bubble">
            {rendered.channel === 'WHATSAPP' && rendered.header ? (
              <strong>{rendered.header}</strong>
            ) : null}
            {(rendered.channel === 'PUSH' || rendered.channel === 'IN_APP') && rendered.title ? (
              <strong>{rendered.title}</strong>
            ) : null}
            {rendered.channel === 'PUSH' && rendered.imageUrl ? (
              <img src={rendered.imageUrl} alt="" className="laci-bubble-image" />
            ) : null}
            <span className="laci-bubble-text">{rendered.body}</span>
            {rendered.channel === 'WHATSAPP' && rendered.footer ? (
              <span className="laci-muted laci-small">{rendered.footer}</span>
            ) : null}
            {rendered.channel === 'WHATSAPP'
              ? rendered.buttons.map((button, index) => (
                  <span key={index} className="laci-bubble-button">
                    {button.text}
                  </span>
                ))
              : null}
            {(rendered.channel === 'PUSH' || rendered.channel === 'IN_APP') && rendered.deepLink ? (
              <code className="laci-small laci-muted">{rendered.deepLink}</code>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
