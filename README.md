# Laci

**Editable runtime configuration for JavaScript and TypeScript: global configs, email templates, and message templates, with a visual editor.**

> _Laci_ (Indonesian): a drawer, where you keep the small things you reach for every day.

> [!WARNING]
> Laci is in early development and is **not published to npm yet**. Everything below describes
> the planned design, and the API may change before `1.0.0`.

Laci moves the values your backend usually hardcodes (which customers are live, when a feature
goes live, access links, category colors, email and WhatsApp/SMS templates) into your database,
so your team can change them from an editor instead of waiting for a deploy. Your backend reads
them through a small, typed API.

## Requirements

| What                                  | Version                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| Node.js                               | **24 or newer**                                              |
| PostgreSQL (with `@lacijs/postgres`)  | 12 or newer, driver `pg` 8.11+                               |
| MySQL (with `@lacijs/mysql`)          | 8.0.19 or newer, InnoDB, driver `mysql2` 3.9+                |
| React (with `@lacijs/editor`)         | 18 or newer                                                  |
| Express, Fastify, or Hono (Laci Studio) | Only to mount the studio in your app                       |

## Features

- **Configs as data.** Any JSON value, nested as deep as you need: lists inside lists, objects inside lists. Every entry has a JSON Schema, and every write is validated against it.
- **Email templates.** Subject, HTML, and plain-text bodies with typed variables, rendered with an engine that escapes HTML and never runs arbitrary code.
- **Message templates.** WhatsApp, SMS, push notification, and in-app messages, with per-channel fields, SMS segment counting, and ordered parameters ready for WhatsApp provider APIs.
- **Environments.** Keep different values for staging and production, and promote a change from one to the other.
- **Locales.** Several language versions of one template, with a fallback chain (`en-US` → `en` → your default).
- **History and rollback.** Every change is a new version with who, when, and why. Roll back to any version.
- **Safe concurrent edits.** Optimistic locking stops two people from overwriting each other.
- **Draft and published.** Your app only reads published entries; drafts stay in the editor.
- **Visual editor.** A form generated from the schema, a raw JSON mode, diffs before saving, email and phone previews, and a schema builder.
- **Laci Studio.** The editor as a ready-made app next to yours. Off in production by default.
- **Database-agnostic core.** Adapters for PostgreSQL and MySQL, or write your own.

## Packages (planned)

| Package            | Description                                  |
| ------------------ | -------------------------------------------- |
| `@lacijs/core`     | Store API, validation, template rendering    |
| `@lacijs/postgres` | PostgreSQL storage adapter                   |
| `@lacijs/mysql`    | MySQL storage adapter                        |
| `@lacijs/editor`   | React editor components                      |
| `@lacijs/studio`   | The editor as a ready-made web app           |

## Quick look (planned API)

```ts
import { createLaci } from '@lacijs/core';
import { PostgresStore } from '@lacijs/postgres';

const laci = createLaci({
  store: new PostgresStore(pool),
  environment: 'production',
  defaultLocale: 'id-ID',
});

// A nested config: customers that are live, with their sessions and time slots
const customers = await laci.get('customerLiveStream');
const slots = await laci.get('customerLiveStream', '[0].sessions[0].slots');

// A feature flag by date
if (await laci.isLive('setFeatureLive')) {
  // the feature's go-live date has passed
}

// One item from a list: the badge colors for a customer category
const vip = await laci.find('customerCategoryColor', { category: 'VIP' });
// -> { category: 'VIP', label: 'VIP', background: '#8A5A44', text: '#FFFFFF' }

// Templates: Laci renders, your app sends
const mail = await laci.renderEmail('approval-request', data, { locale: 'en-US' });
const wa = await laci.renderMessage('customer-live-reminder', data, { channel: 'WHATSAPP' });
```

Edit everything visually with Laci Studio, which is off in production by default:

```ts
import { startStudio } from '@lacijs/studio';

if (process.env.NODE_ENV !== 'production') {
  await startStudio({ laci, label: 'development' });
}
```

## Roadmap

- [ ] Foundation: monorepo, entry schema, validator
- [ ] Core: get/set, path access, history, rollback, optimistic locking, cache
- [ ] PostgreSQL and MySQL adapters
- [ ] Email templates
- [ ] Message templates (WhatsApp, SMS, push, in-app)
- [ ] Environments and promote, locales and fallback
- [ ] Visual editor and Laci Studio
- [ ] Docs and first release (`0.1.0`)

## Related

- [Paraf](https://github.com/iyonadryan/paraf): dynamic approval workflows with a visual flow editor.

## Contributing

Issues and ideas are welcome. Contribution guidelines will be added once the core API stabilizes.

## License

[MIT](./LICENSE)
