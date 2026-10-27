import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JsonSchema, JsonValue } from '@lacijs/core';
import { SchemaForm } from '../src';
import type { FormIssue } from '../src';
import { colors, customers } from './harness';

function Harness(props: {
  schema: JsonSchema;
  value: JsonValue | undefined;
  issues?: FormIssue[];
  onValue?: (value: JsonValue | undefined) => void;
  onFocusPath?: (path: readonly (string | number)[]) => void;
}) {
  const [value, setValue] = useState(props.value);
  return (
    <>
      <SchemaForm
        schema={props.schema}
        value={value}
        original={props.value}
        issues={props.issues}
        onFocusPath={props.onFocusPath}
        onChange={(next) => {
          setValue(next);
          props.onValue?.(next);
        }}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const current = () => JSON.parse(screen.getByTestId('value').textContent || 'null') as JsonValue;

describe('SchemaForm', () => {
  it('edits lists inside lists inside lists', async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    render(
      <Harness
        schema={customers.schema}
        value={customers.value}
        onFocusPath={(path) => paths.push(path.join('/'))}
      />,
    );
    expect(screen.getByLabelText(/Customer code/)).toHaveValue('JKT01');
    expect(screen.getByText('Shown to viewers')).toBeInTheDocument();
    const slots = screen.getByLabelText('Add to slots');
    await user.type(slots, '19:00{Enter}');
    expect(current()).toMatchObject([{ sessions: [{ slots: ['10:00', '14:00', '19:00'] }] }]);
    expect(paths.at(-1)).toBe('0/sessions/0/slots');
    await user.click(screen.getByRole('button', { name: 'Remove 10:00' }));
    expect(current()).toMatchObject([{ sessions: [{ slots: ['14:00', '19:00'] }] }]);
    await user.type(slots, ' {Enter}');
    await user.click(screen.getByRole('checkbox'));
    expect(current()).toMatchObject([{ isLive: false }]);
    expect(screen.getAllByText('Modified').length).toBeGreaterThan(0);

    // Lists: add, duplicate, move, remove.
    await user.click(screen.getAllByRole('button', { name: '+ Add item' }).at(-1)!);
    expect(current()).toMatchObject([
      { customerCode: 'JKT01' },
      { customerCode: '', sessions: [] },
    ]);
    await user.click(screen.getByRole('button', { name: 'Move down [0]' }));
    expect(current()).toMatchObject([{ customerCode: '' }, { customerCode: 'JKT01' }]);
    await user.click(screen.getByRole('button', { name: 'Move up [1]' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate [0]' }));
    expect((current() as unknown[]).length).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Remove [2]' }));
    expect((current() as unknown[]).length).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Collapse [1]' }));
    expect(screen.getByRole('button', { name: 'Expand [1]' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByLabelText(/Customer code/)).toHaveLength(2);
  });

  it('collapses long lists and shows errors at their fields', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      customerCode: `C${index}`,
      sessions: [],
    }));
    render(
      <Harness
        schema={customers.schema}
        value={many}
        issues={[
          { path: '[0].customerCode', message: 'must NOT have fewer than 1 characters' },
          { path: '[3].sessions', message: 'is required' },
          { path: '[3].name', message: 'is wrong' },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('must NOT have fewer than 1 characters');
    expect(screen.getAllByRole('button', { name: /^Expand \[/ })).toHaveLength(4);
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(screen.getByText('1 error')).toBeInTheDocument();
  });

  it('edits colors and warns about low contrast', async () => {
    const user = userEvent.setup();
    render(<Harness schema={colors.schema} value={colors.value} />);
    expect(screen.getByText('VIP', { selector: '.laci-badge-preview' })).toHaveStyle({
      color: '#FFFFFF',
    });
    expect(screen.getAllByText(/^Contrast \d+\.\d:1$/)).toHaveLength(2);
    const text = screen.getAllByRole('textbox', { name: /^text/ })[0]!;
    await user.clear(text);
    await user.type(text, '#8A5A44');
    expect(screen.getByText(/below 4.5:1/)).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('background picker')[0]!, {
      target: { value: '#112233' },
    });
    expect((current() as JsonValue[])[0]).toMatchObject({ background: '#112233', text: '#8A5A44' });
    await user.clear(text);
    expect(screen.getAllByLabelText('text picker')[0]).toHaveValue('#000000');
  });

  it('edits maps of links', async () => {
    const user = userEvent.setup();
    const schema = { type: 'object', additionalProperties: { type: 'string', format: 'uri' } };
    render(<Harness schema={schema} value={{ help: 'https://help.example.com' }} />);
    expect(screen.getByDisplayValue('https://help.example.com')).toHaveAttribute('type', 'url');
    await user.click(screen.getByRole('button', { name: '+ Add key' }));
    expect(current()).toEqual({ help: 'https://help.example.com', key2: '' });
    const keys = screen.getAllByLabelText('Key');
    await user.clear(keys[1]!);
    await user.type(keys[1]!, 'promo');
    await user.tab();
    expect(current()).toEqual({ help: 'https://help.example.com', promo: '' });
    // Taken or empty names are refused.
    const promo = screen.getAllByLabelText('Key')[1]!;
    await user.clear(promo);
    await user.type(promo, 'help');
    await user.tab();
    await user.clear(promo);
    await user.tab();
    expect(promo).toHaveValue('promo');
    await user.type(screen.getAllByRole('textbox').at(-1)!, 'https://x.example');
    expect(current()).toMatchObject({ promo: 'https://x.example' });
    await user.click(screen.getByRole('button', { name: 'Remove help' }));
    expect(current()).toEqual({ promo: 'https://x.example' });
  });

  it('has an input for every type', async () => {
    const user = userEvent.setup();
    const schema: JsonSchema = {
      type: 'object',
      required: ['level'],
      properties: {
        level: { enum: ['gold', 'silver', 1] },
        size: { type: 'integer', title: 'Size' },
        ratio: { type: 'number' },
        due: { type: 'string', format: 'date' },
        liveAt: { type: ['string', 'null'], format: 'date-time' },
        mail: { type: 'string', format: 'email' },
        note: { type: 'string', maxLength: 500 },
        nothing: { type: 'null' },
        anything: {},
        tags: { type: 'array', items: { type: 'number' } },
        meta: { type: 'object', properties: { a: { type: 'string' } } },
      },
    };
    render(<Harness schema={schema} value={{ level: 'silver', liveAt: null, nothing: null }} />);
    const level = screen.getByLabelText(/level/);
    await user.selectOptions(level, '2');
    expect(current()).toMatchObject({ level: 1 });
    await user.type(screen.getByLabelText('Size'), '12');
    expect(current()).toMatchObject({ size: 12 });
    await user.clear(screen.getByLabelText('Size'));
    expect(current()).not.toHaveProperty('size');
    await user.type(screen.getByLabelText('ratio'), '1.5');
    fireEvent.change(screen.getByLabelText('due'), { target: { value: '2026-11-01' } });
    expect(current()).toMatchObject({ ratio: 1.5, due: '2026-11-01' });
    const ratio = screen.getByLabelText('ratio').closest('.laci-field') as HTMLElement;
    await user.click(within(ratio).getByRole('button', { name: 'Clear' }));
    expect(current()).not.toHaveProperty('ratio');

    // A nullable date and time: set it, pick an offset, clear it again.
    await user.click(screen.getByRole('button', { name: 'Set' }));
    fireEvent.change(screen.getByLabelText('liveAt'), { target: { value: '2026-11-01T09:00' } });
    await user.selectOptions(screen.getByLabelText('UTC offset'), '+07:00');
    expect(current()).toMatchObject({ liveAt: '2026-11-01T09:00:00+07:00' });
    await user.selectOptions(screen.getByLabelText('UTC offset'), 'Z');
    expect(current()).toMatchObject({ liveAt: '2026-11-01T09:00:00Z' });
    fireEvent.change(screen.getByLabelText('liveAt'), { target: { value: '' } });
    expect(current()).toMatchObject({ liveAt: '' });

    await user.type(screen.getByLabelText('mail'), 'a@b.c');
    expect(screen.getByLabelText('mail')).toHaveAttribute('type', 'email');
    await user.type(screen.getByLabelText('note'), 'long text');
    expect(screen.getByLabelText('note').tagName).toBe('TEXTAREA');
    expect(screen.getByText('null', { selector: 'code' })).toBeInTheDocument();

    // Anything else is JSON.
    const anything = screen.getByLabelText('anything');
    fireEvent.change(anything, { target: { value: '{"a": [1' } });
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
    fireEvent.change(anything, { target: { value: '{"a": [1]}' } });
    expect(current()).toMatchObject({ anything: { a: [1] } });
    fireEvent.change(anything, { target: { value: ' ' } });
    expect(current()).not.toHaveProperty('anything');

    await user.type(screen.getByLabelText('Add to tags'), '3,x,');
    expect(current()).toMatchObject({ tags: [3] });
    await user.type(
      within(screen.getByText('meta').closest('.laci-field') as HTMLElement).getByLabelText('a'),
      'x',
    );
    expect(current()).toMatchObject({ meta: { a: 'x' } });
  });

  it('keeps unexpected values editable as JSON', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { count: { type: 'number' }, at: { type: 'string', format: 'date-time' } },
    };
    render(<Harness schema={schema} value={{ count: 'many', at: 'soon', extra: true }} />);
    expect(
      screen.getByText('The stored value does not match the schema here.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('count')).toHaveValue('"many"');
    expect(screen.getByText('soon', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByLabelText('extra')).toHaveValue('true');
  });

  it('renders a value without a schema type, and enums without a value', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        schema={{
          type: 'object',
          properties: { tier: { enum: ['a', 'b'] }, sub: { type: 'object', properties: {} } },
        }}
        value={{ sub: 'x' }}
      />,
    );
    expect(screen.getByLabelText('tier')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('tier'), '0');
    await user.selectOptions(screen.getByLabelText('tier'), '');
    expect(current()).toEqual({ sub: 'x' });
  });
});
