import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setup } from './harness';

const slow = { timeout: 3000 };

async function openNew(view: Record<string, string> = {}) {
  const user = userEvent.setup();
  const context = await setup({ editor: { initialView: { page: 'new', ...view } } });
  await screen.findByRole('heading', { name: 'New entry' });
  return { user, ...context };
}

describe('New entry', () => {
  it('creates a config from a preset as a draft', async () => {
    const { user, laci } = await openNew();
    expect(screen.getByRole('button', { name: 'Create entry' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Link map' }));
    await user.type(screen.getByLabelText('Key'), 'supportLinks');
    await user.type(screen.getByLabelText('Description'), 'Where to get help');
    expect(
      screen.getByText('JSON Schema', { selector: 'summary' }).closest('details'),
    ).toHaveTextContent('"additionalProperties"');
    await user.click(screen.getByRole('button', { name: 'Create entry' }));
    expect(await screen.findByRole('heading', { name: 'supportLinks' }, slow)).toBeInTheDocument();
    expect(screen.getByText('Created supportLinks as a draft')).toBeInTheDocument();
    expect(await laci.getEntry('supportLinks', { environment: 'production' })).toMatchObject({
      status: 'DRAFT',
      value: {},
      description: 'Where to get help',
    });
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('button', { name: 'Disable' }, slow)).toBeInTheDocument();
  });

  it('reports a key that exists', async () => {
    const { user } = await openNew();
    await user.type(screen.getByLabelText('Key'), 'linkPath');
    await user.click(screen.getByRole('button', { name: 'Create entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('creates email and message templates', async () => {
    const { user, laci } = await openNew();
    await user.click(screen.getByRole('button', { name: /Email template/ }));
    await user.type(screen.getByLabelText('Key'), 'welcome');
    await user.clear(screen.getByLabelText('Locale'));
    await user.type(screen.getByLabelText('Locale'), 'en');
    await user.click(screen.getByRole('button', { name: 'Create entry' }));
    expect(await screen.findByRole('heading', { name: 'welcome' }, slow)).toBeInTheDocument();
    expect(
      await laci.getEntry('welcome', {
        kind: 'EMAIL_TEMPLATE',
        environment: 'production',
        locale: 'en',
      }),
    ).toMatchObject({
      value: { subject: 'Hello {{ name }}' },
    });

    await user.click(screen.getByRole('button', { name: /Schema Builder/ }));
    await user.click(await screen.findByRole('button', { name: /Message template/ }));
    await user.selectOptions(screen.getByLabelText('Channel'), 'PUSH');
    await user.type(screen.getByLabelText('Key'), 'Order Ready!');
    // Without variables the template is plain text.
    await user.click(screen.getByRole('button', { name: /^name/ }));
    await user.click(screen.getByRole('button', { name: 'Remove field' }));
    await user.click(screen.getByRole('button', { name: 'Create entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('key');
    await user.clear(screen.getByLabelText('Key'));
    await user.type(screen.getByLabelText('Key'), 'order-ready');
    await user.click(screen.getByRole('button', { name: 'Create entry' }));
    expect(await screen.findByRole('heading', { name: 'order-ready' }, slow)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Push notification/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    for (const [channel, value] of [
      ['WHATSAPP', { providerTemplateName: 'order_ready_2', body: 'Hello {{ name }}' }],
      ['SMS', { body: 'Hello {{ name }}' }],
    ] as const) {
      await user.click(screen.getByRole('button', { name: 'New message' }));
      await user.click(await screen.findByRole('button', { name: /Message template/ }));
      // A new message starts in the channel of the page it was opened from.
      expect(screen.getByLabelText('Channel')).toHaveValue(
        channel === 'WHATSAPP' ? 'PUSH' : 'WHATSAPP',
      );
      await user.selectOptions(screen.getByLabelText('Channel'), channel);
      await user.type(screen.getByLabelText('Key'), 'Order Ready 2');
      await user.clear(screen.getByLabelText('Key'));
      await user.type(
        screen.getByLabelText('Key'),
        channel === 'SMS' ? 'order-sms' : 'Order.Ready-2',
      );
      await user.click(screen.getByRole('button', { name: 'Create entry' }));
      await screen.findByText(/Created/, {}, slow);
      const key = channel === 'SMS' ? 'order-sms' : 'Order.Ready-2';
      expect(
        await laci.getEntry(key, { kind: 'MESSAGE_TEMPLATE', channel, environment: 'production' }),
      ).toMatchObject({ value });
    }
  });

  it('builds a nested structure field by field', async () => {
    const { user } = await openNew({ kind: 'CONFIG' });
    await user.click(screen.getByRole('button', { name: 'List of objects' }));
    const tree = screen.getByRole('region', { name: 'Structure' });
    const preview = () =>
      screen.getByText('JSON Schema', { selector: 'summary' }).closest('details') as HTMLElement;

    // Select the item, add a field, and edit its properties.
    await user.click(within(tree).getByRole('button', { name: '+ Add field to item' }));
    const properties = screen.getByRole('complementary', { name: 'Selected field' });
    expect(within(properties).getByRole('heading')).toHaveTextContent('[].field');
    const name = within(properties).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'name');
    expect(within(properties).getByText('"name" exists')).toBeInTheDocument();
    await user.type(name, 's');
    await user.selectOptions(within(properties).getByLabelText('Type'), 'array');
    await user.type(within(properties).getByLabelText('Label shown in editor'), 'Names');
    await user.type(within(properties).getByLabelText('Help text'), 'One per person');
    await user.type(within(properties).getByLabelText('Min items'), '1');
    await user.type(within(properties).getByLabelText('Unique by field'), 'x');
    await user.clear(within(properties).getByLabelText('Unique by field'));
    await user.click(within(properties).getByLabelText('required'));
    expect(preview()).toHaveTextContent('"minItems": 1');
    expect(preview()).toHaveTextContent('"title": "Names"');

    // The list's item, an enum, a nullable date.
    await user.click(within(tree).getAllByRole('button', { name: /^item/ })[1]!);
    await user.selectOptions(
      within(screen.getByRole('complementary')).getByLabelText('Type'),
      'enum',
    );
    fireEvent.change(
      within(screen.getByRole('complementary')).getByLabelText('Options (one per line)'),
      {
        target: { value: 'a\nb\n' },
      },
    );
    expect(preview()).toHaveTextContent('"enum": [ "a", "b" ]');
    await user.click(within(tree).getByText('name', { selector: '.laci-mono' }).closest('button')!);
    await user.selectOptions(
      within(screen.getByRole('complementary')).getByLabelText('Type'),
      'date-time',
    );
    await user.click(
      within(screen.getByRole('complementary')).getByLabelText('Can be empty (null)'),
    );
    expect(preview()).toHaveTextContent('"format": "date-time"');
    await user.click(within(tree).getAllByRole('button', { name: '+ Add field to item' }).at(-1)!);
    await user.click(within(tree).getAllByRole('button', { name: '+ Add field to item' })[0]!);
    expect(within(screen.getByRole('complementary')).getByRole('heading')).toHaveTextContent(
      '[].field2',
    );
    await user.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'Remove field' }),
    );
    expect(within(screen.getByRole('complementary')).getByRole('heading')).toHaveTextContent('Key');
  });

  it('guesses a structure from a JSON sample', async () => {
    const { user } = await openNew({ kind: 'CONFIG' });
    await user.click(screen.getByRole('button', { name: 'Import from JSON sample' }));
    const dialog = screen.getByRole('dialog', { name: 'Import from JSON sample' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '[{"code":' } });
    await user.click(within(dialog).getByRole('button', { name: 'Use this structure' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Not valid JSON');
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '[{"code": "A", "color": "#FFFFFF", "slots": ["10:00"]}]' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Use this structure' }));
    const tree = screen.getByRole('region', { name: 'Structure' });
    expect(within(tree).getByRole('button', { name: /^color/ })).toHaveTextContent('color');

    // Templates need an object.
    await user.click(screen.getByRole('button', { name: /Email template/ }));
    await user.click(screen.getByRole('button', { name: 'Import from JSON sample' }));
    const again = screen.getByRole('dialog', { name: 'Import from JSON sample' });
    fireEvent.change(within(again).getByRole('textbox'), { target: { value: '[1]' } });
    await user.click(within(again).getByRole('button', { name: 'Use this structure' }));
    expect(within(again).getByRole('alert')).toHaveTextContent('template data is an object');
    await user.click(within(again).getByRole('button', { name: 'Close' }));
  });
});
