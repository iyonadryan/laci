import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLaci, MemoryStore } from '@lacijs/core';
import type { Laci } from '@lacijs/core';
import { createStudioHandler } from '../src/handler';
import type { StudioOptions } from '../src/handler';

/** A small UI build for tests, so they do not depend on the real UI build. */
export const UI_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'ui-fixture');

export const CSRF = { 'x-laci-studio': '1', 'content-type': 'application/json' };

/** Badge colors per customer category, as in the README. */
export const colors = {
  schema: {
    type: 'array',
    uniqueBy: 'category',
    items: {
      type: 'object',
      required: ['category', 'background'],
      properties: {
        category: { type: 'string' },
        background: { type: 'string', format: 'color' },
      },
    },
  },
  value: [
    { category: 'VIP', background: '#8A5A44' },
    { category: 'NEW', background: '#E5F3EA' },
  ],
};

/** An email template with one required variable. */
export const approvalRequest = {
  kind: 'EMAIL_TEMPLATE' as const,
  schema: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, amount: { type: 'number' } },
  },
  value: {
    subject: 'Halo {{ name }}',
    html: '<p>Halo {{ name }}, total {{ amount | formatNumber }}</p>',
    text: 'Halo {{ name }}',
  },
};

/** A Laci instance on a MemoryStore with a config in production and staging, and a template. */
export async function createTestLaci(): Promise<Laci> {
  const laci = createLaci({ store: new MemoryStore(), cache: false, defaultLocale: 'id-ID' });
  await laci.define('customerCategoryColor', { ...colors, by: 'seed', description: 'Badges' });
  await laci.define('customerCategoryColor', { ...colors, environment: 'staging' });
  await laci.define('linkPath', {
    schema: { type: 'object' },
    value: { home: '/' },
    status: 'DRAFT',
  });
  await laci.define('approval-request', approvalRequest);
  return laci;
}

/** A handler on a fresh Laci instance and the fixture UI. */
export async function setupHandler(options: Partial<StudioOptions> = {}) {
  const laci = options.laci ?? (await createTestLaci());
  const handler = createStudioHandler({ ...options, laci, uiDir: UI_FIXTURE });
  const base = 'http://localhost/laci';
  const call = (
    path: string,
    init: RequestInit = {},
    user: { id: string } | null = { id: 'dev-1' },
  ) => handler(new Request(`${base}${path}`, init), { path: path.split('?')[0] as string, user });
  const send = (
    method: string,
    path: string,
    body: unknown,
    user: { id: string } | null = { id: 'dev-1' },
  ) =>
    call(
      path,
      { method, headers: CSRF, body: typeof body === 'string' ? body : JSON.stringify(body) },
      user,
    );
  return { laci, handler, call, send };
}
