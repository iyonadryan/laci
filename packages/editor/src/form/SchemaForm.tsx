import { createContext, useContext, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { JsonSchema, JsonValue } from '@lacijs/core';
import { contrastRatio, MIN_CONTRAST } from '../model/contrast';
import { formatPath, isObject, omit, pretty, sameJson, textOf } from '../model/json';
import type { PathSegment } from '../model/json';
import { child, defaultValue, fieldKind, typeOf } from '../model/schema';
import type { FieldKind } from '../model/schema';
import { defaultMessages } from '../messages';
import type { Messages } from '../messages';

/** A validation problem at a path, as `POST api/validate` reports it. */
export interface FormIssue {
  path: string;
  message: string;
}

export interface SchemaFormProps {
  schema: JsonSchema;
  value: JsonValue | undefined;
  /** The saved value: fields that differ from it are marked as modified. */
  original?: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  /** Shown at their fields. */
  issues?: readonly FormIssue[];
  messages?: Messages;
  /** Called with the path of the field that gets focus, e.g. for a breadcrumb. */
  onFocusPath?: (path: readonly PathSegment[]) => void;
}

interface FormState {
  messages: Messages;
  errors: Map<string, string[]>;
  onFocusPath: ((path: readonly PathSegment[]) => void) | undefined;
}

const FormContext = createContext<FormState>({
  messages: defaultMessages,
  errors: new Map(),
  onFocusPath: undefined,
});

/** A form for `value`, generated from `schema`, as deep as the schema goes. */
export function SchemaForm(props: SchemaFormProps) {
  const { issues = [], messages = defaultMessages, onFocusPath } = props;
  const state = useMemo<FormState>(() => {
    const errors = new Map<string, string[]>();
    for (const issue of issues)
      errors.set(issue.path, [...(errors.get(issue.path) ?? []), issue.message]);
    return { messages, errors, onFocusPath };
  }, [issues, messages, onFocusPath]);
  return (
    <FormContext.Provider value={state}>
      <div className="laci-form">
        <Field
          schema={props.schema}
          value={props.value}
          original={props.original}
          path={[]}
          onChange={props.onChange}
          required
        />
      </div>
    </FormContext.Provider>
  );
}

interface FieldProps {
  schema: JsonSchema;
  value: JsonValue | undefined;
  original: JsonValue | undefined;
  path: readonly PathSegment[];
  onChange: (value: JsonValue | undefined) => void;
  /** The property name; none for list items and the root. */
  name?: string;
  required?: boolean;
  /** Shown instead of the label, e.g. in a list item's header. */
  hideLabel?: boolean;
}

/** Whether `value` fits the input of `kind` (an unset value always does). */
function fits(kind: FieldKind, schema: JsonSchema, value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (value === null) return typeOf(schema).nullable || kind === 'null' || kind === 'unknown';
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return (schema.enum as JsonValue[]).some((option) => sameJson(option, value));
    case 'object':
    case 'map':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

const isPrimitiveKind = (kind: FieldKind) =>
  kind === 'string' ||
  kind === 'number' ||
  kind === 'integer' ||
  kind === 'boolean' ||
  kind === 'enum';

function Field(props: FieldProps) {
  const { schema, value, original, path } = props;
  const { messages, errors, onFocusPath } = useContext(FormContext);
  const id = useId();
  const kind = fieldKind(schema);
  const pathText = formatPath(path);
  const own = errors.get(pathText) ?? [];
  const changed = !sameJson(value, original);
  const label = typeof schema.title === 'string' ? schema.title : props.name;
  const help = typeof schema.description === 'string' ? schema.description : null;
  const mismatch = !fits(kind, schema, value);
  const { nullable } = typeOf(schema);

  let input: ReactNode;
  if (mismatch) {
    input = (
      <>
        <p className="laci-warning">{messages.mismatch}</p>
        <JsonField id={id} value={value} onChange={props.onChange} />
      </>
    );
  } else if (value === null && nullable && kind !== 'null') {
    input = (
      <div className="laci-row">
        <span className="laci-muted">{messages.noValue}</span>
        <button
          type="button"
          className="laci-button laci-button-small"
          onClick={() => {
            props.onChange(defaultValue({ ...schema, type: typeOf(schema).type ?? 'string' }));
          }}
        >
          {messages.setValue}
        </button>
      </div>
    );
  } else {
    switch (kind) {
      case 'object':
        input = <ObjectField {...props} />;
        break;
      case 'map':
        input = <MapField {...props} />;
        break;
      case 'array':
        input = <ArrayField {...props} />;
        break;
      case 'null':
        input = <code className="laci-muted">null</code>;
        break;
      case 'unknown':
        input = <JsonField id={id} value={value} onChange={props.onChange} />;
        break;
      default:
        input = <PrimitiveField {...props} id={id} kind={kind} />;
    }
  }

  const container = kind === 'object' || kind === 'map' || kind === 'array';
  const showLabel = !props.hideLabel && label !== undefined;
  const clearable =
    (nullable && value !== null && value !== undefined && kind !== 'null') ||
    (!props.required && value !== undefined && props.name !== undefined);
  return (
    <div
      className={[
        'laci-field',
        container && !mismatch ? 'laci-field-wide' : '',
        changed ? 'laci-changed' : '',
        own.length > 0 ? 'laci-invalid' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onFocus={(event) => {
        // Only the innermost field reports its path.
        event.stopPropagation();
        onFocusPath?.(path);
      }}
    >
      {showLabel || clearable ? (
        <div className="laci-field-head">
          {showLabel ? (
            <label htmlFor={id} className="laci-label">
              {label}
              {props.required && props.name !== undefined ? (
                <span className="laci-required" aria-label={messages.required}>
                  {' '}
                  *
                </span>
              ) : null}
            </label>
          ) : null}
          {changed && path.length > 0 && isPrimitiveKind(kind) ? (
            <span className="laci-pill laci-pill-warn">{messages.modified}</span>
          ) : null}
          {clearable ? (
            <button
              type="button"
              className="laci-link-button"
              onClick={() => {
                props.onChange(nullable ? null : undefined);
              }}
            >
              {messages.clearValue}
            </button>
          ) : null}
        </div>
      ) : null}
      {help ? <p className="laci-help">{help}</p> : null}
      {input}
      {own.map((message) => (
        <p key={message} className="laci-error" role="alert">
          {message}
        </p>
      ))}
    </div>
  );
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** `+07:00` for the browser's time zone now. */
function localOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** UTC offsets from -12:00 to +14:00, every half hour. */
const OFFSETS = Array.from({ length: 53 }, (_, index) => {
  const minutes = -720 + index * 30;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
});

function PrimitiveField(props: FieldProps & { id: string; kind: FieldKind }) {
  const { schema, value, onChange, id, kind } = props;
  const { messages } = useContext(FormContext);
  const format = typeof schema.format === 'string' ? schema.format : null;

  if (kind === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        className="laci-checkbox"
        checked={value === true}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    );
  }
  if (kind === 'enum') {
    const options = schema.enum as JsonValue[];
    const index = options.findIndex((option) => sameJson(option, value));
    return (
      <select
        id={id}
        className="laci-input"
        value={index === -1 ? '' : String(index)}
        onChange={(event) => {
          onChange(event.target.value === '' ? undefined : options[Number(event.target.value)]);
        }}
      >
        {index === -1 || !props.required ? <option value="">{messages.noValue}</option> : null}
        {options.map((option, position) => (
          <option key={JSON.stringify(option)} value={String(position)}>
            {typeof option === 'string' ? option : JSON.stringify(option)}
          </option>
        ))}
      </select>
    );
  }
  if (kind === 'number' || kind === 'integer') {
    return (
      <input
        id={id}
        type="number"
        className="laci-input laci-mono"
        step={kind === 'integer' ? 1 : 'any'}
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(event) => {
          const text = event.target.value;
          onChange(text === '' ? undefined : Number(text));
        }}
      />
    );
  }

  const text = typeof value === 'string' ? value : '';
  const setText = (next: string) => {
    onChange(next);
  };
  if (format === 'color') {
    const ratioHint = /^#[0-9a-f]{6}$/i.test(text)
      ? text
      : /^#[0-9a-f]{3}$/i.test(text)
        ? `#${Array.from(text.slice(1), (digit) => digit + digit).join('')}`
        : '#000000';
    return (
      <div className="laci-row">
        <span
          className="laci-swatch"
          style={{ background: text || 'transparent' }}
          aria-hidden="true"
        />
        <input
          type="color"
          aria-label={`${props.name ?? 'color'} picker`}
          className="laci-color"
          value={ratioHint.toLowerCase()}
          onChange={(event) => {
            setText(event.target.value.toUpperCase());
          }}
        />
        <input
          id={id}
          className="laci-input laci-mono"
          value={text}
          placeholder="#RRGGBB"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
    );
  }
  if (format === 'date') {
    return (
      <input
        id={id}
        type="date"
        className="laci-input"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
    );
  }
  if (format === 'date-time') {
    const match = DATE_TIME.exec(text);
    const local = match ? (match[1] as string) : '';
    const offset = match ? (match[2] as string) : localOffset();
    const offsets = OFFSETS.includes(offset) || offset === 'Z' ? OFFSETS : [...OFFSETS, offset];
    const compose = (nextLocal: string, nextOffset: string) => {
      setText(nextLocal === '' ? '' : `${nextLocal}:00${nextOffset}`);
    };
    return (
      <div className="laci-row">
        <input
          id={id}
          type="datetime-local"
          className="laci-input"
          value={local}
          onChange={(event) => {
            compose(event.target.value, offset);
          }}
        />
        <select
          aria-label={messages.timeOffset}
          className="laci-input laci-input-narrow"
          value={offset}
          onChange={(event) => {
            compose(local, event.target.value);
          }}
        >
          <option value="Z">UTC (Z)</option>
          {offsets.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {text !== '' && !match ? <code className="laci-muted">{text}</code> : null}
      </div>
    );
  }
  const long =
    text.includes('\n') || (typeof schema.maxLength === 'number' && schema.maxLength > 200);
  if (long) {
    return (
      <textarea
        id={id}
        className="laci-input laci-textarea"
        rows={4}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
    );
  }
  return (
    <input
      id={id}
      type={format === 'uri' ? 'url' : format === 'email' ? 'email' : 'text'}
      className="laci-input"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
    />
  );
}

/** Edits any JSON value as text; applied once it parses. */
function JsonField(props: {
  id: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
}) {
  const { messages } = useContext(FormContext);
  const [text, setText] = useState(() => (props.value === undefined ? '' : pretty(props.value)));
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <textarea
        id={props.id}
        aria-label={messages.editAsJson}
        className="laci-input laci-textarea laci-mono"
        rows={Math.min(12, Math.max(2, text.split('\n').length))}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === '') {
            setError(null);
            props.onChange(undefined);
            return;
          }
          try {
            props.onChange(JSON.parse(next) as JsonValue);
            setError(null);
          } catch (caught) {
            setError(messages.invalidJson((caught as Error).message));
          }
        }}
      />
      {error ? <p className="laci-error">{error}</p> : null}
    </>
  );
}

