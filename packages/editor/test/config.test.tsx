import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { seed, setup } from './harness';

const slow = { timeout: 3000 };

async function openConfig(key: string) {
  const user = userEvent.setup();
  const context = await setup({ editor: { initialView: { page: 'config', key } } });
  await screen.findByRole('heading', { name: key }, slow);
  return { user, ...context };
}

describe('the shell', () => {
  it('shows the sections, counts, runtime, and production data', async () => {
    await setup({ studio: { label: 'PRODUCTION' } });
    const nav = await screen.findByRole('navigation', { name: 'Laci' });
    await waitFor(() => {
      expect(within(nav).getByRole('button', { name: /Global Configuration/ })).toHaveTextContent(
        '3',
      );
    });
    expect(within(nav).getByRole('button', { name: /Email Template/ })).toHaveTextContent('1');
    expect(within(nav).getByRole('button', { name: /Message Template/ })).toHaveTextContent('1');
    expect(within(nav).queryByText(/Access/)).toBeNull();
    expect(nav).toHaveTextContent('Local · test');
    expect(nav).toHaveTextContent('Saving as Dev One');
    expect(screen.getByRole('status')).toHaveTextContent('You are editing production data');
    expect(screen.getByText('Database: PRODUCTION')).toHaveClass('laci-pill-error');
  });

  it('reports a session it cannot load, and retries', async () => {
    const user = userEvent.setup();
    let fail = true;
    const laci = await seed({ environment: 'production' });
    const { createStudioHandler } = await import('../../studio/src/handler');
    const handler = createStudioHandler({ laci, uiDir: '.' });
    const { render } = await import('@testing-library/react');
    const { LaciEditor } = await import('../src');
    render(
      <LaciEditor
        apiUrl="/x/api/"
        headers={() => ({ authorization: 'Bearer t' })}
        fetch={(input, init) => {
          if (fail) return Promise.resolve(new Response('nope', { status: 500 }));
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            'http://localhost',
          );
          return handler(new Request(url, init), { path: url.pathname.slice(2), user: null });
        }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByText(/Saving as anonymous/)).not.toHaveLength(0);
  });
});

