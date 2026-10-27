import { useState } from 'react';
import type { ApiEntry } from '../api';
import { EntryHeader, PageHeader } from '../components/entry';
import { HistoryTimeline, selectorOf } from '../components/Review';
import { Notice, StatusBadge } from '../components/ui';
import { relativeTime, useEditor, useLoad } from '../context';

const describe = (entry: ApiEntry) => [entry.locale, entry.channel].filter(Boolean).join(' · ');

/** Every entry of the environment, most recently changed first, with its versions. */
export function HistoryPage(props: { onEnvironment: (environment: string) => void }) {
  const { api, messages, environment, changed } = useEditor();
  const list = useLoad(() => api.list({ environment, limit: 500 }), [environment]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = [...(list.data?.items ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const entry = useLoad(
    () => (selected ? api.entry(selected.key, selectorOf(selected)) : Promise.resolve(null)),
    [selected?.id, selected?.version],
  );
  const refresh = () => {
    list.reload();
    entry.reload();
    changed();
  };
  return (
    <>
      <PageHeader
        crumb={`${messages.navManage} / ${messages.navHistory}`}
        title={messages.navHistory}
        onEnvironment={props.onEnvironment}
      />
      <div className="laci-body">
        <section className="laci-list-pane" aria-label={messages.recentChanges}>
          <h3>{messages.recentChanges}</h3>
          {list.error ? <Notice tone="error">{messages.loadFailed(list.error)}</Notice> : null}
          {!list.loading && entries.length === 0 ? (
            <span className="laci-muted">{messages.noEntries}</span>
          ) : null}
          <ul className="laci-entries">
            {entries.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={item.id === selectedId ? 'true' : undefined}
                  className={item.id === selectedId ? 'laci-entry laci-entry-on' : 'laci-entry'}
                  onClick={() => {
                    setSelectedId(item.id);
                  }}
                >
                  <span className="laci-row">
                    <span className="laci-mono laci-entry-key">{item.key}</span>
                    <StatusBadge status={item.status} />
                  </span>
                  <span className="laci-muted laci-small">
                    {messages.kindLabels[item.kind].label}
                    {describe(item) ? ` · ${describe(item)}` : ''}
                  </span>
                  <span className="laci-muted laci-small">
                    {messages.versionMeta(
                      item.version,
                      relativeTime(item.updatedAt),
                      item.updatedBy,
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="laci-panel laci-editor-pane" aria-label={messages.historyTitle}>
          {entry.data ? (
            <>
              <EntryHeader
                key={entry.data.version}
                entry={entry.data}
                dirty={false}
                onChanged={refresh}
              />
              <HistoryTimeline entry={entry.data} onRolledBack={refresh} />
            </>
          ) : (
            <p className="laci-muted laci-empty">{messages.selectEntry}</p>
          )}
        </section>
      </div>
    </>
  );
}