function ObjectField(props: FieldProps) {
  const { schema, path, onChange } = props;
  const value = isObject(props.value) ? props.value : {};
  const original = isObject(props.original) ? props.original : undefined;
  const properties = child(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const extra = Object.keys(value).filter((key) => !(key in properties));
  const set = (key: string, next: JsonValue | undefined) => {
    onChange(next === undefined ? omit(value, key) : { ...value, [key]: next });
  };
  return (
    <div className={path.length === 0 ? 'laci-grid' : 'laci-grid laci-nested'}>
      {[...Object.keys(properties), ...extra].map((key) => (
        <Field
          key={key}
          name={key}
          schema={child(properties[key])}
          value={value[key]}
          original={original?.[key]}
          path={[...path, key]}
          required={required.has(key)}
          onChange={(next) => {
            set(key, next);
          }}
        />
      ))}
    </div>
  );
}

function MapField(props: FieldProps) {
  const { schema, path, onChange } = props;
  const { messages } = useContext(FormContext);
  const value = isObject(props.value) ? props.value : {};
  const original = isObject(props.original) ? props.original : undefined;
  const valueSchema = child(schema.additionalProperties);
  const keys = Object.keys(value);
  const rename = (from: string, to: string) => {
    if (to === from || to === '' || to in value) return;
    onChange(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key === from ? to : key, item]),
      ),
    );
  };
  return (
    <div className="laci-map">
      {keys.map((key) => (
        <div key={key} className="laci-map-row">
          <MapKey
            value={key}
            label={messages.keyName}
            onRename={(next) => {
              rename(key, next);
            }}
          />
          <div className="laci-map-value">
            <Field
              schema={valueSchema}
              value={value[key]}
              original={original?.[key]}
              path={[...path, key]}
              required
              onChange={(next) => {
                onChange({ ...value, [key]: next ?? defaultValue(valueSchema) });
              }}
            />
          </div>
          <button
            type="button"
            className="laci-link-button laci-danger"
            aria-label={messages.removeKey(key)}
            onClick={() => {
              onChange(omit(value, key));
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="laci-button laci-button-dashed"
        onClick={() => {
          let index = keys.length + 1;
          while (`key${index}` in value) index++;
          onChange({ ...value, [`key${index}`]: defaultValue(valueSchema) });
        }}
      >
        {messages.addKey}
      </button>
    </div>
  );
}

/** A map key, renamed when the input loses focus. */
function MapKey(props: { value: string; label: string; onRename: (key: string) => void }) {
  const [text, setText] = useState(props.value);
  return (
    <input
      aria-label={props.label}
      className="laci-input laci-mono laci-map-key"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onBlur={() => {
        if (text.trim() === '') setText(props.value);
        else props.onRename(text.trim());
      }}
    />
  );
}

/** How many errors are at `path` or below it. */
function errorsBelow(errors: Map<string, string[]>, path: string): number {
  let count = 0;
  for (const [key, list] of errors) {
    if (path === '' || key === path || key.startsWith(`${path}.`) || key.startsWith(`${path}[`)) {
      count += list.length;
    }
  }
  return count;
}

/** A short title for a list item: its first texts, e.g. "JKT01 · Customer Sunter". */
function summary(item: JsonValue | undefined): string {
  if (isObject(item)) {
    return Object.values(item)
      .filter(
        (part): part is string | number => typeof part === 'string' || typeof part === 'number',
      )
      .slice(0, 2)
      .join(' · ');
  }
  if (Array.isArray(item)) return `${item.length}`;
  return item === undefined || item === null ? '' : String(item);
}

/** The background and text color properties of a list item, for a badge preview. */
function colorPair(
  schema: JsonSchema,
): { background: string; text: string; label: string | null } | null {
  const properties = child(schema.properties);
  const colors = Object.keys(properties).filter((key) => child(properties[key]).format === 'color');
  const background = colors.find((key) => /background|bg/i.test(key));
  const text = colors.find((key) => key !== background && /text|foreground|fg|color/i.test(key));
  if (!background || !text) return null;
  const label = ['label', 'name', 'title'].find((key) => key in properties) ?? null;
  return { background, text, label };
}

function ArrayField(props: FieldProps) {
  const { schema, path, onChange } = props;
  const { messages, errors } = useContext(FormContext);
  const items = Array.isArray(props.value) ? props.value : [];
  const original = Array.isArray(props.original) ? props.original : undefined;
  const itemSchema = child(schema.items);
  const itemKind = fieldKind(itemSchema);
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => new Set(items.length > 3 ? items.map((_, index) => index).slice(1) : []),
  );

  const plain =
    (itemKind === 'string' && typeof itemSchema.format !== 'string') ||
    itemKind === 'number' ||
    itemKind === 'integer';
  if (plain) {
    return (
      <Chips
        values={items}
        numeric={itemKind !== 'string'}
        label={messages.addValue(props.name ?? messages.listItem)}
        onChange={onChange}
      />
    );
  }

  const pair = itemKind === 'object' ? colorPair(itemSchema) : null;
  const move = (from: number, to: number) => {
    const copy = [...items];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved as JsonValue);
    onChange(copy);
  };
  const allCollapsed = items.length > 0 && collapsed.size === items.length;
  return (
    <div className="laci-list">
      <div className="laci-row">
        <span className="laci-muted">{messages.items(items.length)}</span>
        <span className="laci-spacer" />
        {items.length > 1 ? (
          <button
            type="button"
            className="laci-link-button"
            onClick={() => {
              setCollapsed(allCollapsed ? new Set() : new Set(items.map((_, index) => index)));
            }}
          >
            {allCollapsed ? messages.expandAll : messages.collapseAll}
          </button>
        ) : null}
      </div>
      {items.map((item, index) => {
        const itemPath = [...path, index];
        const label = formatPath(itemPath);
        const errorCount = errorsBelow(errors, label);
        const isCollapsed = collapsed.has(index);
        const changed = !sameJson(item, original?.[index]);
        const toggle = () => {
          const next = new Set(collapsed);
          if (isCollapsed) next.delete(index);
          else next.add(index);
          setCollapsed(next);
        };
        return (
          <div key={index} className={`laci-card${errorCount > 0 ? ' laci-card-invalid' : ''}`}>
            <div className="laci-card-head">
              <span className="laci-mono laci-muted">[{index}]</span>
              <span className="laci-card-title">{summary(item)}</span>
              {pair && isObject(item) ? (
                <ColorBadge
                  background={textOf(item[pair.background])}
                  text={textOf(item[pair.text])}
                  label={pair.label ? textOf(item[pair.label]) : summary(item)}
                />
              ) : null}
              {changed ? (
                <span className="laci-pill laci-pill-warn">{messages.modified}</span>
              ) : null}
              {errorCount > 0 ? (
                <span className="laci-pill laci-pill-error">
                  {messages.errorsInside(errorCount)}
                </span>
              ) : null}
              <span className="laci-spacer" />
              <button
                type="button"
                className="laci-icon-button"
                aria-label={`${messages.moveUp} ${label}`}
                disabled={index === 0}
                onClick={() => {
                  move(index, index - 1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="laci-icon-button"
                aria-label={`${messages.moveDown} ${label}`}
                disabled={index === items.length - 1}
                onClick={() => {
                  move(index, index + 1);
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="laci-link-button"
                aria-label={`${messages.duplicateItem} ${label}`}
                onClick={() => {
                  const copy = [...items];
                  copy.splice(index + 1, 0, structuredClone(item));
                  onChange(copy);
                }}
              >
                {messages.duplicateItem}
              </button>
              <button
                type="button"
                className="laci-link-button laci-danger"
                aria-label={`${messages.removeItem} ${label}`}
                onClick={() => {
                  onChange(items.filter((_, position) => position !== index));
                  setCollapsed(new Set());
                }}
              >
                {messages.removeItem}
              </button>
              <button
                type="button"
                className="laci-link-button"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? messages.expand : messages.collapse} ${label}`}
                onClick={toggle}
              >
                {isCollapsed ? messages.expand : messages.collapse}
              </button>
            </div>
            {isCollapsed ? null : (
              <div className="laci-card-body">
                <Field
                  schema={itemSchema}
                  value={item}
                  original={original?.[index]}
                  path={itemPath}
                  required
                  hideLabel
                  onChange={(next) => {
                    const copy = [...items];
                    copy[index] = next ?? defaultValue(itemSchema);
                    onChange(copy);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="laci-button laci-button-dashed"
        onClick={() => {
          onChange([...items, defaultValue(itemSchema)]);
        }}
      >
        {messages.addItem}
      </button>
    </div>
  );
}

/** A preview badge with the contrast of its colors. */
export function ColorBadge(props: { background: string; text: string; label: string }) {
  const { messages } = useContext(FormContext);
  const ratio = contrastRatio(props.text, props.background);
  return (
    <span className="laci-row">
      <span
        className="laci-badge-preview"
        style={{ background: props.background, color: props.text }}
      >
        {props.label || '—'}
      </span>
      {ratio === null ? null : ratio < MIN_CONTRAST ? (
        <span className="laci-pill laci-pill-error">{messages.contrastLow(ratio.toFixed(1))}</span>
      ) : (
        <span className="laci-muted laci-small">{messages.contrastOk(ratio.toFixed(1))}</span>
      )}
    </span>
  );
}

/** A list of plain strings or numbers as chips. */
function Chips(props: {
  values: JsonValue[];
  numeric: boolean;
  label: string;
  onChange: (value: JsonValue[]) => void;
}) {
  const { messages } = useContext(FormContext);
  const [text, setText] = useState('');
  const add = () => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const next = props.numeric ? Number(trimmed) : trimmed;
    if (props.numeric && Number.isNaN(next)) return;
    props.onChange([...props.values, next]);
    setText('');
  };
  return (
    <div className="laci-chips">
      {props.values.map((item, index) => (
        <span key={`${index}-${textOf(item)}`} className="laci-chip">
          {typeof item === 'string' || typeof item === 'number' ? item : JSON.stringify(item)}
          <button
            type="button"
            className="laci-chip-remove"
            aria-label={messages.removeValue(textOf(item))}
            onClick={() => {
              props.onChange(props.values.filter((_, position) => position !== index));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label={props.label}
        className="laci-chip-input"
        placeholder="Add…"
        inputMode={props.numeric ? 'decimal' : 'text'}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
