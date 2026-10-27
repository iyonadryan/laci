import type { StudioValidation } from '../src/handler';
import { colors, setupHandler } from './fixtures';

async function validate(body: unknown) {
  const { send } = await setupHandler();
  const response = await send('POST', '/api/validate', body);
  return {
    status: response.status,
    body: (await response.json()) as StudioValidation & { error?: string },
  };
}

describe('POST api/validate', () => {
  it('accepts a valid value and reports its size', async () => {
    expect(await validate({ schema: colors.schema, value: colors.value })).toEqual({
      status: 200,
      body: {
        valid: true,
        target: null,
        issues: [],
        warnings: [],
        bytes: JSON.stringify(colors.value).length,
      },
    });
  });

  it('reports what is wrong with the value or the schema', async () => {
    const value = await validate({ schema: colors.schema, value: [{ category: 'VIP' }] });
    expect(value.body).toMatchObject({
      valid: false,
      target: 'value',
      issues: [{ path: '[0].background', keyword: 'required' }],
    });
    const schema = await validate({ schema: { type: 'nope' }, value: 1 });
    expect(schema.body).toMatchObject({ valid: false, target: 'schema' });
  });

  it('checks templates and warns about messages', async () => {
    const email = await validate({
      kind: 'EMAIL_TEMPLATE',
      schema: { type: 'object' },
      value: { subject: '{{ who }}', html: '', text: '' },
    });
    expect(email.body.issues).toEqual([expect.objectContaining({ keyword: 'variable' })]);
    const approved = {
      providerTemplateName: 'x',
      category: 'UTILITY',
      body: 'Hi',
      providerStatus: 'APPROVED',
    };
    const message = await validate({
      kind: 'MESSAGE_TEMPLATE',
      channel: 'WHATSAPP',
      schema: { type: 'object' },
      value: { ...approved, body: 'Hello', providerStatus: 'PENDING' },
      previous: approved,
    });
    expect(message.body).toMatchObject({ valid: true, warnings: [{ code: 'approvalReset' }] });
  });

  it('rejects bad requests', async () => {
    for (const [payload, error] of [
      [{ value: 1 }, '"schema" must be a JSON Schema object.'],
      [{ schema: {} }, '"value" is required.'],
      [{ kind: 'MESSAGE_TEMPLATE', schema: {}, value: {} }, '"channel" is required.'],
    ] as const) {
      const { status, body } = await validate(payload);
      expect(status).toBe(400);
      expect(body.error).toBe(error);
    }
  });
});
