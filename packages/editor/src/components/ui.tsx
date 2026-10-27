import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { EntryStatus } from '@lacijs/core';
import { useEditor } from '../context';

const paths = {
  config: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  message: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  schema: (
    <>
      <path d="M12 3v18" />
      <path d="M3 12h18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  warning: (
    <>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  logo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18" />
      <path d="M10 8h4" />
      <path d="M10 16h4" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon(props: { name: IconName; size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[props.name]}
    </svg>
  );
}

export function StatusBadge(props: { status: EntryStatus }) {
  const { messages } = useEditor();
  return (
    <span className={`laci-pill laci-status-${props.status.toLowerCase()}`}>
      {messages.statuses[props.status]}
    </span>
  );
}

/** A modal dialog; Escape and the backdrop close it. */
export function Dialog(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { messages } = useEditor();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const focusable = ref.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not(.laci-dialog-close)',
    );
    focusable?.focus();
  }, []);
  return (
    <div
      className="laci-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`laci-dialog${props.wide ? ' laci-dialog-wide' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="laci-dialog-head">
          <h2 id={titleId}>{props.title}</h2>
          <button
            type="button"
            className="laci-icon-button laci-dialog-close"
            aria-label={messages.close}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="laci-dialog-body">{props.children}</div>
        {props.footer ? <div className="laci-dialog-foot">{props.footer}</div> : null}
      </div>
    </div>
  );
}

/** Tabs as buttons; the content is up to the caller. */
export function Tabs<T extends string>(props: {
  tabs: readonly { id: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  variant?: 'underline' | 'segmented';
}) {
  return (
    <div
      role="tablist"
      aria-label={props.label}
      className={props.variant === 'segmented' ? 'laci-segmented' : 'laci-tabs'}
    >
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === props.value}
          className={tab.id === props.value ? 'laci-tab laci-tab-active' : 'laci-tab'}
          onClick={() => {
            props.onChange(tab.id);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** A warning or error box. */
export function Notice(props: { tone: 'warn' | 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div
      className={`laci-notice laci-notice-${props.tone}`}
      role={props.tone === 'error' ? 'alert' : undefined}
    >
      <Icon name={props.tone === 'ok' ? 'check' : 'warning'} size={16} />
      <div>{props.children}</div>
    </div>
  );
}

/** A labelled input row used by the template forms. */
export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  hint?: ReactNode;
  errors?: readonly string[];
  register?: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onFocus?: () => void;
  placeholder?: string;
}) {
  const {
    label,
    value,
    onChange,
    multiline,
    rows,
    mono,
    hint,
    errors = [],
    register,
    onFocus,
    placeholder,
  } = props;
  const id = useId();
  const className = `laci-input${mono ? ' laci-mono' : ''}${multiline ? ' laci-textarea' : ''}`;
  return (
    <div className={`laci-field${errors.length > 0 ? ' laci-invalid' : ''}`}>
      <div className="laci-field-head">
        <label htmlFor={id} className="laci-label">
          {label}
        </label>
        {hint ? <span className="laci-spacer" /> : null}
        {hint ? <span className="laci-muted laci-small">{hint}</span> : null}
      </div>
      {multiline ? (
        <textarea
          id={id}
          ref={register}
          className={className}
          rows={rows ?? 6}
          value={value}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : (
        <input
          id={id}
          ref={register}
          className={className}
          value={value}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
      {errors.map((message) => (
        <p key={message} className="laci-error" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}
