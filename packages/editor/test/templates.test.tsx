import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SendTestMessage } from '../../studio/src/handler';
import { seed, setup } from './harness';

const slow = { timeout: 3000 };

const frame = (title: string) => screen.getByTitle<HTMLIFrameElement>(title);

describe('Email Template', () => {
  async function openEmail(options: Parameters<typeof setup>[0] = {}) {
    const user = userEvent.setup();
    const context = await setup({
      ...options,
      editor: { initialView: { page: 'email', key: 'approval-request' } },
    });
    await screen.findByRole('heading', { name: 'approval-request' }, slow);
    return { user, ...context };
  }

  it('edits the template with variables and snippets', async () => {
    const { user } = await openEmail();
    expect(screen.getByLabelText('Locale')).toHaveValue('id-ID');
    const subject = screen.getByLabelText('Subject');
    expect(subject).toHaveValue('Halo {{ name }}');
    await user.click(subject);
    await user.click(screen.getByRole('button', { name: '{ } Variable: amount' }));
    expect(subject).toHaveValue('Halo {{ name }}{{ amount }}');

    const html = screen.getByLabelText('HTML');
    await user.click(html);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    await user.click(screen.getByRole('button', { name: 'Italic' }));
    await user.click(screen.getByRole('button', { name: 'Insert link' }));
    await user.click(screen.getByRole('button', { name: 'Insert button' }));
    expect((html as HTMLTextAreaElement).value).toContain('<strong></strong>');
    expect((html as HTMLTextAreaElement).value).toContain('Button</a>');

    await user.click(screen.getByRole('tab', { name: 'Plain text' }));
    expect(screen.getByLabelText('Plain text')).toHaveValue('Halo {{ name }}');
    await user.click(screen.getByRole('tab', { name: 'Visual' }));
    expect(frame('Visual').getAttribute('srcdoc')).toContain('>name</span>');
    expect(frame('Visual')).toHaveAttribute('sandbox', '');

    await user.type(screen.getByLabelText('From name (optional)'), 'Finance');
    await user.clear(screen.getByLabelText('From name (optional)'));
    await user.clear(subject);
    await user.type(subject, 'Hi {{{{ who }}');
    expect(await screen.findByText(/uses the variable "who"/, {}, slow)).toBeInTheDocument();
  });

  it('previews with sample data in a sandboxed frame', async () => {
    const { user } = await openEmail();
    await waitFor(() => {
      expect(frame('Preview').getAttribute('srcdoc')).toContain('Halo Budi, total 1.500');
    }, slow);
    expect(screen.getByText('Halo Budi', { selector: 'strong' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Sample data'), '1');
    await waitFor(() => {
      expect(frame('Preview').getAttribute('srcdoc')).toContain('Halo name');
    }, slow);
    await user.click(screen.getByRole('button', { name: 'Edit sample data' }));
    const sample = screen.getByRole('textbox', { name: 'Edit sample data' });
    fireEvent.change(sample, { target: { value: '{' } });
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as example' })).toBeDisabled();
    fireEvent.change(sample, { target: { value: '{"amount": 5}' } });
    expect(
      await screen.findByText(/Preview failed: .*name: is required/, {}, slow),
    ).toBeInTheDocument();
    fireEvent.change(sample, { target: { value: '{"name": "Rina"}' } });
    await user.click(screen.getByRole('button', { name: 'Save as example' }));
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByLabelText('Sample data')).toHaveTextContent('Example 2');
  });

  it('edits the variable schema', async () => {
    const { user } = await openEmail();
    const variables = screen.getByText('Variables').closest('.laci-panel') as HTMLElement;
    expect(within(variables).getByText('required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit schema' }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getAllByRole('button', { name: /\+ Add field to approval-request/ })[0]!,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(variables).getByText('field')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit schema' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('saves, sends a test, and shows its history', async () => {
    const sent: SendTestMessage[] = [];
    let fail = false;
    const { user, laci } = await openEmail({
      studio: {
        sendTest: (message) => {
          if (fail) throw new Error('SMTP down');
          sent.push(message);
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    await user.type(screen.getByLabelText('Send a test to'), 'rina@example.com');
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test sent to rina@example.com')).toBeInTheDocument();
    expect(sent[0]).toMatchObject({ kind: 'EMAIL_TEMPLATE', key: null, to: 'rina@example.com' });
    fail = true;
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    await user.type(screen.getByLabelText('Send a test to'), 'x');
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText(/SMTP down/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Subject'), '!');
    await user.click(screen.getByRole('button', { name: 'Review & save' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/Schema valid/, {}, slow);
    await user.click(within(dialog).getByRole('button', { name: 'Save v2' }));
    await screen.findByText('Saved as v2');
    expect(
      (
        await laci.getEntry('approval-request', {
          kind: 'EMAIL_TEMPLATE',
          environment: 'production',
        })
      )?.value,
    ).toMatchObject({
      subject: 'Halo {{ name }}!',
    });
    await user.click(await screen.findByRole('button', { name: 'History' }, slow));
    expect(await screen.findByText('2 versions')).toBeInTheDocument();
  });

  it('adds a locale as a draft and warns about different variables', async () => {
    const { user, laci } = await openEmail();
    await user.selectOptions(screen.getByLabelText('Locale'), '+');
    const dialog = screen.getByRole('dialog', { name: 'Add locale…' });
    await user.type(within(dialog).getByLabelText(/New locale/), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('language tag');
    await user.clear(within(dialog).getByLabelText(/New locale/));
    await user.type(within(dialog).getByLabelText(/New locale/), 'en');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Locale')).toHaveValue('en');
    }, slow);
    expect(await screen.findByRole('button', { name: 'Review & publish' }, slow)).toBeDisabled();
    await laci.update(
      'approval-request',
      {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            extra: { type: 'string' },
          },
        },
      },
      { kind: 'EMAIL_TEMPLATE', environment: 'production', locale: 'en' },
    );
    await user.selectOptions(screen.getByLabelText('Locale'), 'id-ID');
    expect(
      await screen.findByText(/differs from the schema of locale en/, {}, slow),
    ).toBeInTheDocument();
  });
});

describe('Message Template', () => {
  async function openMessage(
    channel: 'WHATSAPP' | 'SMS',
    options: Parameters<typeof setup>[0] = {},
  ) {
    const user = userEvent.setup();
    const context = await setup({
      ...options,
      editor: { initialView: { page: 'message', channel, key: 'live-reminder' } },
    });
    await screen.findByRole('heading', { name: 'live-reminder' }, slow);
    return { user, ...context };
  }

  it('edits a WhatsApp template with its provider details', async () => {
    const { user } = await openMessage('WHATSAPP');
    expect(screen.getByRole('tab', { name: /WhatsApp/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /SMS/ })).toHaveTextContent('1');
    expect(screen.getByLabelText('Provider template name')).toHaveValue('live_reminder');
    expect(screen.getByLabelText('Provider approval')).toHaveValue('APPROVED');
    const phone = await screen.findByText('Hi name, we are live!', {}, slow);
    expect(phone.closest('.laci-phone')).toHaveTextContent('Live name');
    expect(phone.closest('.laci-phone')).toHaveTextContent('Watch');
    expect(screen.getByText('21 / 1024 characters')).toBeInTheDocument();
    expect(
      screen.getByText('As registered with the provider').closest('details'),
    ).toHaveTextContent('Live {{1}}');

    await user.selectOptions(screen.getByLabelText('Category'), 'MARKETING');
    await user.selectOptions(screen.getByLabelText('Provider approval'), '');
    expect(
      await screen.findByText(/is not set: submit the template/, {}, slow),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Provider approval'), 'APPROVED');

    await user.click(screen.getByLabelText('Body'));
    await user.click(screen.getAllByRole('button', { name: 'name' })[0]!);
    expect(screen.getByLabelText('Body')).toHaveValue('Hi {{ name }}, we are live!{{ name }}');
    await user.type(screen.getByLabelText('Footer (optional)'), ' {{{{ name }}');
    expect(await screen.findByText(/must be fixed text/, {}, slow)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Footer (optional)'));

    // Buttons
    await user.selectOptions(screen.getByLabelText('Type 1'), 'QUICK_REPLY');
    expect(screen.queryByLabelText('URL 1')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Type 1'), 'URL');
    expect(screen.getByLabelText('URL 1')).toHaveValue('https://');
    await user.type(screen.getByLabelText('URL 1'), 'x.example');
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.clear(screen.getByLabelText('Text 2'));
    await user.type(screen.getByLabelText('Text 2'), 'Later');
    await user.click(screen.getByRole('button', { name: 'Remove button 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove button 1' }));
    expect(screen.queryByLabelText('Text 1')).toBeNull();
  });

  it('counts SMS segments and switches channels', async () => {
    const { user } = await openMessage('SMS');
    expect(await screen.findByText('7 / 160 · 1 segment · GSM-7', {}, slow)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Sender ID (optional)'), 'TOKO');
    await user.type(screen.getByLabelText('Body'), ' 🎉');
    expect(await screen.findByText(/sent as UCS-2/, {}, slow)).toBeInTheDocument();
    expect(await screen.findByText('TOKO', { selector: 'strong' }, slow)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Push notification/ }));
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('syncs the provider status and sends tests', async () => {
    const sent: SendTestMessage[] = [];
    const laci = await seed({ environment: 'production', syncProviderStatus: () => 'REJECTED' });
    const { user } = await openMessage('WHATSAPP', {
      laci,
      studio: { sendTest: (message) => void sent.push(message) },
    });
    await user.click(screen.getByRole('button', { name: 'Sync status' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Provider approval')).toHaveValue('REJECTED');
    }, slow);
    expect(screen.getByText(/synced/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    await user.type(screen.getByLabelText('Send a test to'), '+628123');
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    await screen.findByText('Test sent to +628123');
    expect(sent[0]).toMatchObject({ kind: 'MESSAGE_TEMPLATE', channel: 'WHATSAPP', to: '+628123' });
  });

  it('reports a failed sync', async () => {
    const laci = await seed({
      environment: 'production',
      syncProviderStatus: () => Promise.reject(new Error('Meta is down')),
    });
    const { user } = await openMessage('WHATSAPP', { laci });
    await user.click(screen.getByRole('button', { name: 'Sync status' }));
    expect(await screen.findByText(/Meta is down/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('1 version')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit schema' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply' }));
  });

  it('previews push and in-app messages', async () => {
    const user = userEvent.setup();
    const laci = await seed({ environment: 'production' });
    const schema = { type: 'object', properties: { id: { type: 'string' } } };
    await laci.define('order', {
      kind: 'MESSAGE_TEMPLATE',
      channel: 'PUSH',
      environment: 'production',
      schema,
      value: {
        title: 'Order {{ id }}',
        body: 'Ready',
        deepLink: 'app://o/{{ id }}',
        imageUrl: 'https://i.example/x.png',
      },
    });
    await laci.define('order', {
      kind: 'MESSAGE_TEMPLATE',
      channel: 'IN_APP',
      environment: 'production',
      schema,
      value: { title: 'Hi', body: 'Saved {{ id }}' },
    });
    await setup({
      laci,
      editor: { initialView: { page: 'message', channel: 'PUSH', key: 'order' } },
    });
    expect(await screen.findByText('Order id', { selector: 'strong' }, slow)).toBeInTheDocument();
    expect(screen.getByText('app://o/id')).toBeInTheDocument();
    expect(screen.getByText('5 / 178 characters')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), ' and a very long title that phones cut off');
    expect(await screen.findByText(/phones usually cut the title/, {}, slow)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /In-app/ }));
    await user.click(await screen.findByRole('button', { name: /order/ }));
    expect(await screen.findByText('Saved id', {}, slow)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Deep link (optional)'), 'app://x');
  });
});

describe('History & Audit', () => {
  it('lists recent changes with their versions', async () => {
    const user = userEvent.setup();
    const laci = await seed({ environment: 'production' });
    // A later time than the seeded entries.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await laci.set(
      'linkPath',
      { help: 'https://new.example.com' },
      { environment: 'production', by: 'Andi', note: 'New help' },
    );
    await setup({ laci, editor: { initialView: { page: 'history' } } });
    const list = await screen.findByRole('region', { name: 'Recently changed' });
    const first = (await within(list).findAllByRole('button'))[0]!;
    expect(first).toHaveTextContent('linkPath');
    expect(within(list).getByText(/Message template · id-ID · WHATSAPP/)).toBeInTheDocument();
    await user.click(first);
    expect(await screen.findByText('New help')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Roll back to v1' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Roll back to v1' }),
    );
    expect(await screen.findByText('3 versions', {}, slow)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Schema Builder/ }));
    expect(screen.getByRole('heading', { name: 'New entry' })).toBeInTheDocument();
  });
});
