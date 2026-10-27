import { createLaci, MemoryStore } from '@lacijs/core';
import type { LaciOptions, RenderedSms, RenderedWhatsApp } from '@lacijs/core';
import type { SendTestMessage, StudioEntry } from '../src/handler';
import { setupHandler } from './fixtures';

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** A WhatsApp reminder, approved, with one variable. */
const reminder = {
  kind: 'MESSAGE_TEMPLATE' as const,
  channel: 'WHATSAPP' as const,
  schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  value: {
    providerTemplateName: 'live_reminder',
    category: 'UTILITY',
    body: 'Hi {{ name }}, we are live!',
    providerStatus: 'APPROVED',
  },
};

const sms = { body: 'Hi {{ name }} 🎉' };

async function setup(options: Partial<LaciOptions> = {}, sendTest?: (m: SendTestMessage) => void) {
  const laci = createLaci({
    store: new MemoryStore(),
    cache: false,
    defaultLocale: 'id-ID',
    now: () => new Date('2026-10-27T08:00:00Z'),
    ...options,
  });
  await laci.define('linkPath', { schema: { type: 'object' }, value: {} });
  await laci.define('reminder', reminder);
  await laci.define('reminder', { ...reminder, channel: 'SMS', value: sms });
  return setupHandler({ laci, ...(sendTest ? { sendTest } : {}) });
}

const whatsApp = '?kind=MESSAGE_TEMPLATE&channel=WHATSAPP';

describe('POST api/preview/message', () => {
  it('renders a stored template of a channel', async () => {
    const { send } = await setup();
    const response = await send('POST', '/api/preview/message', {
      key: 'reminder',
      channel: 'WHATSAPP',
      data: { name: 'Rina' },
    });
    expect(response.status).toBe(200);
    expect(await body<RenderedWhatsApp>(response)).toMatchObject({
      channel: 'WHATSAPP',
      locale: 'id-ID',
      body: 'Hi Rina, we are live!',
      params: ['Rina'],
      warnings: [],
    });
  });

  it('renders unsaved changes with their warnings', async () => {
    const { send } = await setup();
    const response = await send('POST', '/api/preview/message', {
      channel: 'SMS',
      value: sms,
      schema: reminder.schema,
      data: { name: 'Rina' },
      locale: 'en-US',
    });
    expect(await body<RenderedSms>(response)).toMatchObject({
      locale: 'en-US',
      body: 'Hi Rina 🎉',
      segments: { encoding: 'UCS-2', segments: 1 },
      warnings: [{ code: 'encoding' }],
    });
  });

  it('reports invalid templates and bad requests', async () => {
    const { send } = await setup();
    const invalid = await send('POST', '/api/preview/message', {
      channel: 'WHATSAPP',
      value: { ...reminder.value, footer: '{{ name }}' },
      schema: reminder.schema,
    });
    expect(invalid.status).toBe(422);
    expect(await body(invalid)).toMatchObject({
      error: expect.stringContaining('Value of message template is invalid') as unknown,
      issues: [{ path: 'footer', keyword: 'whatsapp' }],
    });
    for (const [payload, status, error] of [
      [{ key: 'reminder' }, 400, '"channel" is required.'],
      [
        { key: 'reminder', channel: 'FAX' },
        400,
        '"channel" must be one of: WHATSAPP, SMS, PUSH, IN_APP.',
      ],
      [
        { key: 'reminder', channel: 'PUSH' },
        404,
        'Entry "reminder" (PUSH) does not exist or is not published.',
      ],
    ] as const) {
      const response = await send('POST', '/api/preview/message', payload);
      expect(response.status).toBe(status);
      expect((await body(response)).error).toBe(error);
    }
  });
});

describe('POST api/send-test for messages', () => {
  it('renders the message and passes it on with its channel', async () => {
    const sent: SendTestMessage[] = [];
    const { send } = await setup({}, (message) => void sent.push(message));
    const response = await send('POST', '/api/send-test', {
      kind: 'MESSAGE_TEMPLATE',
      channel: 'SMS',
      key: 'reminder',
      data: { name: 'Budi' },
      to: '+6281234567890',
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ sent: true, rendered: { body: 'Hi Budi 🎉' } });
    expect(sent).toEqual([
      {
        kind: 'MESSAGE_TEMPLATE',
        channel: 'SMS',
        key: 'reminder',
        to: '+6281234567890',
        rendered: expect.objectContaining({ channel: 'SMS', body: 'Hi Budi 🎉' }) as unknown,
      },
    ]);
  });

  it('refuses configs and messages without a channel', async () => {
    const { send } = await setup({}, () => undefined);
    for (const [payload, error] of [
      [{ kind: 'CONFIG', key: 'linkPath', to: 'x' }, 'Only templates can be sent as a test.'],
      [{ kind: 'MESSAGE_TEMPLATE', key: 'reminder', to: 'x' }, '"channel" is required.'],
    ] as const) {
      const response = await send('POST', '/api/send-test', payload);
      expect(response.status).toBe(400);
      expect((await body(response)).error).toBe(error);
    }
  });
});

