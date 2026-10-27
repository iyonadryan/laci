import { describe, expect, it } from 'vitest';
import {
  analyzeTemplate,
  checkEmailTemplate,
  createLaci,
  EntryNotFoundError,
  LaciValidationError,
  MemoryStore,
  renderEmailTemplate,
  TemplateRenderError,
} from '../src';
import type { EmailTemplateValue, LaciOptions } from '../src';
import { approvalRequest } from './fixtures';

const idr = (amount: number, locale = 'id-ID') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'IDR' }).format(amount);
const longDate = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(Date.parse(date));

const data = {
  managerName: 'Rina',
  requester: { name: 'Budi', department: 'Ops' },
  amount: 1_500_000,
  dueDate: '2026-11-01',
  link: 'https://app.example.com/requests/42',
  items: ['Laptop', 'Monitor'],
};

async function setup(options: Partial<LaciOptions> = {}) {
  const laci = createLaci({ store: new MemoryStore(), defaultLocale: 'id-ID', ...options });
  await laci.define('approval-request', approvalRequest);
  return laci;
}

/** A schema declaring `names` as string variables. */
const vars = (...names: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
});

const email = (overrides: Partial<EmailTemplateValue> = {}): EmailTemplateValue => ({
  subject: 'Hi {{ name }}',
  html: '<p>Hi {{ name }}</p>',
  text: 'Hi {{ name }}',
  ...overrides,
});

describe('email template validation', () => {
  it('accepts a valid template', () => {
    expect(checkEmailTemplate(approvalRequest.value, approvalRequest.schema)).toEqual([]);
    expect(checkEmailTemplate(email(), vars('name'))).toEqual([]);
  });

  it('requires subject, html, and text, and nothing else', () => {
    expect(checkEmailTemplate({ subject: 'x', html: '' }, vars())).toEqual([
      { path: 'text', message: 'is required', keyword: 'required' },
    ]);
    expect(checkEmailTemplate({ ...email(), body: 'x' }, vars('name'))[0]).toMatchObject({
      path: 'body',
      keyword: 'additionalProperties',
    });
    expect(checkEmailTemplate(email({ subject: '' }), vars('name'))[0]?.path).toBe('subject');
    expect(checkEmailTemplate('Hi', vars())[0]?.keyword).toBe('type');
  });

  it('reports template syntax errors and unknown filters per field', () => {
    const issues = checkEmailTemplate(
      email({ html: '<p>{% if name %}</p>', text: '{{ name | shout }}' }),
      vars('name'),
    );
    expect(issues.map((issue) => [issue.path, issue.keyword])).toEqual([
      ['html', 'template'],
      ['text', 'template'],
    ]);
    expect(issues[0]?.message).toBe(
      'has a template error: tag {% if name %} not closed, line:1, col:4',
    );
    expect(issues[1]?.message).toContain('undefined filter: shout');
  });

  it('reports variables the schema does not declare, but not loop variables', () => {
    const value = email({
      subject: 'Order {{ order.id }}',
      html: '{% for line in order.lines %}{{ line.name }} {{ forloop.index }}{% endfor %}{% assign n = total %}{{ n }}',
      text: '{{ customer }}',
    });
    expect(checkEmailTemplate(value, vars('order'))).toEqual([
      {
        path: 'html',
        message: 'uses the variable "total", which the schema does not define',
        keyword: 'variable',
      },
      {
        path: 'text',
        message: 'uses the variable "customer", which the schema does not define',
        keyword: 'variable',
      },
    ]);
    expect(checkEmailTemplate(email(), { type: 'object' })).toHaveLength(3);
  });

  it('refuses tags that read other templates', () => {
    for (const tag of [
      '{% include "footer" %}',
      '{% render "x" %}',
      '{% layout "base" %}',
      '{% block a %}{% endblock %}',
    ]) {
      const [issue] = checkEmailTemplate(email({ html: tag }), vars('name'));
      expect(issue?.message).toContain('is not supported: Laci templates are self-contained');
    }
  });

  it('is checked by define and set', async () => {
    const laci = await setup();
    await expect(
      laci.set('approval-request', email({ text: '{{ missing }}' }), { kind: 'EMAIL_TEMPLATE' }),
    ).rejects.toMatchObject({
      target: 'value',
      issues: [{ path: 'subject' }, { path: 'html' }, { path: 'text' }],
    });
    await expect(
      laci.define('other', { kind: 'EMAIL_TEMPLATE', schema: { type: 'array' }, value: email() }),
    ).rejects.toMatchObject({
      code: 'INVALID_SCHEMA',
      issues: [
        {
          path: 'type',
          message: 'must be "object": the schema of a template describes its variables',
        },
      ],
    });
    await expect(
      laci.define('other', {
        kind: 'EMAIL_TEMPLATE',
        schema: vars('name'),
        value: { subject: 'x' },
      }),
    ).rejects.toMatchObject({ target: 'value' });
  });
});

