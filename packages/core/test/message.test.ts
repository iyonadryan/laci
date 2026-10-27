import { describe, expect, it } from 'vitest';
import {
  checkMessageTemplate,
  createLaci,
  EntryNotFoundError,
  LaciError,
  LaciValidationError,
  MemoryStore,
  messageWarnings,
  renderMessageTemplate,
  TemplateRenderError,
  UnexpectedValueError,
  whatsAppProviderTemplate,
} from '../src';
import type { Entry, LaciOptions, ProviderStatus, WhatsAppTemplateValue } from '../src';
import { liveReminder } from './fixtures';

const data = { name: 'Rina', startAt: '2026-11-01T02:30:00Z', code: 'ab12' };

const dateTime = (value: string, locale = 'en-US', timeZone = 'UTC') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    Date.parse(value),
  );

/** A schema declaring `names` as string variables. */
const vars = (...names: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
});

const whatsApp = (overrides: Partial<WhatsAppTemplateValue> = {}): WhatsAppTemplateValue => ({
  ...liveReminder.value,
  ...overrides,
});

async function setup(options: Partial<LaciOptions> = {}) {
  let clock = new Date('2026-10-27T08:00:00Z');
  const laci = createLaci({
    store: new MemoryStore(),
    defaultLocale: 'en-US',
    now: () => clock,
    ...options,
  });
  await laci.define('live-reminder', liveReminder);
  await laci.define('live-reminder', {
    kind: 'MESSAGE_TEMPLATE',
    channel: 'SMS',
    schema: liveReminder.schema,
    value: { body: 'Hi {{ name }}, live at {{ startAt | formatDate: "time" }}.', senderId: 'TOKO' },
  });
  return {
    laci,
    tick: () => {
      clock = new Date(clock.getTime() + 60_000);
      return clock;
    },
  };
}

const select = { kind: 'MESSAGE_TEMPLATE', channel: 'WHATSAPP' } as const;

