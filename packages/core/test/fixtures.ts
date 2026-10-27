import type { JsonSchema, JsonValue } from '../src';

/** Customers that are live, each with sessions, each with time slots: lists three levels deep. */
export const customerLiveStream = {
  schema: {
    type: 'array',
    items: {
      type: 'object',
      required: ['customerId', 'name', 'sessions'],
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', minLength: 1 },
        name: { type: 'string' },
        sessions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'slots'],
            properties: {
              title: { type: 'string' },
              slots: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['start', 'end'],
                  properties: {
                    start: { type: 'string', format: 'date-time' },
                    end: { type: 'string', format: 'date-time' },
                    host: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  } satisfies JsonSchema,
  value: [
    {
      customerId: 'c-001',
      name: 'Toko Sinar',
      sessions: [
        {
          title: 'Morning sale',
          slots: [
            { start: '2026-11-01T09:00:00+07:00', end: '2026-11-01T10:00:00+07:00', host: 'Rina' },
            { start: '2026-11-01T10:30:00+07:00', end: '2026-11-01T11:30:00+07:00', host: 'Budi' },
          ],
        },
      ],
    },
    {
      customerId: 'c-002',
      name: 'Kopi Senja',
      sessions: [
        { title: 'Launch', slots: [] },
        {
          title: 'Q&A',
          slots: [{ start: '2026-11-02T19:00:00+07:00', end: '2026-11-02T20:00:00+07:00' }],
        },
      ],
    },
  ] satisfies JsonValue,
};

/** The go-live date of a feature; `null` until it is scheduled. */
export const setFeatureLive = {
  schema: { type: ['string', 'null'], format: 'date-time' } satisfies JsonSchema,
  value: '2026-11-01T00:00:00+07:00',
};

/** Access links that can change at any time. */
export const linkPath = {
  schema: {
    type: 'object',
    additionalProperties: { type: 'string', format: 'uri' },
  } satisfies JsonSchema,
  value: {
    help: 'https://help.example.com',
    promo: 'https://example.com/promo/november',
    status: 'https://status.example.com',
  },
};

/** Badge colors per customer category. */
export const customerCategoryColor = {
  schema: {
    type: 'array',
    uniqueBy: 'category',
    items: {
      type: 'object',
      required: ['category', 'label', 'background', 'text'],
      properties: {
        category: { type: 'string', pattern: '^[A-Z_]+$' },
        label: { type: 'string' },
        background: { type: 'string', format: 'color' },
        text: { type: 'string', format: 'color' },
      },
    },
  } satisfies JsonSchema,
  value: [
    { category: 'VIP', label: 'VIP', background: '#8A5A44', text: '#FFFFFF' },
    { category: 'REGULAR', label: 'Regular', background: '#F5EDE8', text: '#5E3A28' },
    { category: 'NEW', label: 'Customer Baru', background: '#E5F3EA', text: '#1D6B3A' },
  ] satisfies JsonValue,
};

/** An email asking a manager to approve a request. */
export const approvalRequest = {
  kind: 'EMAIL_TEMPLATE' as const,
  schema: {
    type: 'object',
    required: ['managerName', 'requester', 'amount', 'dueDate', 'link'],
    properties: {
      managerName: { type: 'string', minLength: 1 },
      requester: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, department: { type: 'string' } },
      },
      amount: { type: 'number' },
      dueDate: { type: 'string', format: 'date' },
      link: { type: 'string', format: 'uri' },
      items: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
    },
  } satisfies JsonSchema,
  value: {
    fromName: 'Finance {{ requester.department }}',
    subject:
      'Approval needed: {{ requester.name }} ({{ amount | formatNumber: "currency", "IDR" }})',
    html:
      '<p>Hi {{ managerName }},</p>\n' +
      '<p>{{ requester.name }} asks for {{ amount | formatNumber: "currency", "IDR" }} by {{ dueDate | formatDate: "long" }}.</p>\n' +
      '{% if items %}<ul>{% for item in items %}<li>{{ item }}</li>{% endfor %}</ul>{% endif %}\n' +
      '{% if note %}<blockquote>{{ note }}</blockquote>{% endif %}\n' +
      '<a href="{{ link }}">Review</a>',
    text:
      'Hi {{ managerName }},\n' +
      '{{ requester.name }} asks for {{ amount | formatNumber: "currency", "IDR" }} by {{ dueDate | formatDate: "long" }}.\n' +
      '{% for item in items %}- {{ item }}\n{% endfor %}Review: {{ link }}',
  },
};
