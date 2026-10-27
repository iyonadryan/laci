import { describe, expect, it } from 'vitest';
import {
  createLaci,
  EntryExistsError,
  EntryNotFoundError,
  LaciValidationError,
  MemoryStore,
  TemplateNotFoundError,
  UnknownEnvironmentError,
  VersionConflictError,
} from '../src';
import type { ChangeEvent, EntryQuery, EntryWrite, LaciOptions, Paginated, Entry } from '../src';
import { approvalRequest, linkPath, liveReminder } from './fixtures';

function setup(options: Partial<LaciOptions> = {}) {
  const events: ChangeEvent[] = [];
  const laci = createLaci({
    store: new MemoryStore(),
    defaultLocale: 'id-ID',
    onChange: (event) => void events.push(event),
    ...options,
  });
  return { laci, events };
}

const email = (subject: string) => ({ ...approvalRequest.value, subject });
const data = {
  managerName: 'Rina',
  requester: { name: 'Budi' },
  amount: 1,
  dueDate: '2026-11-01',
  link: 'https://x.example',
};

describe('locale fallback', () => {
  async function templates() {
    const { laci } = setup();
    for (const [locale, subject] of [
      ['id-ID', 'Halo'],
      ['en', 'Hello'],
      ['zh', 'Nihao'],
    ] as const) {
      await laci.define('approval-request', { ...approvalRequest, locale, value: email(subject) });
    }
    return laci;
  }

  it('tries the locale, its base language, then the default locale', async () => {
    const laci = await templates();
    const render = async (locale?: string) => {
      const mail = await laci.renderEmail('approval-request', data, locale ? { locale } : {});
      return `${mail.locale}:${mail.subject}`;
    };
    expect(await render('en')).toBe('en:Hello');
    expect(await render('en-US')).toBe('en:Hello');
    expect(await render('zh-Hant-TW')).toBe('zh:Nihao');
    expect(await render('fr-FR')).toBe('id-ID:Halo');
    expect(await render('id-ID')).toBe('id-ID:Halo');
    expect(await render()).toBe('id-ID:Halo');
  });

  it('only falls back to published templates', async () => {
    const laci = await templates();
    await laci.update(
      'approval-request',
      { status: 'DRAFT' },
      { kind: 'EMAIL_TEMPLATE', locale: 'en' },
    );
    expect((await laci.renderEmail('approval-request', data, { locale: 'en-US' })).locale).toBe(
      'id-ID',
    );
  });

  it('falls back for message templates of the channel', async () => {
    const { laci } = setup();
    await laci.define('live-reminder', { ...liveReminder, locale: 'en' });
    const rendered = await laci.renderMessage(
      'live-reminder',
      { name: 'Rina', startAt: '2026-11-01T00:00:00Z', code: 'x' },
      { channel: 'WHATSAPP', locale: 'en-GB' },
    );
    expect(rendered.locale).toBe('en');
    await expect(
      laci.renderMessage('live-reminder', {}, { channel: 'SMS', locale: 'en-GB' }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it('says which locales it tried when none has the template', async () => {
    const { laci } = setup();
    const error = await laci
      .renderEmail('approval-request', data, { locale: 'en-US' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EntryNotFoundError);
    expect(error).toMatchObject({
      code: 'ENTRY_NOT_FOUND',
      key: 'approval-request',
      locales: ['en-US', 'en', 'id-ID'],
      message:
        'No published version of "approval-request" (production) for locale en-US, en or id-ID.',
    });
    await expect(
      laci.renderEmail('approval-request', data, { locale: '!' }),
    ).rejects.toBeInstanceOf(LaciValidationError);
  });
});

describe('promote', () => {
  it('creates the target with the status and description of the source', async () => {
    const { laci, events } = setup();
    await laci.define('linkPath', {
      ...linkPath,
      environment: 'staging',
      status: 'DRAFT',
      description: 'Links',
    });
    const result = await laci.promote('linkPath', {
      from: 'staging',
      to: 'production',
      by: 'dev-1',
    });
    expect(result.changes).toEqual([
      {
        action: 'create',
        source: expect.objectContaining({ environment: 'staging' }) as Entry,
        previous: null,
        entry: expect.objectContaining({
          environment: 'production',
          version: 1,
          status: 'DRAFT',
          description: 'Links',
          value: linkPath.value,
          createdBy: 'dev-1',
        }) as Entry,
      },
    ]);
    expect(await laci.getEntry('linkPath')).toEqual(result.changes[0]?.entry);
    const history = await laci.history('linkPath');
    expect(history.items[0]).toMatchObject({
      note: 'Promoted from staging (version 1)',
      changedBy: 'dev-1',
    });
    expect(events[events.length - 1]).toMatchObject({ type: 'promote', previousVersion: null });
  });

  it('copies value and schema as a new version, keeping status and description', async () => {
    const { laci, events } = setup();
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    await laci.set('linkPath', { help: 'https://new.example' }, { environment: 'staging' });
    await laci.define('linkPath', { ...linkPath, status: 'DISABLED', description: 'Prod links' });
    const { changes } = await laci.promote('linkPath', {
      from: 'staging',
      to: 'production',
      expectedVersion: 1,
      sourceVersion: 2,
      note: 'Release 42',
    });
    expect(changes[0]).toMatchObject({
      action: 'update',
      previous: { version: 1 },
      entry: {
        version: 2,
        value: { help: 'https://new.example' },
        status: 'DISABLED',
        description: 'Prod links',
      },
    });
    expect((await laci.history('linkPath')).items[0]?.note).toBe('Release 42');
    expect(events[events.length - 1]).toMatchObject({ type: 'promote', previousVersion: 1 });
  });

  it('changes nothing when the target already matches, or in a dry run', async () => {
    const { laci, events } = setup();
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    await laci.define('linkPath', linkPath);
    const before = events.length;
    const same = await laci.promote('linkPath', { from: 'staging', to: 'production' });
    expect(same.changes[0]).toMatchObject({ action: 'unchanged', entry: { version: 1 } });

    await laci.set('linkPath', { a: 'https://a.example' }, { environment: 'staging' });
    const plan = await laci.promote('linkPath', {
      from: 'staging',
      to: 'production',
      dryRun: true,
    });
    expect(plan.changes[0]).toMatchObject({ action: 'update', entry: { version: 2 } });
    expect(await laci.getEntry('linkPath')).toMatchObject({ version: 1 });
    expect(events.length).toBe(before + 1);
  });

  it('refuses stale versions', async () => {
    const { laci } = setup();
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    const promote = (options: { expectedVersion?: number; sourceVersion?: number }) =>
      laci.promote('linkPath', { from: 'staging', to: 'production', ...options });
    await expect(promote({ expectedVersion: 1 })).rejects.toThrow(
      'Entry "linkPath" (production) was changed by someone else: expected version 1.',
    );
    await expect(promote({ sourceVersion: 3 })).rejects.toBeInstanceOf(VersionConflictError);
    // 0: the target must not exist yet.
    await promote({ expectedVersion: 0 });
    await expect(promote({ expectedVersion: 0 })).rejects.toThrow('but it is at version 1');
    await expect(promote({ expectedVersion: 2 })).rejects.toThrow('but it is at version 1');
  });

  it('checks its options and the entries', async () => {
    const { laci } = setup();
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    await expect(laci.promote('linkPath', { from: 'staging', to: 'staging' })).rejects.toThrow(
      TypeError,
    );
    await expect(laci.promote('linkPath', { from: 'staging', to: 'qa' })).rejects.toBeInstanceOf(
      UnknownEnvironmentError,
    );
    await expect(
      laci.promote('nope', { from: 'staging', to: 'production' }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
    await expect(
      laci.promote('nope', { from: 'staging', to: 'production', all: true }),
    ).rejects.toThrow('Entry "nope" (staging) does not exist or is not published.');
    await expect(
      laci.promote('linkPath', {
        from: 'staging',
        to: 'production',
        all: true,
        expectedVersion: 1,
      }),
    ).rejects.toThrow('cannot be used with `all`');
  });

  it('refuses a target address taken by another kind', async () => {
    const store = new MemoryStore();
    const { laci } = setup({ store });
    await laci.define('x', { ...linkPath, environment: 'staging' });
    const template = await createLaci({ store, defaultLocale: 'id-ID' }).define('x', {
      ...approvalRequest,
    });
    // A config and a template never share an address, so build the clash by hand.
    await store.write([
      {
        type: 'insert',
        entry: { ...template, id: 'other', locale: null },
        history: {
          id: 'h',
          entryId: 'other',
          version: 1,
          value: template.value,
          schema: template.schema,
          status: 'PUBLISHED',
          changedBy: null,
          changedAt: template.createdAt,
          note: null,
        },
      },
    ]);
    await expect(laci.promote('x', { from: 'staging', to: 'production' })).rejects.toBeInstanceOf(
      EntryExistsError,
    );
  });

  it('promotes every locale and channel of a key at once', async () => {
    const { laci } = setup();
    const staging = { environment: 'staging' } as const;
    await laci.define('reminder', { ...approvalRequest, ...staging });
    await laci.define('reminder', {
      ...approvalRequest,
      ...staging,
      locale: 'en',
      value: email('Hi'),
    });
    await laci.define('reminder', {
      ...staging,
      kind: 'MESSAGE_TEMPLATE',
      channel: 'SMS',
      schema: { type: 'object' },
      value: { body: 'Hi' },
    });
    await laci.define('reminder', { ...approvalRequest, locale: 'en', value: email('Old') });

    const emails = await laci.promote('reminder', {
      from: 'staging',
      to: 'production',
      all: true,
      kind: 'EMAIL_TEMPLATE',
      dryRun: true,
    });
    expect(emails.changes.map(({ action, entry }) => `${action}:${entry.locale}`)).toEqual([
      'update:en',
      'create:id-ID',
    ]);
    const all = await laci.promote('reminder', { from: 'staging', to: 'production', all: true });
    expect(
      all.changes.map(
        ({ action, entry }) => `${action}:${entry.kind}:${entry.locale}:${entry.channel}`,
      ),
    ).toEqual([
      'update:EMAIL_TEMPLATE:en:null',
      'create:EMAIL_TEMPLATE:id-ID:null',
      'create:MESSAGE_TEMPLATE:id-ID:SMS',
    ]);
    expect((await laci.renderEmail('reminder', data, { locale: 'en' })).subject).toBe('Hi');

    await laci.set('reminder', email('Hi again'), {
      ...staging,
      kind: 'EMAIL_TEMPLATE',
      locale: 'en',
    });
    const again = await laci.promote('reminder', { from: 'staging', to: 'production', all: true });
    expect(again.changes.map(({ action }) => action)).toEqual(['update', 'unchanged', 'unchanged']);
  });

  it('writes all or nothing, and drops the cache of the targets', async () => {
    let fail = false;
    class FlakyStore extends MemoryStore {
      override write(changes: readonly EntryWrite[]): Promise<void> {
        return fail ? Promise.reject(new Error('disk full')) : super.write(changes);
      }
    }
    const { laci } = setup({ store: new FlakyStore() });
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    await laci.define('linkPath', { ...linkPath, value: { a: 'https://old.example' } });
    expect(await laci.get('linkPath')).toEqual({ a: 'https://old.example' });

    fail = true;
    await expect(laci.promote('linkPath', { from: 'staging', to: 'production' })).rejects.toThrow(
      'disk full',
    );
    fail = false;
    await laci.promote('linkPath', { from: 'staging', to: 'production' });
    expect(await laci.get('linkPath')).toEqual(linkPath.value);
  });

  it('pages through many entries', async () => {
    const { laci } = setup();
    const letters = 'abcdefghijk'.split('');
    const locales = letters.flatMap((a) => letters.map((b) => a + b)).slice(0, 105);
    for (const locale of locales) {
      await laci.define('t', { ...approvalRequest, environment: 'staging', locale });
    }
    const { changes } = await laci.promote('t', {
      from: 'staging',
      to: 'production',
      all: true,
      dryRun: true,
    });
    expect(changes).toHaveLength(105);
  });

  it('stops paging when the store runs out of entries early', async () => {
    class ShrinkingStore extends MemoryStore {
      override async listEntries(query?: EntryQuery): Promise<Paginated<Entry>> {
        const page = await super.listEntries(query);
        return { ...page, total: page.total + 10 };
      }
    }
    const { laci } = setup({ store: new ShrinkingStore() });
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    const { changes } = await laci.promote('linkPath', {
      from: 'staging',
      to: 'production',
      all: true,
    });
    expect(changes).toHaveLength(1);
  });

  it('sets an approved WhatsApp template whose content changed back to PENDING', async () => {
    const { laci } = setup();
    await laci.define('live-reminder', {
      ...liveReminder,
      environment: 'staging',
      value: { ...liveReminder.value, body: 'New {{ name }}' },
    });
    await laci.define('live-reminder', liveReminder);
    const { changes } = await laci.promote('live-reminder', {
      from: 'staging',
      to: 'production',
      kind: 'MESSAGE_TEMPLATE',
      channel: 'WHATSAPP',
    });
    expect(changes[0]?.entry.value).toMatchObject({
      body: 'New {{ name }}',
      providerStatus: 'PENDING',
    });
  });
});
