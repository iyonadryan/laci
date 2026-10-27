import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntryKind, MessageChannel } from '@lacijs/core';
import { createApi } from './api';
import type { ApiOptions, Session } from './api';
import { Icon } from './components/ui';
import type { IconName } from './components/ui';
import { EditorContext, useLoad } from './context';
import type { EditorContextValue, View } from './context';
import { defaultMessages } from './messages';
import type { Messages } from './messages';
import { ConfigPage } from './pages/ConfigPage';
import { EmailPage } from './pages/EmailPage';
import { HistoryPage } from './pages/HistoryPage';
import { MessagePage } from './pages/MessagePage';
import { NewEntryPage } from './pages/NewEntryPage';

export interface LaciEditorProps extends ApiOptions {
  /** Texts to replace, e.g. a translation; the rest stays English. */
  messages?: Partial<Messages>;
  /** The page to open first. Default: Global Configuration. */
  initialView?: View;
  /** Called when the page changes, e.g. to keep it in the URL (see {@link viewToHash}). */
  onNavigate?: (view: View) => void;
  className?: string;
}

/**
 * The Laci editor: configs, email templates, message templates, history, and the schema
 * builder, over the studio API (`@lacijs/studio`).
 */
export function LaciEditor(props: LaciEditorProps) {
  const { apiUrl, headers, fetch: fetchOption } = props;
  const api = useMemo(
    () =>
      createApi({
        ...(apiUrl === undefined ? {} : { apiUrl }),
        ...(headers === undefined ? {} : { headers }),
        ...(fetchOption === undefined ? {} : { fetch: fetchOption }),
      }),
    [apiUrl, headers, fetchOption],
  );
  const messages = useMemo(() => ({ ...defaultMessages, ...props.messages }), [props.messages]);
  const session = useLoad(() => api.session(), [apiUrl]);
  if (!session.data) {
    return (
      <div className={`laci-editor laci-centered ${props.className ?? ''}`}>
        {session.error ? (
          <div className="laci-notice laci-notice-error" role="alert">
            {messages.loadFailed(session.error)}{' '}
            <button
              type="button"
              className="laci-button laci-button-small"
              onClick={session.reload}
            >
              {messages.retry}
            </button>
          </div>
        ) : (
          <span className="laci-muted">{messages.loading}</span>
        )}
      </div>
    );
  }
  return <Editor {...props} api={api} messages={messages} session={session.data} />;
}