describe('Global Configuration', () => {
  it('lists configs with search and type filters', async () => {
    const user = userEvent.setup();
    await setup();
    const list = await screen.findByRole('region', { name: 'Search key or description' });
    await within(list).findByText('customerLiveStream');
    await user.click(within(list).getByRole('button', { name: 'Link' }));
    expect(within(list).queryByText('customerLiveStream')).toBeNull();
    expect(within(list).getByText('linkPath')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'All' }));
    await user.type(within(list).getByRole('searchbox'), 'badge');
    expect(within(list).getByText('customerCategoryColor')).toBeInTheDocument();
    expect(within(list).queryByText('linkPath')).toBeNull();
    await user.type(within(list).getByRole('searchbox'), 'zzz');
    expect(within(list).getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.getByText('Select an entry on the left.')).toBeInTheDocument();
  });

  it('edits a nested value, reviews it, and saves it', async () => {
    const { user, laci } = await openConfig('customerLiveStream');
    await user.type(screen.getByLabelText('Add to slots'), '19:00{Enter}');
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Path' })).toHaveTextContent(
      'customerLiveStream › [0] › sessions › [0] › slots',
    );
    await user.click(screen.getByRole('button', { name: 'Review & save' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 change');
    expect(dialog).toHaveTextContent('[0].sessions[0].slots[2]');
    expect(await within(dialog).findByText(/Schema valid/, {}, slow)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/No newer version on server \(v1 is latest\)/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/^Size .* of 1\.0 MB$/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'JSON diff' }));
    expect(
      within(dialog)
        .getAllByRole('row')
        .some((row) => row.textContent.includes('"19:00"')),
    ).toBe(true);
    await user.type(within(dialog).getByLabelText('Change note'), 'Add evening slot');
    await user.click(within(dialog).getByRole('button', { name: 'Save v2' }));
    expect(await screen.findByText('Saved as v2')).toBeInTheDocument();
    await screen.findByText(/^v2 ·/, { selector: '.laci-entry-header span' }, slow);
    const history = await laci.history('customerLiveStream');
    expect(history.items[0]).toMatchObject({
      version: 2,
      note: 'Add evening slot',
      changedBy: 'dev-1',
    });
  });

  it('shows validation errors at the field and blocks saving them', async () => {
    const { user } = await openConfig('customerLiveStream');
    await user.clear(screen.getByLabelText(/Customer code/));
    expect(
      await screen.findByText('must NOT have fewer than 1 characters', {}, slow),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 validation error/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review & save' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('1 validation error', {}, slow)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save v2' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText(/Customer code/)).toHaveValue('JKT01');
    expect(screen.getByText(/^No unsaved changes/)).toBeInTheDocument();
  });

  it('refuses to save over a newer version', async () => {
    const { user, laci } = await openConfig('customerLiveStream');
    await user.click(screen.getByRole('checkbox'));
    await laci.update(
      'customerLiveStream',
      { description: 'Changed elsewhere' },
      { environment: 'production', by: 'Andi' },
    );
    await user.click(screen.getByRole('button', { name: 'Review & save' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/Someone saved v2 \(Andi\) meanwhile/, {}, slow),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save v2' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Back to editor' }));
  });

  it('reports a conflict found while saving', async () => {
    const { user, laci } = await openConfig('customerLiveStream');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Review & save' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/Schema valid/, {}, slow);
    await laci.update(
      'customerLiveStream',
      { description: 'Meanwhile' },
      { environment: 'production' },
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save v2' }));
    expect(await within(dialog).findByText(/changed on the server/)).toBeInTheDocument();
  });

  it('edits the value as JSON', async () => {
    const { user } = await openConfig('linkPath');
    await user.click(screen.getByRole('tab', { name: 'JSON' }));
    const json = screen.getByRole('textbox', { name: 'JSON' });
    expect(await screen.findByText('Valid against schema')).toBeInTheDocument();
    fireEvent.change(json, { target: { value: '{"help": ' } });
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
    fireEvent.change(json, { target: { value: '{"help": "not a url"}' } });
    expect(await screen.findByText(/must be an absolute URL/, {}, slow)).toBeInTheDocument();
    fireEvent.change(json, { target: { value: '{"help": "https://new.example.com"}' } });
    await user.click(screen.getByRole('tab', { name: 'Form' }));
    expect(screen.getByDisplayValue('https://new.example.com')).toBeInTheDocument();
  });

  it('edits the schema and description', async () => {
    const { user } = await openConfig('customerCategoryColor');
    await user.click(screen.getByRole('tab', { name: 'Schema' }));
    await user.type(screen.getByLabelText('Description'), ' for badges');
    const structure = screen.getByRole('region', { name: 'Structure' });
    await user.click(within(structure).getByRole('button', { name: '+ Add field to item' }));
    expect(screen.getByRole('heading', { name: '[].field' })).toBeInTheDocument();
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Edit as JSON' }));
    fireEvent.change(screen.getByLabelText('JSON Schema'), {
      target: { value: '{"type": "nope"}' },
    });
    expect(await screen.findByText(/must be one of/, {}, slow)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('JSON Schema'), { target: { value: '[1]' } });
    expect(screen.getByText(/a schema is an object/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('JSON Schema'), {
      target: { value: '{"type": "object"}' },
    });
    await user.click(screen.getByRole('tab', { name: 'Form' }));
    expect(
      screen.getAllByText('The stored value does not match the schema here.').length,
    ).toBeGreaterThan(0);
  });

  it('compares and rolls back versions', async () => {
    const { user, laci } = await openConfig('linkPath');
    await laci.set(
      'linkPath',
      { help: 'https://v2.example.com' },
      { environment: 'production', note: 'Second' },
    );
    await user.click(screen.getByRole('button', { name: /linkPath/ }));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    // The editor still shows v1: reload the entry by navigating.
    await user.click(screen.getByRole('button', { name: /customerLiveStream/ }));
    await user.click(screen.getByRole('button', { name: /linkPath/ }));
    await screen.findByText(/^v2 ·/, { selector: '.laci-entry-header span' }, slow);
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('2 versions')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare v1' }));
    const compare = screen.getByRole('dialog', { name: 'v1 → v2 (current)' });
    expect(compare).toHaveTextContent('https://v2.example.com');
    await user.click(within(compare).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Roll back to v1' }));
    const dialog = screen.getByRole('dialog', { name: 'Roll back to v1' });
    await user.type(within(dialog).getByLabelText('Why? (optional)'), 'Oops');
    await user.click(within(dialog).getByRole('button', { name: 'Roll back to v1' }));
    expect(await screen.findByText('Rolled back to v1')).toBeInTheDocument();
    expect(await laci.get('linkPath', { environment: 'production' })).toEqual({
      help: 'https://help.example.com',
    });
  });

  it('shows how to read the config', async () => {
    const { user } = await openConfig('linkPath');
    await user.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(screen.getByText("const value = await laci.get('linkPath');")).toBeInTheDocument();
  });

  it('changes the status and copies the key', async () => {
    const { user, laci } = await openConfig('linkPath');
    await user.click(screen.getByRole('button', { name: 'Copy key' }));
    expect(screen.getByText('Copied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(await screen.findByRole('button', { name: 'Enable' }, slow)).toBeInTheDocument();
    expect((await laci.getEntry('linkPath', { environment: 'production' }))?.status).toBe(
      'DISABLED',
    );
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    expect(await screen.findByRole('button', { name: 'Disable' }, slow)).toBeInTheDocument();
  });

  it('promotes to another environment after a diff', async () => {
    const { user, laci } = await openConfig('linkPath');
    await user.click(screen.getByRole('button', { name: 'Promote' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote linkPath' });
    expect(within(dialog).getByRole('button', { name: 'Promote to staging' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Preview changes' }));
    expect(await within(dialog).findByText('Update')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('https://staging.example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Promote to staging' }));
    expect(await screen.findByText('Promoted 1 entry to staging')).toBeInTheDocument();
    expect(await laci.get('linkPath', { environment: 'staging' })).toEqual({
      help: 'https://help.example.com',
    });

    await user.click(screen.getByRole('button', { name: 'Promote' }));
    const again = screen.getByRole('dialog', { name: 'Promote linkPath' });
    await user.selectOptions(within(again).getByRole('combobox'), 'development');
    await user.click(within(again).getByRole('button', { name: 'Preview changes' }));
    expect(await within(again).findByText('New')).toBeInTheDocument();
    await user.selectOptions(within(again).getByRole('combobox'), 'staging');
    await user.click(within(again).getByRole('button', { name: 'Preview changes' }));
    expect(
      await within(again).findByText('Nothing to promote: the target already matches.'),
    ).toBeInTheDocument();
    await laci.set('linkPath', { help: 'https://x.example.com' }, { environment: 'staging' });
    await user.selectOptions(within(again).getByRole('combobox'), 'development');
    await user.click(within(again).getByRole('button', { name: 'Preview changes' }));
    await within(again).findByText('New');
    await laci.define('linkPath', {
      schema: { type: 'object' },
      value: {},
      environment: 'development',
    });
    await user.click(within(again).getByRole('button', { name: 'Promote to development' }));
    expect(await within(again).findByRole('alert')).toHaveTextContent(/exists|changed/);
    await user.click(within(again).getByRole('button', { name: 'Cancel' }));
  });

  it('switches the environment for every page', async () => {
    const { user } = await openConfig('linkPath');
    await user.selectOptions(screen.getByLabelText('Environment'), 'staging');
    expect(screen.queryByText('You are editing production data', { exact: false })).toBeNull();
    const list = screen.getByRole('region', { name: 'Search key or description' });
    await waitFor(() => {
      expect(within(list).queryByText('customerLiveStream')).toBeNull();
    });
    expect(
      await screen.findByDisplayValue('https://staging.example.com', {}, slow),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Email Template/ }));
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
  });
});