describe('entry warnings', () => {
  it('come with every entry the API returns', async () => {
    const { call, send } = await setup();
    expect((await body<StudioEntry>(await call('/api/entries/linkPath'))).warnings).toEqual([]);
    const smsEntry = await body<StudioEntry>(
      await call('/api/entries/reminder?kind=MESSAGE_TEMPLATE&channel=SMS'),
    );
    expect(smsEntry.warnings).toEqual([expect.objectContaining({ code: 'encoding' })]);
    const created = await send('POST', '/api/entries', {
      key: 'push',
      kind: 'MESSAGE_TEMPLATE',
      channel: 'PUSH',
      schema: { type: 'object' },
      value: { title: 'T'.repeat(41), body: 'Hi' },
    });
    expect((await body<StudioEntry>(created)).warnings).toEqual([
      expect.objectContaining({ path: 'title', code: 'length' }),
    ]);
  });

  it('say when a change reset the approval of a WhatsApp template', async () => {
    const { send } = await setup();
    const response = await send('PUT', `/api/entries/reminder${whatsApp}`, {
      value: { ...reminder.value, body: 'Hi {{ name }}, live now!' },
      expectedVersion: 1,
    });
    const entry = await body<StudioEntry>(response);
    expect(entry.value).toMatchObject({ providerStatus: 'PENDING' });
    expect(entry.warnings).toEqual([expect.objectContaining({ code: 'approvalReset' })]);

    const approved = await send('PUT', `/api/entries/reminder${whatsApp}`, {
      value: { ...(entry.value as object), providerStatus: 'APPROVED' },
      expectedVersion: 2,
    });
    expect((await body<StudioEntry>(approved)).warnings).toEqual([]);
    const rolledBack = await send('POST', `/api/entries/reminder/rollback${whatsApp}`, {
      version: 1,
      expectedVersion: 3,
    });
    expect((await body<StudioEntry>(rolledBack)).warnings).toEqual([
      expect.objectContaining({ code: 'approvalReset' }),
    ]);
  });
});

describe('POST api/entries/:key/sync-provider-status', () => {
  const path = '/api/entries/reminder/sync-provider-status';

  it('is refused without the syncProviderStatus option', async () => {
    const { send, call } = await setup();
    expect(await body(await call('/api/session'))).toMatchObject({ providerSync: false });
    const response = await send('POST', path, {});
    expect(response.status).toBe(404);
    expect((await body(response)).error).toBe(
      'Syncing provider statuses is not set up: pass `syncProviderStatus` to createLaci().',
    );
  });

  it('stores the status from the provider', async () => {
    const { send, call } = await setup({ syncProviderStatus: () => 'REJECTED' });
    expect(await body(await call('/api/session'))).toMatchObject({ providerSync: true });
    const response = await send('POST', `${path}?environment=production&locale=id-ID`, {});
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      version: 2,
      updatedBy: 'dev-1',
      value: { providerStatus: 'REJECTED', providerSyncedAt: '2026-10-27T08:00:00.000Z' },
      warnings: [{ path: 'providerStatus', code: 'providerStatus' }],
    });
    const anonymous = await send('POST', path, {}, null);
    expect(await body(anonymous)).toMatchObject({ version: 2 });
  });

  it('reports provider failures as 502 and missing templates as 404', async () => {
    const failing = await setup({
      syncProviderStatus: () => Promise.reject(new Error('Meta is down')),
    });
    const down = await failing.send('POST', path, {});
    expect(down.status).toBe(502);
    expect((await body(down)).error).toBe('Syncing the provider status failed: Meta is down');
    const missing = await failing.send('POST', '/api/entries/nope/sync-provider-status', {});
    expect(missing.status).toBe(404);

    const odd = await setup({
      syncProviderStatus: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'quota';
      },
    });
    expect((await body(await odd.send('POST', path, {}))).error).toBe(
      'Syncing the provider status failed: quota',
    );
    const wrong = await setup({ syncProviderStatus: () => 'OK' as never });
    const answer = await wrong.send('POST', path, {});
    expect(answer.status).toBe(502);
    expect((await body(answer)).error).toContain('syncProviderStatus must return');
  });
});
