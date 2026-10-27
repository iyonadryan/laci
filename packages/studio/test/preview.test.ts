import type { RenderedEmail } from '@lacijs/core';
import type { SendTestMessage } from '../src/handler';
import { approvalRequest, setupHandler } from './fixtures';

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('POST api/preview/email', () => {
  it('renders a stored template in any status with sample data', async () => {
    const { send, laci } = await setupHandler();
    await laci.update('approval-request', { status: 'DRAFT' }, { kind: 'EMAIL_TEMPLATE' });
    const response = await send('POST', '/api/preview/email', {
      key: 'approval-request',
      data: { name: '<Budi>', amount: 1500 },
    });
    expect(response.status).toBe(200);
    expect(await body<RenderedEmail>(response)).toEqual({
      fromName: null,
      subject: 'Halo <Budi>',
      html: '<p>Halo &lt;Budi&gt;, total 1.500</p>',
      text: 'Halo <Budi>',
      locale: 'id-ID',
    });
  });

  it('renders unsaved changes, with a locale and time zone', async () => {
    const { send } = await setupHandler();
    const response = await send('POST', '/api/preview/email', {
      value: { ...approvalRequest.value, text: '{{ at | formatDate: "time" }}' },
      schema: {
        ...approvalRequest.schema,
        properties: { ...approvalRequest.schema.properties, at: {} },
      },
      data: { name: 'x', at: '2026-11-01T02:30:00Z' },
      locale: 'en-GB',
      timeZone: 'Asia/Jakarta',
    });
    expect(await body(response)).toMatchObject({ text: '09:30', locale: 'en-GB' });
    const defaults = await send('POST', '/api/preview/email', {
      value: approvalRequest.value,
      schema: approvalRequest.schema,
      data: { name: 'x' },
    });
    expect(await body(defaults)).toMatchObject({ locale: 'id-ID' });
  });

  it('reports invalid templates, schemas, and data with their paths', async () => {
    const { send } = await setupHandler();
    const template = await send('POST', '/api/preview/email', {
      value: { ...approvalRequest.value, text: '{{ nope }}' },
      schema: approvalRequest.schema,
    });
    expect(template.status).toBe(422);
    expect(await body(template)).toMatchObject({
      target: 'value',
      issues: [{ path: 'text', keyword: 'variable' }],
    });
    const schema = await send('POST', '/api/preview/email', {
      value: approvalRequest.value,
      schema: { type: 'array' },
    });
    expect(await body(schema)).toMatchObject({ code: 'INVALID_SCHEMA', target: 'schema' });
    const data = await send('POST', '/api/preview/email', { key: 'approval-request' });
    expect(data.status).toBe(422);
    expect(await body(data)).toMatchObject({
      target: 'data',
      issues: [{ path: 'name', message: 'is required' }],
    });
  });

  it('reports render failures with the field', async () => {
    const { send } = await setupHandler();
    const response = await send('POST', '/api/preview/email', {
      key: 'approval-request',
      data: { name: 'x', amount: 'lots' },
    });
    expect(response.status).toBe(422);
    expect(await body(response)).toMatchObject({ target: 'data' });
    const failing = await send('POST', '/api/preview/email', {
      value: { ...approvalRequest.value, text: '{{ name | formatDate }}' },
      schema: approvalRequest.schema,
      data: { name: 'soon' },
    });
    expect(failing.status).toBe(422);
    expect(await body(failing)).toMatchObject({ code: 'TEMPLATE_RENDER_FAILED', field: 'text' });
  });

  it('rejects bad requests', async () => {
    const { send } = await setupHandler();
    for (const [payload, status, error] of [
      [{}, 400, 'Pass "key" or "value" and "schema".'],
      [{ value: approvalRequest.value }, 400, '"schema" must be a JSON Schema object.'],
      [
        { key: 'approval-request', timeZone: 'Mars/Base' },
        400,
        '"timeZone" must be an IANA time zone such as "Asia/Jakarta".',
      ],
      [
        { key: 'approval-request', locale: 'en' },
        404,
        'Entry "approval-request" (en) does not exist or is not published.',
      ],
      [{ key: 'linkPath' }, 404, 'Entry "linkPath" does not exist or is not published.'],
    ] as const) {
      const response = await send('POST', '/api/preview/email', payload);
      expect(response.status).toBe(status);
      expect((await body(response)).error).toBe(error);
    }
  });
});

describe('POST api/send-test', () => {
  it('is refused without a sendTest callback', async () => {
    const { send, call } = await setupHandler();
    expect(await body(await call('/api/session'))).toMatchObject({ sendTest: false });
    const response = await send('POST', '/api/send-test', { key: 'approval-request', to: 'a@b.c' });
    expect(response.status).toBe(404);
    expect((await body(response)).error).toBe(
      'Sending tests is not set up: pass `sendTest` to the studio.',
    );
  });

  it('renders the template and passes it to sendTest', async () => {
    const sent: SendTestMessage[] = [];
    const { send, call } = await setupHandler({ sendTest: (message) => void sent.push(message) });
    expect(await body(await call('/api/session'))).toMatchObject({ sendTest: true });
    const response = await send('POST', '/api/send-test', {
      kind: 'EMAIL_TEMPLATE',
      key: 'approval-request',
      data: { name: 'Budi' },
      to: 'rina@example.com',
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ sent: true, rendered: { subject: 'Halo Budi' } });
    expect(sent).toEqual([
      {
        kind: 'EMAIL_TEMPLATE',
        channel: null,
        key: 'approval-request',
        to: 'rina@example.com',
        rendered: expect.objectContaining({ subject: 'Halo Budi' }) as RenderedEmail,
      },
    ]);

    await send('POST', '/api/send-test', {
      value: approvalRequest.value,
      schema: approvalRequest.schema,
      data: { name: 'Unsaved' },
      to: 'rina@example.com',
    });
    expect(sent[1]).toMatchObject({ key: null, rendered: { subject: 'Halo Unsaved' } });
  });

  it('reports bad requests and failed sends', async () => {
    const { send } = await setupHandler({
      sendTest: () => Promise.reject(new Error('SMTP refused')),
    });
    for (const [payload, status, error] of [
      [{ key: 'approval-request', data: { name: 'x' } }, 400, '"to" is required.'],
      [
        { kind: 'CONFIG', key: 'linkPath', to: 'a@b.c' },
        400,
        'Only templates can be sent as a test.',
      ],
      [
        { key: 'approval-request', data: { name: 'x' }, to: 'a@b.c' },
        502,
        'Sending the test failed: SMTP refused',
      ],
    ] as const) {
      const response = await send('POST', '/api/send-test', payload);
      expect(response.status).toBe(status);
      expect((await body(response)).error).toBe(error);
    }
    const thrown = await setupHandler({
      sendTest: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'quota';
      },
    });
    const response = await thrown.send('POST', '/api/send-test', {
      key: 'approval-request',
      data: { name: 'x' },
      to: 'a@b.c',
    });
    expect((await body(response)).error).toBe('Sending the test failed: quota');
  });

  it('needs the CSRF header like every change', async () => {
    const { call } = await setupHandler({ sendTest: () => undefined });
    const response = await call('/api/send-test', { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
  });
});
