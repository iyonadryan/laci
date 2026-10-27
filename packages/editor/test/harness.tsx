import { render } from '@testing-library/react';
import { createLaci, MemoryStore } from '@lacijs/core';
import type { Laci, LaciOptions } from '@lacijs/core';
import { createStudioHandler } from '../../studio/src/handler';
import type { StudioOptions } from '../../studio/src/handler';
import { LaciEditor } from '../src';
import type { LaciEditorProps } from '../src';

/** Badge colors per customer category. */
export const colors = {
  schema: {
    type: 'array',
    uniqueBy: 'category',
    items: {
      type: 'object',
      required: ['category', 'label', 'background', 'text'],
      properties: {
        category: { type: 'string' },
        label: { type: 'string' },
        background: { type: 'string', format: 'color' },
        text: { type: 'string', format: 'color' },
      },
    },
  },
  value: [
    { category: 'VIP', label: 'VIP', background: '#8A5A44', text: '#FFFFFF' },
    { category: 'NEW', label: 'Customer Baru', background: '#E5F3EA', text: '#1D6B3A' },
  ],
};

/** Customers, sessions, slots: three levels of lists. */
export const customers = {
  schema: {
    type: 'array',
    items: {
      type: 'object',
      required: ['customerCode', 'sessions'],
      properties: {
        customerCode: { type: 'string', minLength: 1, title: 'Customer code' },
        name: { type: 'string', description: 'Shown to viewers' },
        isLive: { type: 'boolean' },
        sessions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['date', 'slots'],
            properties: {
              date: { type: 'string', format: 'date' },
              slots: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  value: [
    {
      customerCode: 'JKT01',
      name: 'Customer Sunter',
      isLive: true,
      sessions: [{ date: '2026-11-01', slots: ['10:00', '14:00'] }],
    },
  ],
};

export const approvalEmail = {
  kind: 'EMAIL_TEMPLATE' as const,
  schema: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, amount: { type: 'number' } },
    examples: [{ name: 'Budi', amount: 1500 }],
  },
  value: {
    subject: 'Halo {{ name }}',
    html: '<p>Halo {{ name }}, total {{ amount | formatNumber }}</p>',
    text: 'Halo {{ name }}',
  },
};

export const reminder = {
  kind: 'MESSAGE_TEMPLATE' as const,
  channel: 'WHATSAPP' as const,
  schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  value: {
    providerTemplateName: 'live_reminder',
    category: 'UTILITY',
    header: 'Live {{ name }}',
    body: 'Hi {{ name }}, we are live!',
    footer: 'Reply STOP',
    buttons: [{ type: 'URL', text: 'Watch', url: 'https://example.com/{{ name }}' }],
    providerStatus: 'APPROVED',
  },
};

/** A Laci instance with a few entries in production and one in staging. */
export async function seed(options: Partial<LaciOptions> = {}): Promise<Laci> {
  const laci = createLaci({
    store: new MemoryStore(),
    cache: false,
    defaultLocale: 'id-ID',
    environment: 'development',
    ...options,
  });
  const production = { environment: 'production', by: 'Rina' } as const;
  await laci.define('customerCategoryColor', {
    ...colors,
    ...production,
    description: 'Badge colors',
  });
  await laci.define('customerLiveStream', { ...customers, ...production });
  await laci.define('linkPath', {
    ...production,
    schema: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
    value: { help: 'https://help.example.com' },
  });
  await laci.define('linkPath', {
    environment: 'staging',
    schema: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
    value: { help: 'https://staging.example.com' },
  });
  await laci.define('approval-request', { ...approvalEmail, ...production });
  await laci.define('live-reminder', { ...reminder, ...production });
  await laci.define('live-reminder', {
    ...production,
    kind: 'MESSAGE_TEMPLATE',
    channel: 'SMS',
    schema: reminder.schema,
    value: { body: 'Hi {{ name }}' },
  });
  return laci;
}

/** Renders the editor over a real studio handler. */
export async function setup(
  options: {
    laci?: Laci;
    studio?: Partial<StudioOptions>;
    editor?: Partial<LaciEditorProps>;
    user?: { id: string; name?: string } | null;
  } = {},
) {
  const laci = options.laci ?? (await seed({ environment: 'production' }));
  const handler = createStudioHandler({ ...options.studio, laci, uiDir: '.' });
  const requests: Request[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'http://localhost/laci/',
    );
    const request = new Request(url, init);
    requests.push(request.clone());
    return handler(request, {
      path: url.pathname.slice('/laci'.length),
      user: options.user === undefined ? { id: 'dev-1', name: 'Dev One' } : options.user,
    });
  };
  const result = render(<LaciEditor fetch={fetch} {...options.editor} />);
  return { ...result, laci, requests };
}