describe('message template validation', () => {
  it('accepts valid templates of every channel', () => {
    expect(checkMessageTemplate('WHATSAPP', liveReminder.value, liveReminder.schema)).toEqual([]);
    expect(checkMessageTemplate('SMS', { body: 'Hi {{ name }}' }, vars('name'))).toEqual([]);
    expect(
      checkMessageTemplate(
        'PUSH',
        { title: 'Hi', body: '{{ name }}', deepLink: 'app://x/{{ name }}', imageUrl: 'https://i' },
        vars('name'),
      ),
    ).toEqual([]);
    expect(checkMessageTemplate('IN_APP', { body: 'Hi' }, vars())).toEqual([]);
  });

  it('checks the fields of each channel', () => {
    expect(checkMessageTemplate('SMS', {}, vars())).toEqual([
      { path: 'body', message: 'is required', keyword: 'required' },
    ]);
    expect(checkMessageTemplate('SMS', { body: 'x', senderId: 'A'.repeat(16) }, vars())).toEqual([
      expect.objectContaining({ path: 'senderId', keyword: 'maxLength' }),
    ]);
    expect(checkMessageTemplate('PUSH', { body: 'x' }, vars())).toEqual([
      expect.objectContaining({ path: 'title', keyword: 'required' }),
    ]);
    expect(checkMessageTemplate('IN_APP', { body: 'x', html: '<b>' }, vars())).toEqual([
      expect.objectContaining({ path: 'html', keyword: 'additionalProperties' }),
    ]);
    expect(checkMessageTemplate('WHATSAPP', whatsApp({ body: '' }), vars())[0]).toMatchObject({
      path: 'body',
      keyword: 'minLength',
    });
    expect(
      checkMessageTemplate(
        'WHATSAPP',
        { ...liveReminder.value, category: 'PROMO' },
        liveReminder.schema,
      )[0],
    ).toMatchObject({ path: 'category', keyword: 'enum' });
  });

  it('checks template syntax and variables in every templated field', () => {
    expect(checkMessageTemplate('IN_APP', { body: 'x', deepLink: '{{ id }}' }, vars())).toEqual([
      {
        path: 'deepLink',
        message: 'uses the variable "id", which the schema does not define',
        keyword: 'variable',
      },
    ]);
    expect(checkMessageTemplate('PUSH', { title: '{% if %}', body: 'x' }, vars())).toEqual([
      expect.objectContaining({ path: 'title', keyword: 'template' }),
    ]);
  });

  it('applies the rules of WhatsApp templates', () => {
    const issues = (value: WhatsAppTemplateValue) =>
      checkMessageTemplate('WHATSAPP', value, liveReminder.schema).map(({ path, keyword }) => ({
        path,
        keyword,
      }));
    expect(issues(whatsApp({ providerTemplateName: 'Live Reminder' }))).toEqual([
      { path: 'providerTemplateName', keyword: 'pattern' },
    ]);
    expect(issues(whatsApp({ body: '{% if host %}{{ host }}{% endif %}' }))).toEqual([
      { path: 'body', keyword: 'whatsapp' },
    ]);
    expect(issues(whatsApp({ header: '{{ name' }))).toEqual([
      { path: 'header', keyword: 'template' },
    ]);
    expect(issues(whatsApp({ footer: 'Bye {{ name }}' }))).toEqual([
      { path: 'footer', keyword: 'whatsapp' },
    ]);
    expect(issues(whatsApp({ footer: '{{ x' }))).toEqual([{ path: 'footer', keyword: 'template' }]);
    expect(issues(whatsApp({ body: 'Hi {{ nobody }}' }))).toEqual([
      { path: 'body', keyword: 'variable' },
    ]);
    expect(
      issues(
        whatsApp({
          buttons: [
            { type: 'URL', text: '{{ name }}', url: 'https://x/{{ nobody }}' },
            { type: 'URL', text: 'Open' } as never,
            { type: 'QUICK_REPLY', text: 'Ok', url: 'https://x' } as never,
          ],
        }),
      ),
    ).toEqual([
      { path: 'buttons[0].text', keyword: 'whatsapp' },
      { path: 'buttons[0].url', keyword: 'variable' },
      { path: 'buttons[1].url', keyword: 'required' },
      { path: 'buttons[2].url', keyword: 'additionalProperties' },
    ]);
  });

  it('is applied by define and set', async () => {
    const { laci } = await setup();
    await expect(
      laci.define('push', {
        kind: 'MESSAGE_TEMPLATE',
        channel: 'PUSH',
        schema: vars(),
        value: { body: 'x' },
      }),
    ).rejects.toMatchObject({ target: 'value', issues: [{ path: 'title' }] });
    await expect(
      laci.set('live-reminder', whatsApp({ footer: '{{ name }}' }), select),
    ).rejects.toBeInstanceOf(LaciValidationError);
  });
});

describe('whatsAppProviderTemplate', () => {
  it('numbers the {{ }} of the header, the body, and each URL from {{1}}', () => {
    expect(whatsAppProviderTemplate(liveReminder.value)).toEqual({
      header: 'Live soon, {{1}}',
      body: 'Hi {{1}}, your live stream starts {{2}}. Code: {{3}}.',
      footer: 'Reply STOP to opt out',
      buttons: [
        { type: 'URL', text: 'Open', url: 'https://example.com/live/{{1}}' },
        { type: 'QUICK_REPLY', text: 'Remind me later', url: null },
      ],
    });
  });

  it('keeps whitespace control and leaves out missing parts', () => {
    expect(
      whatsAppProviderTemplate({
        providerTemplateName: 'x',
        category: 'UTILITY',
        body: 'A  {{- a }}',
      }),
    ).toEqual({ header: null, body: 'A{{1}}', footer: null, buttons: [] });
  });

  it('copies text it cannot parse as is', () => {
    expect(
      whatsAppProviderTemplate({ providerTemplateName: 'x', category: 'UTILITY', body: '{{ a' })
        .body,
    ).toBe('{{ a');
  });
});

