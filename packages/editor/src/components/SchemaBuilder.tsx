import { useId, useState } from 'react';
import type { JsonSchema, JsonValue } from '@lacijs/core';
import { useEditor } from '../context';
import {
  BUILDER_TYPES,
  changeType,
  flattenTree,
  freeName,
  newField,
  RULES,
  schemaToTree,
  treeToSchema,
  updateField,
} from '../model/builder';
import type { BuilderType, FieldNode } from '../model/builder';
import { isObject, omit, pretty, textOf } from '../model/json';
import { inferSchema } from '../model/schema';
import { Dialog, Notice, Tabs } from './ui';

const NUMERIC_RULES = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

function find(node: FieldNode, id: string): FieldNode | null {
  if (node.id === id) return node;
  for (const field of [...node.children, ...(node.inner ? [node.inner] : [])]) {
    const found = find(field, id);
    if (found) return found;
  }
  return null;
}

function parentOf(node: FieldNode, id: string): FieldNode | null {
  for (const field of [...node.children, ...(node.inner ? [node.inner] : [])]) {
    if (field.id === id) return node;
    const parent = parentOf(field, id);
    if (parent) return parent;
  }
  return null;
}

/** The object a new field goes into when `id` is selected: itself, or the object it is in. */
function targetObject(tree: FieldNode, id: string): FieldNode | null {
  if (find(tree, id)?.type === 'object') return find(tree, id);
  const parent = parentOf(tree, id);
  return parent?.type === 'object' ? parent : null;
}

/**
 * Builds a JSON Schema as a tree of fields with a properties panel, or as raw JSON. Keywords it
 * does not know are kept.
 */
