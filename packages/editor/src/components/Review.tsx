import { useState } from 'react';
import type { EntryStatus, JsonSchema, JsonValue } from '@lacijs/core';
import type { ApiEntry, ApiHistory, PromoteChange, Selector } from '../api';
import { ApiError } from '../api';
import { errorText, formatBytes, isConflict, relativeTime, useEditor, useLoad } from '../context';
import { diffValues, jsonDiff } from '../model/diff';
import type { FieldChange } from '../model/diff';
import { Dialog, Icon, Notice, Tabs } from './ui';

export const selectorOf = (entry: ApiEntry): Selector => ({
  kind: entry.kind,
  environment: entry.environment,
  locale: entry.locale,
  channel: entry.channel,
});

const short = (value: JsonValue | undefined, none: string): string => {
  if (value === undefined) return none;
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/** The changes between two versions: per field, or as JSON side by side. */
export function DiffView(props: {
  before: { value: JsonValue | undefined; schema?: JsonSchema };
  after: { value: JsonValue; schema?: JsonSchema };
  beforeLabel: string;
  afterLabel: string;
}) {
  const { messages } = useEditor();
  const [view, setView] = useState<'fields' | 'json'>('fields');
  const valueChanges = diffValues(props.before.value, props.after.value);
  const schemaChanges =
    props.before.schema && props.after.schema
      ? diffValues(props.before.schema, props.after.schema).map((change) => ({
          ...change,
          path: `${messages.schemaChanged}: ${change.path || '(root)'}`,
        }))
      : [];
  const changes: FieldChange[] = [...valueChanges, ...schemaChanges];
  const count = (kind: FieldChange['kind']) =>
    changes.filter((change) => change.kind === kind).length;
  return (
    <div className="laci-diff">
      <div className="laci-row laci-diff-head">
        <strong className="laci-spacer">{messages.changesCount(changes.length)}</strong>
        {count('added') > 0 ? (
          <span className="laci-pill laci-pill-ok">{messages.added(count('added'))}</span>
        ) : null}
        {count('modified') > 0 ? (
          <span className="laci-pill laci-pill-warn">
            {messages.modifiedCount(count('modified'))}
          </span>
        ) : null}
        {count('removed') > 0 ? (
          <span className="laci-pill laci-pill-error">{messages.removed(count('removed'))}</span>
        ) : null}
        <Tabs
          label={messages.reviewTitle}
          variant="segmented"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'fields', label: messages.viewFields },
            { id: 'json', label: messages.viewJsonDiff },
          ]}
        />
      </div>
      {view === 'fields' ? (
        <ul className="laci-changes">
          {changes.map((change) => (
            <li key={`${change.kind}:${change.path}`} className="laci-change">
              <span className={`laci-pill laci-change-${change.kind}`}>
                {messages.changeKinds[change.kind]}
              </span>
              <div className="laci-change-body">
                <code className="laci-mono">{change.path || '(root)'}</code>
                <div className="laci-row laci-mono laci-small">
                  <span
                    className={change.before === undefined ? 'laci-before-none' : 'laci-before'}
                  >
                    {short(change.before, messages.none)}
                  </span>
                  <span aria-hidden="true">→</span>
                  <span className={change.after === undefined ? 'laci-before-none' : 'laci-after'}>
                    {short(change.after, messages.none)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="laci-json-diff laci-mono" role="table">
          <div className="laci-json-diff-row laci-muted" role="row">
            <span role="columnheader">{props.beforeLabel}</span>
            <span role="columnheader">{props.afterLabel}</span>
          </div>
          {jsonDiff(props.before.value ?? null, props.after.value).map((row, index) => (
            <div key={index} className="laci-json-diff-row" role="row">
              <span role="cell" className={row.left?.changed ? 'laci-line-removed' : undefined}>
                {row.left?.text ?? ''}
              </span>
              <span role="cell" className={row.right?.changed ? 'laci-line-added' : undefined}>
                {row.right?.text ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** What a save changes. */
export interface Draft {
  value: JsonValue;
  schema: JsonSchema;
  description: string | null;
  status?: EntryStatus;
}

/**
 * Review before saving: the diff, the validation result, whether someone saved meanwhile, and a
 * change note.
 */
export function ReviewDialog(props: {
  entry: ApiEntry;
  draft: Draft;
  onClose: () => void;
  onSaved: (entry: ApiEntry) => void;
}) {
  const { api, messages, session, notify } = useEditor();
  const { entry, draft } = props;
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checks = useLoad(
    () =>
      Promise.all([
        api.validate({
          kind: entry.kind,
          channel: entry.channel,
          schema: draft.schema,
          value: draft.value,
          previous: entry.value,
        }),
        api.entry(entry.key, selectorOf(entry)),
      ]),
    [entry.id, entry.version],
  );
  const [validation, latest] = checks.data ?? [];
  const stale = latest !== undefined && latest.version !== entry.version;
  const next = entry.version + 1;
  const save = async (status?: EntryStatus) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.update(entry.key, selectorOf(entry), {
        value: draft.value,
        schema: draft.schema,
        description: draft.description,
        ...((status ?? draft.status) ? { status: status ?? draft.status } : {}),
        expectedVersion: entry.version,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      notify(messages.saved(saved.version));
      props.onSaved(saved);
    } catch (caught) {
      setError(isConflict(caught) ? messages.conflict : errorText(caught));
      if (caught instanceof ApiError && caught.details.issues) checks.reload();
    } finally {
      setSaving(false);
    }
  };
  const blocked = saving || !validation?.valid || stale;
  // A draft can be saved as a draft or published; a live entry is saved live.
  const isDraft = entry.status === 'DRAFT' && draft.status === undefined;
  return (
    <Dialog
      wide
      title={`${messages.reviewTitle} · ${entry.key} · v${entry.version} → v${next}`}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="laci-button" onClick={props.onClose}>
            {messages.backToEditor}
          </button>
          <span className="laci-spacer" />
          {isDraft ? (
            <>
              <button
                type="button"
                className="laci-button"
                disabled={blocked}
                onClick={() => void save()}
              >
                {messages.saveDraft}
              </button>
              <button
                type="button"
                className="laci-button laci-button-primary"
                disabled={blocked}
                onClick={() => void save('PUBLISHED')}
              >
                {messages.publishVersion(next)}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="laci-button laci-button-primary"
              disabled={blocked}
              onClick={() => void save()}
            >
              {messages.saveVersion(next)}
            </button>
          )}
        </>
      }
    >
      <DiffView
        before={{ value: entry.value, schema: entry.schema }}
        after={{ value: draft.value, schema: draft.schema }}
        beforeLabel={`v${entry.version}`}
        afterLabel={`v${next}`}
      />
      <div className="laci-checks">
        {checks.loading ? <span className="laci-muted">{messages.loading}</span> : null}
        {checks.error ? <Notice tone="error">{messages.loadFailed(checks.error)}</Notice> : null}
        {validation ? (
          validation.valid ? (
            <span className="laci-check-ok">
              <Icon name="check" size={16} /> {messages.schemaValid}
            </span>
          ) : (
            <Notice tone="error">
              {messages.schemaInvalid(validation.issues.length)}
              <ul>
                {validation.issues.map((issue) => (
                  <li key={`${issue.path}:${issue.message}`}>
                    <code>{issue.path || '(root)'}</code> {issue.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )
        ) : null}
        {latest ? (
          stale ? (
            <Notice tone="error">{messages.newerVersion(latest.version, latest.updatedBy)}</Notice>
          ) : (
            <span className="laci-check-ok">
              <Icon name="check" size={16} /> {messages.latestVersion(entry.version)}
            </span>
          )
        ) : null}
        {validation ? (
          <span className="laci-muted">
            {messages.sizeOf(
              formatBytes(validation.bytes),
              formatBytes(session.limits.maxValueBytes),
            )}
          </span>
        ) : null}
        {validation?.warnings.map((warning) => (
          <Notice key={`${warning.path}:${warning.code}`} tone="warn">
            <code>{warning.path}</code> {warning.message}
          </Notice>
        ))}
      </div>
      <label className="laci-field">
        <span className="laci-label">{messages.changeNote}</span>
        <input
          className="laci-input"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Dialog>
  );
}

const PAGE = 20;

/** Versions of an entry, newest first, with Compare and Roll back. */
export function HistoryTimeline(props: {
  entry: ApiEntry;
  onRolledBack: (entry: ApiEntry) => void;
}) {
  const { api, messages, notify } = useEditor();
  const { entry } = props;
  const [limit, setLimit] = useState(PAGE);
  const history = useLoad(
    () => api.history(entry.key, selectorOf(entry), { limit }),
    [entry.id, entry.version, limit],
  );
  const [comparing, setComparing] = useState<ApiHistory | null>(null);
  const [rolling, setRolling] = useState<ApiHistory | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rollBack = async (version: ApiHistory) => {
    setError(null);
    try {
      const saved = await api.rollback(entry.key, selectorOf(entry), {
        version: version.version,
        expectedVersion: entry.version,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      notify(messages.rolledBack(version.version));
      setRolling(null);
      setNote('');
      props.onRolledBack(saved);
    } catch (caught) {
      setError(isConflict(caught) ? messages.conflict : errorText(caught));
    }
  };
  const items = history.data?.items ?? [];
  return (
    <section className="laci-history" aria-label={messages.historyTitle}>
      <div className="laci-row">
        <h3 className="laci-spacer">{messages.historyTitle}</h3>
        {history.data ? (
          <span className="laci-muted">{messages.versions(history.data.total)}</span>
        ) : null}
      </div>
      {history.error ? <Notice tone="error">{messages.loadFailed(history.error)}</Notice> : null}
      <ol className="laci-timeline">
        {items.map((item) => {
          const isCurrent = item.version === entry.version;
          return (
            <li key={item.id} className="laci-timeline-item">
              <span
                className={isCurrent ? 'laci-dot laci-dot-on' : 'laci-dot'}
                aria-hidden="true"
              />
              <div className="laci-timeline-body">
                <span className="laci-row">
                  <strong className="laci-mono">v{item.version}</strong>
                  <span className="laci-muted laci-small">
                    {relativeTime(item.changedAt)} · {item.changedBy ?? messages.system}
                    {isCurrent ? ` · ${messages.current}` : ''}
                  </span>
                </span>
                {item.note ? <span>{item.note}</span> : null}
                {isCurrent ? null : (
                  <span className="laci-row">
                    <button
                      type="button"
                      className="laci-link-button"
                      onClick={() => {
                        setComparing(item);
                      }}
                    >
                      {messages.compare} v{item.version}
                    </button>
                    <button
                      type="button"
                      className="laci-link-button laci-muted-button"
                      onClick={() => {
                        setRolling(item);
                      }}
                    >
                      {messages.rollBackTo(item.version)}
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {history.data && items.length < history.data.total ? (
        <button
          type="button"
          className="laci-button"
          onClick={() => {
            setLimit(limit + PAGE);
          }}
        >
          {messages.loadMore}
        </button>
      ) : null}
      {comparing ? (
        <Dialog
          wide
          title={messages.compareTitle(comparing.version, entry.version)}
          onClose={() => {
            setComparing(null);
          }}
        >
          <DiffView
            before={{ value: comparing.value, schema: comparing.schema }}
            after={{ value: entry.value, schema: entry.schema }}
            beforeLabel={`v${comparing.version}`}
            afterLabel={`v${entry.version}`}
          />
        </Dialog>
      ) : null}
      {rolling ? (
        <Dialog
          title={messages.rollBackTo(rolling.version)}
          onClose={() => {
            setRolling(null);
          }}
          footer={
            <>
              <span className="laci-spacer" />
              <button
                type="button"
                className="laci-button laci-button-primary"
                onClick={() => void rollBack(rolling)}
              >
                {messages.rollBackTo(rolling.version)}
              </button>
            </>
          }
        >
          <DiffView
            before={{ value: entry.value, schema: entry.schema }}
            after={{ value: rolling.value, schema: rolling.schema }}
            beforeLabel={`v${entry.version}`}
            afterLabel={`v${rolling.version}`}
          />
          <label className="laci-field">
            <span className="laci-label">{messages.rollBackNote}</span>
            <input
              className="laci-input"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </Dialog>
      ) : null}
    </section>
  );
}

/** Promote an entry to another environment, after a diff. */
export function PromoteDialog(props: { entry: ApiEntry; onClose: () => void; onDone: () => void }) {
  const { api, messages, session, notify } = useEditor();
  const { entry } = props;
  const targets = session.environments.filter((name) => name !== entry.environment);
  const [to, setTo] = useState(targets[0] ?? '');
  const [all, setAll] = useState(false);
  const [plan, setPlan] = useState<PromoteChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = (dryRun: boolean) => {
    const single = !all && plan?.[0];
    return api.promote(entry.key, {
      from: entry.environment,
      to,
      kind: entry.kind,
      locale: entry.locale,
      channel: entry.channel,
      all,
      dryRun,
      ...(single && !dryRun
        ? {
            sourceVersion: single.source.version,
            expectedVersion: single.previous?.version ?? 0,
          }
        : {}),
    });
  };
  const run = async (dryRun: boolean) => {
    setError(null);
    try {
      const { changes } = await request(dryRun);
      if (dryRun) {
        setPlan(changes);
        return;
      }
      notify(
        messages.promoteDone(changes.filter((change) => change.action !== 'unchanged').length, to),
      );
      props.onDone();
    } catch (caught) {
      setError(isConflict(caught) ? messages.conflict : errorText(caught));
    }
  };
  const pending = plan?.filter((change) => change.action !== 'unchanged') ?? [];
  return (
    <Dialog
      wide
      title={messages.promoteTitle(entry.key)}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="laci-button" onClick={props.onClose}>
            {messages.cancel}
          </button>
          <span className="laci-spacer" />
          <button type="button" className="laci-button" onClick={() => void run(true)}>
            {messages.promotePreview}
          </button>
          <button
            type="button"
            className={`laci-button laci-button-primary${to === 'production' ? ' laci-button-danger' : ''}`}
            disabled={pending.length === 0}
            onClick={() => void run(false)}
          >
            {messages.promoteConfirm(to)}
          </button>
        </>
      }
    >
      <div className="laci-row">
        <span>
          {messages.promoteFrom} <strong>{entry.environment}</strong>
        </span>
        <label className="laci-row">
          {messages.promoteTo}
          <select
            className="laci-input laci-input-narrow"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPlan(null);
            }}
          >
            {targets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {entry.kind === 'CONFIG' ? null : (
          <label className="laci-row">
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => {
                setAll(event.target.checked);
                setPlan(null);
              }}
            />
            {messages.promoteAll}
          </label>
        )}
      </div>
      {to === 'production' ? <Notice tone="warn">{messages.productionWarning}</Notice> : null}
      {plan && pending.length === 0 ? <Notice tone="ok">{messages.promoteNothing}</Notice> : null}
      {plan?.map((change) => (
        <div key={change.entry.id} className="laci-promote-change">
          <div className="laci-row">
            <span className={`laci-pill laci-promote-${change.action}`}>
              {messages.promoteActions[change.action]}
            </span>
            <code className="laci-mono">
              {[change.entry.key, change.entry.locale, change.entry.channel]
                .filter(Boolean)
                .join(' · ')}
            </code>
          </div>
          {change.action === 'unchanged' ? null : (
            <DiffView
              before={{
                value: change.previous?.value,
                schema: change.previous?.schema ?? change.entry.schema,
              }}
              after={{ value: change.entry.value, schema: change.entry.schema }}
              beforeLabel={
                change.previous ? `${to} v${change.previous.version}` : `${to} (${messages.none})`
              }
              afterLabel={`${entry.environment} v${change.source.version}`}
            />
          )}
        </div>
      ))}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Dialog>
  );
}
