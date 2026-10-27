import { useState } from 'react';
import type { EntryKind, JsonSchema, JsonValue, MessageChannel } from '@lacijs/core';
import { PageHeader } from '../components/entry';
import { SchemaBuilder } from '../components/SchemaBuilder';
import { Notice } from '../components/ui';
import { errorText, useEditor } from '../context';
import { CONFIG_PRESETS, TEMPLATE_PRESET } from '../model/builder';
import { isObject } from '../model/json';
import { defaultValue } from '../model/schema';

const KINDS: EntryKind[] = ['CONFIG', 'EMAIL_TEMPLATE', 'MESSAGE_TEMPLATE'];

/** A first value that passes the checks of each template kind. */
function starter(
  kind: EntryKind,
  channel: MessageChannel,
  key: string,
  schema: JsonSchema,
): JsonValue {
  if (kind === 'CONFIG') return defaultValue(schema);
  const first = Object.keys(isObject(schema.properties) ? schema.properties : {})[0];
  const hello = first ? `Hello {{ ${first} }}` : 'Hello';
  if (kind === 'EMAIL_TEMPLATE') {
    return { subject: hello, html: `<p>${hello},</p>`, text: `${hello},` };
  }
  switch (channel) {
    case 'WHATSAPP':
      return {
        providerTemplateName:
          key
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '') || 'template',
        category: 'UTILITY',
        body: hello,
        providerStatus: 'PENDING',
      };
    case 'PUSH':
      return { title: 'Hello', body: hello };
    default:
      return { body: hello };
  }
}

/** Creates an entry: its kind, key, and the structure of its value or variables. */
export function NewEntryPage(props: {
  kind?: EntryKind;
  channel?: MessageChannel;
  onEnvironment: (environment: string) => void;
}) {
  const { api, messages, session, environment, navigate, notify, changed } = useEditor();
  const [kind, setKind] = useState<EntryKind>(props.kind ?? 'CONFIG');
  const [channel, setChannel] = useState<MessageChannel>(props.channel ?? 'WHATSAPP');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [locale, setLocale] = useState(session.defaultLocale);
  const [preset, setPreset] = useState('objects');
  const [schema, setSchema] = useState<JsonSchema>(
    kind === 'CONFIG' ? (CONFIG_PRESETS.objects as JsonSchema) : TEMPLATE_PRESET,
  );
  // A new builder for each starting structure.
  const [builderKey, setBuilderKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const restart = (next: JsonSchema) => {
    setSchema(next);
    setBuilderKey(builderKey + 1);
  };
  const create = async () => {
    setError(null);
    try {
      const entry = await api.create({
        key: key.trim(),
        kind,
        environment,
        ...(kind === 'CONFIG' ? {} : { locale }),
        ...(kind === 'MESSAGE_TEMPLATE' ? { channel } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        schema,
        value: starter(kind, channel, key.trim(), schema),
        status: 'DRAFT',
      });
      notify(messages.created(entry.key));
      changed();
      navigate(
        kind === 'CONFIG'
          ? { page: 'config', key: entry.key }
          : kind === 'EMAIL_TEMPLATE'
            ? { page: 'email', key: entry.key, locale }
            : { page: 'message', channel, key: entry.key, locale },
      );
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  return (
    <>
      <PageHeader
        crumb={`${messages.navManage} / ${messages.navSchema}`}
        title={messages.newEntryTitle}
        onEnvironment={props.onEnvironment}
        actions={
          <button
            type="button"
            className="laci-button laci-button-primary"
            disabled={key.trim() === ''}
            onClick={() => void create()}
          >
            {messages.createEntry}
          </button>
        }
      />
      <div className="laci-body laci-body-column">
        <section className="laci-panel" aria-label={messages.newEntryTitle}>
          <div className="laci-kinds">
            {KINDS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={item === kind}
                className={item === kind ? 'laci-kind laci-kind-on' : 'laci-kind'}
                onClick={() => {
                  setKind(item);
                  restart(
                    item === 'CONFIG' ? (CONFIG_PRESETS[preset] as JsonSchema) : TEMPLATE_PRESET,
                  );
                }}
              >
                <strong>{messages.kindLabels[item].label}</strong>
                <span className="laci-muted laci-small">{messages.kindLabels[item].hint}</span>
              </button>
            ))}
          </div>
          <div className="laci-grid laci-grid-3">
            <label className="laci-field">
              <span className="laci-label">{messages.key}</span>
              <input
                className="laci-input laci-mono"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                }}
              />
            </label>
            <label className="laci-field laci-span-2">
              <span className="laci-label">{messages.description}</span>
              <input
                className="laci-input"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </label>
            {kind === 'CONFIG' ? null : (
              <label className="laci-field">
                <span className="laci-label">{messages.locale}</span>
                <input
                  className="laci-input laci-mono"
                  value={locale}
                  onChange={(event) => {
                    setLocale(event.target.value);
                  }}
                />
              </label>
            )}
            {kind === 'MESSAGE_TEMPLATE' ? (
              <label className="laci-field">
                <span className="laci-label">{messages.channel}</span>
                <select
                  className="laci-input"
                  value={channel}
                  onChange={(event) => {
                    setChannel(event.target.value as MessageChannel);
                  }}
                >
                  {session.channels.map((item) => (
                    <option key={item} value={item}>
                      {messages.channels[item]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {kind === 'CONFIG' ? (
            <div className="laci-row laci-wrap">
              <span className="laci-muted laci-small">{messages.startFrom}</span>
              {Object.keys(CONFIG_PRESETS).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={name === preset}
                  className={name === preset ? 'laci-filter laci-filter-on' : 'laci-filter'}
                  onClick={() => {
                    setPreset(name);
                    restart(CONFIG_PRESETS[name] as JsonSchema);
                  }}
                >
                  {messages.presets[name] ?? name}
                </button>
              ))}
            </div>
          ) : null}
        </section>
        <section className="laci-panel">
          <h2>{kind === 'CONFIG' ? messages.structure : messages.variablesStructure}</h2>
          <SchemaBuilder
            key={builderKey}
            schema={schema}
            onChange={setSchema}
            rootLabel={key.trim() || messages.key}
            template={kind !== 'CONFIG'}
          />
        </section>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </>
  );
}