function Editor(
  props: LaciEditorProps & { api: EditorContextValue['api']; messages: Messages; session: Session },
) {
  const { api, messages, session, onNavigate } = props;
  const [environment, setEnvironment] = useState(session.environment);
  const [view, setView] = useState<View>(props.initialView ?? { page: 'config' });
  const [notice, setNotice] = useState<string | null>(null);
  const counts = useLoad(() => api.list({ environment, limit: 500 }), [environment]);
  const { reload } = counts;
  const navigate = useCallback(
    (next: View) => {
      setView(next);
      onNavigate?.(next);
    },
    [onNavigate],
  );
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, 3000);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);
  const context = useMemo<EditorContextValue>(
    () => ({ api, messages, session, environment, navigate, changed: reload, notify: setNotice }),
    [api, messages, session, environment, navigate, reload],
  );
  const count = (kind: EntryKind) =>
    new Set(
      (counts.data?.items ?? []).filter((entry) => entry.kind === kind).map((entry) => entry.key),
    ).size;
  const firstChannel = session.channels[0] as MessageChannel;
  const nav: { view: View; label: string; icon: IconName; count?: number; active: boolean }[][] = [
    [
      {
        view: { page: 'config' },
        label: messages.navConfig,
        icon: 'config',
        count: count('CONFIG'),
        active: view.page === 'config',
      },
      {
        view: { page: 'email' },
        label: messages.navEmail,
        icon: 'email',
        count: count('EMAIL_TEMPLATE'),
        active: view.page === 'email',
      },
      {
        view: { page: 'message', channel: firstChannel },
        label: messages.navMessage,
        icon: 'message',
        count: count('MESSAGE_TEMPLATE'),
        active: view.page === 'message',
      },
    ],
    [
      {
        view: { page: 'history' },
        label: messages.navHistory,
        icon: 'history',
        active: view.page === 'history',
      },
      {
        view: { page: 'new' },
        label: messages.navSchema,
        icon: 'schema',
        active: view.page === 'new',
      },
    ],
  ];
  const actor = session.user?.name ?? session.user?.id ?? messages.anonymous;
  const page = (() => {
    switch (view.page) {
      case 'config':
        return <ConfigPage selected={view.key} onEnvironment={setEnvironment} />;
      case 'email':
        return (
          <EmailPage selected={view.key} locale={view.locale} onEnvironment={setEnvironment} />
        );
      case 'message':
        return (
          <MessagePage
            key={view.channel}
            channel={view.channel}
            selected={view.key}
            locale={view.locale}
            onEnvironment={setEnvironment}
          />
        );
      case 'history':
        return <HistoryPage onEnvironment={setEnvironment} />;
      case 'new':
        return (
          <NewEntryPage
            key={`${view.kind ?? ''}:${view.channel ?? ''}`}
            kind={view.kind}
            channel={view.channel}
            onEnvironment={setEnvironment}
          />
        );
    }
  })();
  return (
    <EditorContext.Provider value={context}>
      <div className={`laci-editor ${props.className ?? ''}`}>
        <nav className="laci-sidebar" aria-label={messages.appName}>
          <div className="laci-brand">
            <span className="laci-logo">
              <Icon name="logo" />
            </span>
            <span className="laci-brand-text">
              <strong>{messages.appName}</strong>
              <span className="laci-small">{messages.appTagline}</span>
            </span>
          </div>
          {nav.map((group, index) => (
            <div key={index} className="laci-nav-group">
              <span className="laci-nav-title">
                {index === 0 ? messages.navContent : messages.navManage}
              </span>
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-current={item.active ? 'page' : undefined}
                  className={item.active ? 'laci-nav laci-nav-on' : 'laci-nav'}
                  onClick={() => {
                    navigate(item.view);
                  }}
                >
                  <Icon name={item.icon} />
                  <span className="laci-spacer">{item.label}</span>
                  {item.count === undefined ? null : (
                    <span className="laci-nav-count">{item.count}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          <div className="laci-runtime">
            <span className="laci-runtime-dot" aria-hidden="true" />
            <span className="laci-brand-text">
              <strong>{messages.runtime(session.runtime)}</strong>
              <span className="laci-small">{messages.actor(actor)}</span>
            </span>
          </div>
        </nav>
        <main className="laci-main">{page}</main>
        {notice ? (
          <div className="laci-toast" role="status">
            {notice}
          </div>
        ) : null}
      </div>
    </EditorContext.Provider>
  );
}

/** `view` as a URL hash, e.g. `#/email/approval-request?locale=en`. */
export function viewToHash(view: View): string {
  const params = new URLSearchParams();
  if ('locale' in view && view.locale) params.set('locale', view.locale);
  if (view.page === 'new' && view.kind) params.set('kind', view.kind);
  if (view.page === 'new' && view.channel) params.set('channel', view.channel);
  const query = params.toString() === '' ? '' : `?${params.toString()}`;
  const parts: string[] = [view.page];
  if (view.page === 'message') parts.push(view.channel);
  if ('key' in view && view.key) parts.push(encodeURIComponent(view.key));
  return `#/${parts.join('/')}${query}`;
}

/** The view of a URL hash made by {@link viewToHash}; `undefined` when it is not one. */
export function hashToView(hash: string): View | undefined {
  const match = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash);
  if (!match) return undefined;
  const [page, ...rest] = (match[1] as string).split('/').map(decodeURIComponent);
  const params = new URLSearchParams(match[2] ?? '');
  const locale = params.get('locale') ?? undefined;
  switch (page) {
    case 'config':
      return { page, ...(rest[0] ? { key: rest[0] } : {}) };
    case 'email':
      return { page, ...(rest[0] ? { key: rest[0] } : {}), ...(locale ? { locale } : {}) };
    case 'message': {
      const channel = rest[0] as MessageChannel | undefined;
      if (!channel) return undefined;
      return { page, channel, ...(rest[1] ? { key: rest[1] } : {}), ...(locale ? { locale } : {}) };
    }
    case 'history':
      return { page };
    case 'new': {
      const kind = params.get('kind') as EntryKind | null;
      const channel = params.get('channel') as MessageChannel | null;
      return { page, ...(kind ? { kind } : {}), ...(channel ? { channel } : {}) };
    }
    default:
      return undefined;
  }
}