describe('messageWarnings', () => {
  const codes = (
    channel: Parameters<typeof messageWarnings>[0],
    value: unknown,
    previous?: unknown,
  ) => messageWarnings(channel, value, previous).map(({ path, code }) => `${path}:${code}`);

  it('warns about push texts that phones cut off, measuring the fixed text', () => {
    expect(messageWarnings('PUSH', { title: 'T'.repeat(41), body: 'B'.repeat(179) })).toEqual([
      {
        path: 'title',
        message:
          'is at least 41 characters; phones usually cut the title of a push notification after 40',
        code: 'length',
      },
      {
        path: 'body',
        message:
          'is at least 179 characters; phones usually cut the body of a push notification after 178',
        code: 'length',
      },
    ]);
    // Variables are not counted: their length is unknown before rendering.
    expect(codes('PUSH', { title: `${'T'.repeat(39)}{{ name }}`, body: 'x' })).toEqual([]);
  });

  it('warns when an SMS needs UCS-2', () => {
    expect(messageWarnings('SMS', { body: 'Hi 😀 {{ name }}' })).toEqual([
      {
        path: 'body',
        message:
          'uses characters outside GSM-7 (😀), so it is sent as UCS-2: 70 characters per SMS instead of 160',
        code: 'encoding',
      },
    ]);
    expect(codes('SMS', { body: 'Hi {{ name }}' })).toEqual([]);
  });

  it('has nothing to say about in-app messages or invalid values', () => {
    expect(codes('IN_APP', { body: 'x'.repeat(5000) })).toEqual([]);
    expect(codes('PUSH', { body: 'x' })).toEqual([]);
    // Unsaved values may not parse yet; checkMessageTemplate reports that.
    expect(codes('PUSH', { title: `{{ ${'T'.repeat(50)}`, body: 'x' })).toEqual([]);
    expect(codes('SMS', { body: '😀 {{ x' })).toEqual([]);
    expect(whatsAppProviderTemplate(whatsApp({ body: '{% if a %}A{% endif %}' })).body).toBe(
      '{% if a %}',
    );
  });

  it("warns about WhatsApp's limits", () => {
    expect(codes('WHATSAPP', liveReminder.value)).toEqual([]);
    expect(
      codes('WHATSAPP', {
        providerTemplateName: 'x',
        category: 'UTILITY',
        body: 'Hi',
        providerStatus: 'APPROVED',
      }),
    ).toEqual([]);
    expect(
      codes(
        'WHATSAPP',
        whatsApp({
          header: `${'H'.repeat(55)} {{ name }} {{ code }}`,
          body: 'B'.repeat(1025),
          footer: 'F'.repeat(61),
          buttons: [
            { type: 'QUICK_REPLY', text: 'Q'.repeat(26) },
            { type: 'URL', text: 'Open', url: 'https://x/{{ code }}/{{ name }}' },
            { type: 'URL', text: 'Open', url: 'https://x/{{ code }}/end' },
            ...Array.from({ length: 8 }, () => ({ type: 'QUICK_REPLY' as const, text: 'Ok' })),
          ],
        }),
      ),
    ).toEqual([
      'header:length',
      'header:parameter',
      'body:length',
      'footer:length',
      'buttons:length',
      'buttons[0].text:length',
      'buttons[1].url:parameter',
      'buttons[2].url:parameter',
    ]);
  });

  it('warns when a WhatsApp template is not approved, or its approval was reset', () => {
    const status = (providerStatus?: ProviderStatus, previous?: unknown) => {
      const { providerStatus: _, ...rest } = liveReminder.value;
      return messageWarnings(
        'WHATSAPP',
        providerStatus === undefined ? rest : { ...rest, providerStatus },
        previous,
      ).map(({ message }) => message);
    };
    expect(status('APPROVED')).toEqual([]);
    expect(status('PENDING')[0]).toMatch(/^is PENDING: the provider has not approved/);
    expect(status('REJECTED')[0]).toMatch(/^is REJECTED: the provider refused/);
    expect(status()[0]).toMatch(/^is not set:/);
    const before = whatsApp({ body: 'Old {{ name }}' });
    expect(status('PENDING', before)).toEqual([
      'went back from APPROVED to PENDING because the template changed: submit it to the provider for approval again',
    ]);
    // Without a change to the reviewed content it is an ordinary PENDING.
    expect(status('PENDING', liveReminder.value)[0]).toMatch(/^is PENDING/);
  });
});