export function SchemaBuilder(props: {
  schema: JsonSchema;
  onChange: (schema: JsonSchema) => void;
  rootLabel: string;
  /** A template's variables: the root is always an object. */
  template?: boolean;
}) {
  const { messages } = useEditor();
  const [tree, setTree] = useState(() => schemaToTree(props.schema));
  const [selectedId, setSelectedId] = useState(tree.id);
  const [mode, setMode] = useState<'builder' | 'json'>('builder');
  const [jsonText, setJsonText] = useState(() => pretty(props.schema));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const commit = (next: FieldNode) => {
    setTree(next);
    const schema = treeToSchema(next);
    setJsonText(pretty(schema));
    props.onChange(schema);
  };
  const replace = (schema: JsonSchema) => {
    const next = schemaToTree(schema);
    setSelectedId(next.id);
    commit(next);
  };
  const selected = find(tree, selectedId) ?? tree;
  const rows = flattenTree(tree, props.rootLabel);
  const target = targetObject(tree, selected.id);
  const update = (change: (field: FieldNode) => FieldNode | null) => {
    commit(updateField(tree, selected.id, change));
  };
  const addField = (object: FieldNode) => {
    const field = newField('string', freeName(object));
    commit(
      updateField(tree, object.id, (node) => ({ ...node, children: [...node.children, field] })),
    );
    setSelectedId(field.id);
  };

  return (
    <div className="laci-builder">
      <div className="laci-row">
        <Tabs
          label={messages.structure}
          variant="segmented"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setJsonError(null);
          }}
          tabs={[
            { id: 'builder', label: messages.builderView },
            { id: 'json', label: messages.rawSchema },
          ]}
        />
        <span className="laci-spacer" />
        <button
          type="button"
          className="laci-button laci-button-small"
          onClick={() => {
            setImporting(true);
          }}
        >
          {messages.importSample}
        </button>
      </div>
      {mode === 'json' ? (
        <div className="laci-field">
          <textarea
            aria-label={messages.jsonSchema}
            className="laci-input laci-textarea laci-mono"
            rows={18}
            value={jsonText}
            onChange={(event) => {
              const text = event.target.value;
              setJsonText(text);
              try {
                const parsed = JSON.parse(text) as JsonValue;
                if (!isObject(parsed)) throw new Error('a schema is an object');
                setJsonError(null);
                const next = schemaToTree(parsed);
                setTree(next);
                setSelectedId(next.id);
                props.onChange(parsed);
              } catch (caught) {
                setJsonError(messages.invalidJson((caught as Error).message));
              }
            }}
          />
          {jsonError ? <p className="laci-error">{jsonError}</p> : null}
        </div>
      ) : (
        <div className="laci-builder-panes">
          <section className="laci-panel laci-builder-tree" aria-label={messages.structure}>
            <ul className="laci-tree">
              {rows.map((row) => {
                const field = row.field;
                const name =
                  field.role === 'root'
                    ? props.rootLabel
                    : field.role === 'item'
                      ? messages.listItem
                      : field.role === 'value'
                        ? messages.mapValue
                        : field.name;
                return (
                  <li
                    key={field.id}
                    className={
                      field.id === selected.id
                        ? 'laci-tree-row laci-tree-selected'
                        : 'laci-tree-row'
                    }
                  >
                    <span className="laci-tree-indent" style={{ width: row.depth * 22 }} />
                    <button
                      type="button"
                      className="laci-tree-name"
                      aria-pressed={field.id === selected.id}
                      onClick={() => {
                        setSelectedId(field.id);
                      }}
                    >
                      <span className="laci-mono">{name}</span>
                      <span className={`laci-pill laci-type-${field.type}`}>{field.type}</span>
                      {field.required ? (
                        <span className="laci-required laci-small">{messages.required}</span>
                      ) : null}
                    </button>
                    {field.type === 'object' ? (
                      <button
                        type="button"
                        className="laci-link-button"
                        aria-label={messages.addFieldTo(name)}
                        onClick={() => {
                          addField(field);
                        }}
                      >
                        {messages.addField}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {target ? (
              <button
                type="button"
                className="laci-button laci-button-dashed"
                onClick={() => {
                  addField(target);
                }}
              >
                {messages.addFieldTo(
                  target.role === 'root'
                    ? props.rootLabel
                    : target.role === 'item'
                      ? messages.listItem
                      : target.name,
                )}
              </button>
            ) : null}
          </section>
          <FieldProperties
            key={selected.id}
            field={selected}
            path={rows.find((row) => row.field.id === selected.id)?.path ?? props.rootLabel}
            siblings={
              parentOf(tree, selected.id)
                ?.children.filter((field) => field.id !== selected.id)
                .map((field) => field.name) ?? []
            }
            lockType={props.template === true && selected.role === 'root'}
            onChange={(change) => {
              update(change);
            }}
            onRemove={() => {
              update(() => null);
              setSelectedId(tree.id);
            }}
          />
        </div>
      )}
      <details className="laci-schema-preview">
        <summary>{messages.jsonSchema}</summary>
        <pre className="laci-code">{pretty(treeToSchema(tree))}</pre>
      </details>
      {importing ? (
        <ImportSample
          template={props.template === true}
          onClose={() => {
            setImporting(false);
          }}
          onApply={(schema) => {
            replace(schema);
            setImporting(false);
          }}
        />
      ) : null}
    </div>
  );
}

function FieldProperties(props: {
  field: FieldNode;
  path: string;
  siblings: string[];
  lockType: boolean;
  onChange: (change: (field: FieldNode) => FieldNode) => void;
  onRemove: () => void;
}) {
  const { messages } = useEditor();
  const { field } = props;
  const id = useId();
  const [name, setName] = useState(field.name);
  const taken = name !== field.name && props.siblings.includes(name);
  const set = (patch: Partial<FieldNode>) => {
    props.onChange((node) => ({ ...node, ...patch }));
  };
  return (
    <aside className="laci-panel laci-builder-props" aria-label={messages.selectedField}>
      <span className="laci-muted laci-small">{messages.selectedField}</span>
      <h3 className="laci-mono">{props.path}</h3>
      {field.role === 'property' ? (
        <div className="laci-field">
          <label className="laci-label" htmlFor={`${id}-name`}>
            {messages.fieldName}
          </label>
          <input
            id={`${id}-name`}
            className="laci-input laci-mono"
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (next !== '' && !props.siblings.includes(next)) set({ name: next });
            }}
          />
          {taken ? <p className="laci-error">{`"${name}" exists`}</p> : null}
        </div>
      ) : null}
      <div className="laci-field">
        <label className="laci-label" htmlFor={`${id}-type`}>
          {messages.fieldType}
        </label>
        <select
          id={`${id}-type`}
          className="laci-input"
          value={field.type}
          disabled={props.lockType}
          onChange={(event) => {
            props.onChange((node) => changeType(node, event.target.value as BuilderType));
          }}
        >
          {BUILDER_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div className="laci-field">
        <label className="laci-label" htmlFor={`${id}-title`}>
          {messages.fieldLabel}
        </label>
        <input
          id={`${id}-title`}
          className="laci-input"
          value={field.title}
          onChange={(event) => {
            set({ title: event.target.value });
          }}
        />
      </div>
      <div className="laci-field">
        <label className="laci-label" htmlFor={`${id}-help`}>
          {messages.fieldHelp}
        </label>
        <input
          id={`${id}-help`}
          className="laci-input"
          value={field.description}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
        />
      </div>
      {field.type === 'enum' ? (
        <div className="laci-field">
          <label className="laci-label" htmlFor={`${id}-options`}>
            {messages.fieldOptions}
          </label>
          <textarea
            id={`${id}-options`}
            className="laci-input laci-textarea laci-mono"
            rows={4}
            value={field.options
              .map((option) => (typeof option === 'string' ? option : JSON.stringify(option)))
              .join('\n')}
            onChange={(event) => {
              set({ options: event.target.value.split('\n').filter((line) => line !== '') });
            }}
          />
        </div>
      ) : null}
      {(RULES[field.type] ?? []).length > 0 ? (
        <div className="laci-grid">
          {(RULES[field.type] ?? []).map((rule) => {
            const current = field.rules[rule];
            return (
              <div key={rule} className="laci-field">
                <label className="laci-label" htmlFor={`${id}-${rule}`}>
                  {messages.rules[rule] ?? rule}
                </label>
                <input
                  id={`${id}-${rule}`}
                  className="laci-input laci-mono"
                  type={NUMERIC_RULES.has(rule) ? 'number' : 'text'}
                  value={textOf(current)}
                  onChange={(event) => {
                    const text = event.target.value;
                    set({
                      rules:
                        text === ''
                          ? omit(field.rules, rule)
                          : {
                              ...field.rules,
                              [rule]: NUMERIC_RULES.has(rule) ? Number(text) : text,
                            },
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      ) : null}
      {field.role === 'property' ? (
        <label className="laci-row">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => {
              set({ required: event.target.checked });
            }}
          />
          {messages.required}
        </label>
      ) : null}
      {field.type !== 'object' &&
      field.type !== 'array' &&
      field.type !== 'map' &&
      field.type !== 'any' ? (
        <label className="laci-row">
          <input
            type="checkbox"
            checked={field.nullable}
            onChange={(event) => {
              set({ nullable: event.target.checked });
            }}
          />
          {messages.fieldNullable}
        </label>
      ) : null}
      <span className="laci-label">{messages.jsonSchema}</span>
      <pre className="laci-code laci-small">{pretty(treeToSchema(field))}</pre>
      {field.role === 'property' ? (
        <button
          type="button"
          className="laci-button laci-button-danger-outline"
          onClick={props.onRemove}
        >
          {messages.removeField}
        </button>
      ) : null}
    </aside>
  );
}

function ImportSample(props: {
  template: boolean;
  onClose: () => void;
  onApply: (schema: JsonSchema) => void;
}) {
  const { messages } = useEditor();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={messages.importSample}
      onClose={props.onClose}
      footer={
        <>
          <span className="laci-spacer" />
          <button
            type="button"
            className="laci-button laci-button-primary"
            onClick={() => {
              try {
                const sample = JSON.parse(text) as JsonValue;
                if (props.template && !isObject(sample))
                  throw new Error('template data is an object');
                props.onApply(inferSchema(sample));
              } catch (caught) {
                setError(messages.invalidJson((caught as Error).message));
              }
            }}
          >
            {messages.importSampleApply}
          </button>
        </>
      }
    >
      <p className="laci-help">{messages.importSampleHint}</p>
      <textarea
        aria-label={messages.importSample}
        className="laci-input laci-textarea laci-mono"
        rows={12}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Dialog>
  );
}