describe('renderEmail', () => {
  it('renders every field with the data', async () => {
    const laci = await setup();
    const mail = await laci.renderEmail('approval-request', data);
    expect(mail.locale).toBe('id-ID');
    expect(mail.fromName).toBe('Finance Ops');
    expect(mail.subject).toBe(`Approval needed: Budi (${idr(1_500_000)})`);
    expect(mail.html).toContain(
      `<p>Budi asks for ${idr(1_500_000)} by ${longDate('2026-11-01', 'id-ID')}.</p>`,
    );
    expect(mail.html).toContain('<ul><li>Laptop</li><li>Monitor</li></ul>');
    expect(mail.html).not.toContain('blockquote');
    expect(mail.text).toBe(
      `Hi Rina,\nBudi asks for ${idr(1_500_000)} by ${longDate('2026-11-01', 'id-ID')}.\n- Laptop\n- Monitor\nReview: https://app.example.com/requests/42`,
    );
  });

  it('escapes HTML in the html body only', async () => {
    const laci = await setup();
    const mail = await laci.renderEmail('approval-request', {
      ...data,
      managerName: '<script>alert("x")</script>',
      note: 'Tom & Jerry <3',
    });
    expect(mail.html).toContain('<p>Hi &lt;script&gt;alert(&#34;x&#34;)&lt;/script&gt;,</p>');
    expect(mail.html).toContain('<blockquote>Tom &amp; Jerry &lt;3</blockquote>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('Hi <script>alert("x")</script>,');
  });

  it('keeps output marked raw unescaped', async () => {
    const mail = await renderEmailTemplate({
      value: email({ html: '{{ name | raw }}|{{ name }}' }),
      schema: vars('name'),
      data: { name: '<b>x</b>' },
      locale: 'en',
      timeZone: 'UTC',
    });
    expect(mail.html).toBe('<b>x</b>|&lt;b&gt;x&lt;/b&gt;');
    expect(mail.fromName).toBeNull();
  });

  it('puts the subject and sender on one line, so data cannot add headers', async () => {
    const mail = await renderEmailTemplate({
      value: email({ fromName: '{{ name }}' }),
      schema: vars('name'),
      data: { name: 'Budi\r\nBcc: all@example.com\n' },
      locale: 'en',
      timeZone: 'UTC',
    });
    expect(mail.subject).toBe('Hi Budi Bcc: all@example.com');
    expect(mail.fromName).toBe('Budi Bcc: all@example.com');
  });

  it('formats numbers and dates for the locale of the template', async () => {
    const laci = await setup();
    await laci.define('approval-request', { ...approvalRequest, locale: 'en-US' });
    const mail = await laci.renderEmail('approval-request', data, { locale: 'en-US' });
    expect(mail.locale).toBe('en-US');
    expect(mail.text).toContain(
      `asks for ${idr(1_500_000, 'en-US')} by ${longDate('2026-11-01', 'en-US')}.`,
    );
  });

  it('fails clearly when required variables are missing or have the wrong type', async () => {
    const laci = await setup();
    const { managerName: _, ...missing } = data;
    const error = await laci
      .renderEmail('approval-request', {
        ...missing,
        requester: { department: 'Ops' },
        amount: 'lots',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LaciValidationError);
    expect(error).toMatchObject({
      target: 'data',
      issues: [
        { path: 'managerName', message: 'is required' },
        { path: 'requester.name', message: 'is required' },
        { path: 'amount', message: 'must be number' },
      ],
    });
    expect((error as Error).message).toMatch(
      /^Data of "approval-request" \(production, id-ID\) is invalid \(3 issues\)/,
    );
    await expect(laci.renderEmail('approval-request')).rejects.toMatchObject({ target: 'data' });
  });

  it('treats data as JSON, so dates become ISO strings', async () => {
    const mail = await renderEmailTemplate({
      value: email({ text: '{{ at | formatDate: "datetime" }}' }),
      schema: {
        type: 'object',
        properties: { at: { type: 'string', format: 'date-time' }, name: {} },
      },
      data: { at: new Date('2026-11-01T02:30:00Z'), name: 'x' },
      locale: 'en-US',
      timeZone: 'Asia/Jakarta',
    });
    expect(mail.text).toBe(
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta',
      }).format(Date.parse('2026-11-01T02:30:00Z')),
    );
  });

  it('refuses data that is not an object', async () => {
    for (const bad of [[1], 'x', null]) {
      await expect(
        renderEmailTemplate({
          value: email(),
          schema: vars('name'),
          data: bad,
          locale: 'en',
          timeZone: 'UTC',
        }),
      ).rejects.toMatchObject({
        target: 'data',
        issues: [{ message: 'must be an object of template variables' }],
      });
    }
  });

  it('wraps render failures with the field', async () => {
    const error = await renderEmailTemplate({
      value: email({ text: '{{ name | formatDate }}' }),
      schema: vars('name'),
      data: { name: 'soon' },
      locale: 'en',
      timeZone: 'UTC',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TemplateRenderError);
    expect(error).toMatchObject({ code: 'TEMPLATE_RENDER_FAILED', field: 'text' });
    expect((error as Error).message).toMatch(
      /^Could not render text of email template: formatDate: "soon" is not a date/,
    );
  });

  it('stops runaway loops', async () => {
    await expect(
      renderEmailTemplate({
        value: email({ text: '{% for i in (1..100000000) %}xxxxxxxxxx{% endfor %}' }),
        schema: vars('name'),
        data: { name: 'x' },
        locale: 'en',
        timeZone: 'UTC',
      }),
    ).rejects.toThrow(TemplateRenderError);
  });

  it('does not expose object internals', async () => {
    const mail = await renderEmailTemplate({
      value: email({ text: '[{{ name.constructor }}][{{ name.__proto__ }}][{{ name.length }}]' }),
      schema: vars('name'),
      data: { name: 'abc' },
      locale: 'en',
      timeZone: 'UTC',
    });
    expect(mail.text).toBe('[][][3]');
  });

  it('only renders published templates, and sees changes at once', async () => {
    const laci = await setup();
    await laci.renderEmail('approval-request', data);
    await laci.update('approval-request', { status: 'DRAFT' }, { kind: 'EMAIL_TEMPLATE' });
    await expect(laci.renderEmail('approval-request', data)).rejects.toThrow(EntryNotFoundError);
    await laci.update(
      'approval-request',
      {
        status: 'PUBLISHED',
        value: { ...approvalRequest.value, subject: 'New {{ managerName }}' },
      },
      { kind: 'EMAIL_TEMPLATE' },
    );
    expect((await laci.renderEmail('approval-request', data)).subject).toBe('New Rina');
    await expect(
      laci.renderEmail('approval-request', data, { environment: 'staging' }),
    ).rejects.toThrow('No published version of "approval-request" (staging) for locale id-ID.');
  });

  it('uses the time zone of the instance, the call, or the filter', async () => {
    const value = email({
      text: '{{ at | formatDate: "time" }}|{{ at | formatDate: "time", "UTC" }}',
    });
    const schema = { type: 'object', properties: { at: { type: 'string' }, name: {} } };
    const laci = createLaci({ store: new MemoryStore(), timeZone: 'Asia/Jakarta' });
    expect(laci.timeZone).toBe('Asia/Jakarta');
    await laci.define('t', { kind: 'EMAIL_TEMPLATE', schema, value, locale: 'en-GB' });
    const at = '2026-11-01T02:30:00Z';
    expect((await laci.renderEmail('t', { at }, { locale: 'en-GB' })).text).toBe('09:30|02:30');
    expect(
      (await laci.renderEmail('t', { at }, { locale: 'en-GB', timeZone: 'America/New_York' })).text,
    ).toBe('22:30|02:30');
    expect(createLaci({ store: new MemoryStore() }).timeZone).toBe('UTC');
    expect(() => createLaci({ store: new MemoryStore(), timeZone: 'Mars/Olympus' })).toThrow(
      RangeError,
    );
  });
});

describe('formatting filters', () => {
  const render = (text: string, values: Record<string, unknown>, locale = 'en-US') =>
    renderEmailTemplate({
      value: email({ subject: 'x', text }),
      schema: {
        type: 'object',
        properties: Object.fromEntries(Object.keys({ name: 0, ...values }).map((k) => [k, {}])),
      },
      data: values,
      locale,
      timeZone: 'UTC',
    }).then((mail) => mail.text);

  it('formatDate supports every style, numbers, and calendar dates', async () => {
    const at = Date.parse('2026-11-01T15:04:00Z');
    const format = (options: Intl.DateTimeFormatOptions, value: number = at) =>
      new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(value);
    expect(await render('{{ at | formatDate }}', { at })).toBe(format({ dateStyle: 'medium' }));
    for (const style of ['short', 'medium', 'long', 'full'] as const) {
      expect(
        await render(`{{ at | formatDate: "${style}" }}`, { at: '2026-11-01T15:04:00Z' }),
      ).toBe(format({ dateStyle: style }));
    }
    expect(await render('{{ at | formatDate: "datetime" }}', { at })).toBe(
      format({ dateStyle: 'medium', timeStyle: 'short' }),
    );
    // A calendar date stays the same day in every time zone.
    expect(
      await render('{{ d | formatDate: "long", "America/Los_Angeles" }}', { d: '2026-11-01' }),
    ).toBe('November 1, 2026');
    await expect(render('{{ at | formatDate: "weekday" }}', { at })).rejects.toThrow(
      'formatDate: unknown style "weekday"',
    );
    await expect(render('{{ at | formatDate }}', { at: true })).rejects.toThrow(
      'formatDate: true is not a date',
    );
    expect(await render('[{{ at | formatDate }}][{{ none | formatDate }}]', { at: null })).toBe(
      '[][]',
    );
  });

  it('formatNumber supports decimal, fraction digits, currency, and percent', async () => {
    expect(await render('{{ n | formatNumber }}', { n: 1234567.891 })).toBe('1,234,567.891');
    expect(await render('{{ n | formatNumber }}', { n: '1234.5' }, 'id-ID')).toBe('1.234,5');
    expect(await render('{{ n | formatNumber: "decimal", 2 }}', { n: 3 })).toBe('3.00');
    expect(await render('{{ n | formatNumber: "currency", "USD" }}', { n: 9.5 })).toBe('$9.50');
    expect(await render('{{ n | formatNumber: "percent" }}', { n: 0.25 })).toBe('25%');
    expect(await render('[{{ n | formatNumber }}][{{ none | formatNumber }}]', { n: null })).toBe(
      '[][]',
    );
    await expect(render('{{ n | formatNumber: "currency" }}', { n: 1 })).rejects.toThrow(
      'needs a currency code',
    );
    await expect(render('{{ n | formatNumber: "bytes" }}', { n: 1 })).rejects.toThrow(
      'unknown style "bytes"',
    );
    for (const n of ['abc', '', ' ', true]) {
      await expect(render('{{ n | formatNumber }}', { n })).rejects.toThrow('is not a number');
    }
  });
});

describe('analyzeTemplate', () => {
  it('lists top-level variables or the parse error', () => {
    expect(analyzeTemplate('{{ a.b }} {% for x in list %}{{ x }}{% endfor %}')).toEqual({
      error: null,
      variables: ['a', 'list'],
    });
    expect(analyzeTemplate('{{ a | nope }}', 'html').error).toContain('undefined filter: nope');
  });
});

describe('internals', () => {
  it('describes render failures that are not errors', () => {
    expect(new TemplateRenderError('"x"', 'html', 'boom').message).toBe(
      'Could not render html of "x": boom',
    );
  });

  it('keeps rendering after many locale and time zone combinations', async () => {
    const value = email({ text: '{{ n | formatNumber }}' });
    const schema = { type: 'object', properties: { n: {}, name: {} } };
    // 4 locales x 29 time zones: more engines than the cache keeps.
    for (const locale of ['en-US', 'de-DE', 'id-ID', 'fr-FR']) {
      for (let hours = -14; hours <= 14; hours++) {
        const timeZone = hours === 0 ? 'UTC' : `Etc/GMT${hours > 0 ? '+' : ''}${hours}`;
        await renderEmailTemplate({ value, schema, data: { n: 1 }, locale, timeZone });
      }
    }
    expect(
      (
        await renderEmailTemplate({
          value,
          schema,
          data: { n: 1000 },
          locale: 'de-DE',
          timeZone: 'UTC',
        })
      ).text,
    ).toBe('1.000');
  });
});