describe('renderMessage', () => {
  it('renders WhatsApp with the parameters in order', async () => {
    const { laci } = await setup();
    const rendered = await laci.renderMessage('live-reminder', data, { channel: 'WHATSAPP' });
    const at = dateTime(data.startAt);
    expect(rendered).toEqual({
      channel: 'WHATSAPP',
      locale: 'en-US',
      providerTemplateName: 'customer_live_reminder',
      category: 'UTILITY',
      providerStatus: 'APPROVED',
      header: 'Live soon, Rina',
      body: `Hi Rina, your live stream starts ${at}. Code: AB12.`,
      footer: 'Reply STOP to opt out',
      buttons: [
        { type: 'URL', text: 'Open', url: 'https://example.com/live/ab12', params: ['ab12'] },
        { type: 'QUICK_REPLY', text: 'Remind me later', url: null, params: [] },
      ],
      params: ['Rina', 'Rina', at, 'AB12'],
      headerParams: ['Rina'],
      bodyParams: ['Rina', at, 'AB12'],
      warnings: [],
    });
  });

  it('formats in the locale and time zone, as plain text', async () => {
    const { laci } = await setup();
    await laci.define('live-reminder', {
      ...liveReminder,
      locale: 'id-ID',
      value: {
        providerTemplateName: 'customer_live_reminder',
        category: 'UTILITY',
        body: '<b>{{ name }}</b> {{ startAt | formatDate: "datetime" }}',
        providerStatus: 'APPROVED',
      },
    });
    const rendered = await laci.renderMessage(
      'live-reminder',
      { ...data, name: 'A & B' },
      { channel: 'WHATSAPP', locale: 'id-ID', timeZone: 'Asia/Jakarta' },
    );
    expect(rendered).toMatchObject({
      locale: 'id-ID',
      header: null,
      footer: null,
      buttons: [],
      body: `<b>A & B</b> ${dateTime(data.startAt, 'id-ID', 'Asia/Jakarta')}`,
      params: ['A & B', dateTime(data.startAt, 'id-ID', 'Asia/Jakarta')],
    });
  });

  it('warns about parameters WhatsApp refuses and unapproved templates', async () => {
    const rendered = await renderMessageTemplate({
      channel: 'WHATSAPP',
      value: whatsApp({ body: '{{ name }} {{ host }} {{ code }}', providerStatus: 'PENDING' }),
      schema: liveReminder.schema,
      data: { ...data, name: 'Line\nbreak', code: 'a     b' },
      locale: 'en-US',
      timeZone: 'UTC',
    });
    expect(rendered.warnings.map(({ path, message }) => `${path}: ${message}`)).toEqual([
      expect.stringMatching(/^providerStatus: is PENDING/),
      'header: parameter {{1}} has a line break, a tab, or more than 4 spaces in a row, which WhatsApp refuses',
      'body: parameter {{1}} has a line break, a tab, or more than 4 spaces in a row, which WhatsApp refuses',
      'body: parameter {{2}} is empty, which WhatsApp refuses',
      'body: parameter {{3}} has a line break, a tab, or more than 4 spaces in a row, which WhatsApp refuses',
      'buttons[0].url: parameter {{1}} has a line break, a tab, or more than 4 spaces in a row, which WhatsApp refuses',
    ]);
  });

  it('leaves out what a template does not set', async () => {
    const plain = { locale: 'en-US', timeZone: 'UTC', schema: vars() } as const;
    expect(
      await renderMessageTemplate({
        ...plain,
        channel: 'WHATSAPP',
        value: { providerTemplateName: 'x', category: 'UTILITY', body: 'Hi' },
      }),
    ).toMatchObject({
      providerStatus: null,
      params: [],
      warnings: [expect.objectContaining({ path: 'providerStatus' })],
    });
    expect(
      await renderMessageTemplate({ ...plain, channel: 'SMS', value: { body: 'Hi' } }),
    ).toMatchObject({ senderId: null, segments: { units: 2 } });
  });

  it('renders SMS with its segments', async () => {
    const { laci } = await setup();
    const rendered = await laci.renderMessage('live-reminder', data, { channel: 'SMS' });
    const body = `Hi Rina, live at ${new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: 'UTC' }).format(Date.parse(data.startAt))}.`;
    expect(rendered).toEqual({
      channel: 'SMS',
      locale: 'en-US',
      body,
      senderId: 'TOKO',
      segments: expect.objectContaining({ encoding: 'GSM-7', segments: 1 }) as unknown,
      warnings: [],
    });
    const emoji = await laci.renderMessage(
      'live-reminder',
      { ...data, name: 'Rina 🎉' },
      { channel: 'SMS' },
    );
    expect(emoji.segments.encoding).toBe('UCS-2');
    expect(emoji.warnings).toEqual([expect.objectContaining({ code: 'encoding' })]);
  });

  it('renders push and in-app messages', async () => {
    const push = await renderMessageTemplate({
      channel: 'PUSH',
      value: { title: '{{ name }} is live', body: 'Join now' },
      schema: vars('name'),
      data: { name: 'N'.repeat(40) },
      locale: 'en-US',
      timeZone: 'UTC',
    });
    expect(push).toEqual({
      channel: 'PUSH',
      locale: 'en-US',
      title: `${'N'.repeat(40)} is live`,
      body: 'Join now',
      deepLink: null,
      imageUrl: null,
      warnings: [
        {
          path: 'title',
          message: 'is 48 characters; phones usually cut the title of a push notification after 40',
          code: 'length',
        },
      ],
    });
    const withLinks = await renderMessageTemplate({
      channel: 'PUSH',
      value: {
        title: 'T',
        body: 'B'.repeat(179),
        deepLink: 'app://{{ id }}',
        imageUrl: 'https://i/{{ id }}.png',
      },
      schema: vars('id'),
      data: { id: '7' },
      locale: 'en-US',
      timeZone: 'UTC',
    });
    expect(withLinks).toMatchObject({
      deepLink: 'app://7',
      imageUrl: 'https://i/7.png',
      warnings: [{ path: 'body', code: 'length' }],
    });
    const inApp = {
      channel: 'IN_APP',
      locale: 'en-US',
      schema: vars('id'),
      timeZone: 'UTC',
    } as const;
    expect(await renderMessageTemplate({ ...inApp, value: { body: 'Saved' } })).toEqual({
      channel: 'IN_APP',
      locale: 'en-US',
      title: null,
      body: 'Saved',
      deepLink: null,
      warnings: [],
    });
    expect(
      await renderMessageTemplate({
        ...inApp,
        value: { title: 'Order {{ id }}', body: 'Ready', deepLink: 'app://orders/{{ id }}' },
        data: { id: '9' },
      }),
    ).toMatchObject({ title: 'Order 9', deepLink: 'app://orders/9' });
  });

  it('validates the data and reports render failures with the field', async () => {
    const { laci } = await setup();
    await expect(
      laci.renderMessage('live-reminder', { name: 'Rina' }, { channel: 'WHATSAPP' }),
    ).rejects.toMatchObject({ target: 'data', issues: [{ path: 'startAt' }, { path: 'code' }] });
    const failing = renderMessageTemplate({
      channel: 'WHATSAPP',
      value: whatsApp({ header: '{{ code | formatDate }}' }),
      schema: liveReminder.schema,
      data,
      locale: 'en-US',
      timeZone: 'UTC',
    });
    await expect(failing).rejects.toBeInstanceOf(TemplateRenderError);
    await expect(failing).rejects.toMatchObject({
      field: 'header',
      message: expect.stringContaining('Could not render header of message template') as unknown,
    });
    await expect(
      renderMessageTemplate({
        channel: 'SMS',
        value: { body: '{{ code | formatNumber }}' },
        schema: liveReminder.schema,
        data,
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    ).rejects.toMatchObject({ field: 'body' });
  });

  it('only renders published templates of the channel', async () => {
    const { laci } = await setup();
    await expect(
      laci.renderMessage('live-reminder', data, { channel: 'PUSH' }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
    await laci.update('live-reminder', { status: 'DRAFT' }, select);
    await expect(
      laci.renderMessage('live-reminder', data, { channel: 'WHATSAPP' }),
    ).rejects.toThrow(
      '"live-reminder" (production, en-US, WHATSAPP) does not exist or is not published.',
    );
  });
});

describe('provider approval', () => {
  it('goes back to PENDING when the reviewed content of an approved template changes', async () => {
    const { laci } = await setup();
    const changed = await laci.set('live-reminder', whatsApp({ body: 'Hi {{ name }}!' }), select);
    expect(changed.value).toMatchObject({ body: 'Hi {{ name }}!', providerStatus: 'PENDING' });

    // Approving again is a change of the status only.
    const approved = await laci.set(
      'live-reminder',
      { ...(changed.value as WhatsAppTemplateValue), providerStatus: 'APPROVED' },
      select,
    );
    expect(approved.value).toMatchObject({ providerStatus: 'APPROVED' });
  });

  it('keeps the approval for changes the provider does not review', async () => {
    const { laci } = await setup();
    const buttons = (liveReminder.value.buttons ?? []).map((button) =>
      Object.fromEntries(Object.entries(button).reverse()),
    ) as WhatsAppTemplateValue['buttons'];
    const reordered = await laci.set(
      'live-reminder',
      whatsApp({ buttons, providerSyncedAt: '2026-10-27T08:00:00.000Z' }),
      select,
    );
    expect(reordered).toMatchObject({ version: 2, value: { providerStatus: 'APPROVED' } });
    const description = await laci.update('live-reminder', { description: 'Reminder' }, select);
    expect(description.value).toMatchObject({ providerStatus: 'APPROVED' });
  });

  it('applies to rollbacks', async () => {
    const { laci } = await setup();
    await laci.set('live-reminder', whatsApp({ body: 'Hi {{ name }}!' }), select);
    // Approved again: version 3.
    await laci.set('live-reminder', whatsApp({ body: 'Hi {{ name }}!' }), select);
    const rolledBack = await laci.rollback('live-reminder', 1, select);
    // Version 1 was approved once, but the provider has approved version 3 since.
    expect(rolledBack.value).toMatchObject({
      body: liveReminder.value.body,
      providerStatus: 'PENDING',
    });
  });
});

describe('syncProviderStatus', () => {
  it('needs the syncProviderStatus option', async () => {
    const { laci } = await setup();
    expect(laci.canSyncProviderStatus).toBe(false);
    const error = await laci.syncProviderStatus('live-reminder').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LaciError);
    expect(error).toMatchObject({ code: 'PROVIDER_SYNC_NOT_CONFIGURED' });
  });

  it('stores a changed status with the time, as a new version', async () => {
    const asked: Entry[] = [];
    let answer: ProviderStatus = 'REJECTED';
    const { laci, tick } = await setup({
      syncProviderStatus: (entry) => {
        asked.push(entry);
        return Promise.resolve(answer);
      },
    });
    expect(laci.canSyncProviderStatus).toBe(true);
    const at = tick();
    const synced = await laci.syncProviderStatus('live-reminder', { by: 'dev-1' });
    expect(asked).toEqual([expect.objectContaining({ key: 'live-reminder', channel: 'WHATSAPP' })]);
    expect(synced).toMatchObject({
      version: 2,
      updatedBy: 'dev-1',
      value: { providerStatus: 'REJECTED', providerSyncedAt: at.toISOString() },
    });
    const history = await laci.history('live-reminder', select);
    expect(history.items[0]).toMatchObject({
      note: 'Provider status: REJECTED',
      changedBy: 'dev-1',
    });

    // The same answer again changes nothing.
    expect(await laci.syncProviderStatus('live-reminder')).toMatchObject({ version: 2 });
    answer = 'APPROVED';
    expect(await laci.syncProviderStatus('live-reminder', { locale: 'en-US' })).toMatchObject({
      version: 3,
      value: { providerStatus: 'APPROVED' },
    });
  });

  it('refuses answers that are not a status, and missing templates', async () => {
    const { laci } = await setup({ syncProviderStatus: () => 'OK' as ProviderStatus });
    await expect(laci.syncProviderStatus('live-reminder')).rejects.toBeInstanceOf(
      UnexpectedValueError,
    );
    await expect(laci.syncProviderStatus('live-reminder')).rejects.toThrow(
      'syncProviderStatus must return PENDING, APPROVED, REJECTED, but returned "OK" for "live-reminder" (production, en-US, WHATSAPP).',
    );
    await expect(laci.syncProviderStatus('nope')).rejects.toBeInstanceOf(EntryNotFoundError);
  });
});
