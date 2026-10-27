import type { EntryStatus, MessageChannel } from '@lacijs/core';

/**
 * Every text the editor shows. Pass a partial object as `messages` to translate or reword it;
 * missing keys fall back to {@link defaultMessages}.
 */
export interface Messages {
  appName: string;
  appTagline: string;
  navContent: string;
  navManage: string;
  navConfig: string;
  navEmail: string;
  navMessage: string;
  navHistory: string;
  navSchema: string;
  runtime: (runtime: string) => string;
  actor: (name: string) => string;
  anonymous: string;
  environment: string;
  production: string;
  productionWarning: string;
  database: (label: string) => string;
  loading: string;
  loadFailed: (reason: string) => string;
  retry: string;

  // Lists
  search: string;
  searchConfigs: string;
  searchTemplates: string;
  all: string;
  noEntries: string;
  newConfig: string;
  newTemplate: string;
  newMessage: string;
  selectEntry: string;
  statuses: Record<EntryStatus, string>;
  channels: Record<MessageChannel, string>;
  versionMeta: (version: number, when: string, who: string | null) => string;

  // Entry header
  copyKey: string;
  copied: string;
  publish: string;
  disable: string;
  enable: string;
  promote: string;
  locale: string;
  addLocale: string;
  addLocalePrompt: string;
  addLocaleCreate: string;
  cancel: string;
  close: string;

  // Config editor tabs
  tabForm: string;
  tabJson: string;
  tabSchema: string;
  tabHistory: string;
  tabUsage: string;
  validAgainstSchema: string;
  invalidJson: (reason: string) => string;
  applyJson: string;
  usageTitle: string;
  description: string;

  // Form
  required: string;
  items: (count: number) => string;
  addItem: string;
  removeItem: string;
  duplicateItem: string;
  moveUp: string;
  moveDown: string;
  collapse: string;
  expand: string;
  collapseAll: string;
  expandAll: string;
  modified: string;
  addValue: (name: string) => string;
  removeValue: (value: string) => string;
  addKey: string;
  keyName: string;
  removeKey: (key: string) => string;
  noValue: string;
  setValue: string;
  clearValue: string;
  mismatch: string;
  editAsJson: string;
  contrastLow: (ratio: string) => string;
  contrastOk: (ratio: string) => string;
  errorsInside: (count: number) => string;
  timeOffset: string;

  // Save bar and review
  unsavedChanges: (count: number) => string;
  validationErrors: (count: number) => string;
  noChanges: string;
  discard: string;
  reviewAndSave: string;
  reviewAndPublish: string;
  saveDraft: string;
  reviewTitle: string;
  changesCount: (count: number) => string;
  added: (count: number) => string;
  modifiedCount: (count: number) => string;
  removed: (count: number) => string;
  changeKinds: Record<'added' | 'modified' | 'removed', string>;
  viewFields: string;
  viewJsonDiff: string;
  none: string;
  schemaValid: string;
  schemaInvalid: (count: number) => string;
  latestVersion: (version: number) => string;
  newerVersion: (version: number, by: string | null) => string;
  sizeOf: (size: string, limit: string) => string;
  changeNote: string;
  backToEditor: string;
  save: string;
  saveVersion: (version: number) => string;
  publishVersion: (version: number) => string;
  saved: (version: number) => string;
  conflict: string;
  schemaChanged: string;

  // History
  historyTitle: string;
  versions: (count: number) => string;
  compare: string;
  rollBack: string;
  rollBackTo: (version: number) => string;
  rollBackNote: string;
  rolledBack: (version: number) => string;
  current: string;
  compareTitle: (version: number, current: number) => string;
  loadMore: string;
  recentChanges: string;
  system: string;

  // Promote
  promoteTitle: (key: string) => string;
  promoteFrom: string;
  promoteTo: string;
  promoteAll: string;
  promotePreview: string;
  promoteConfirm: (environment: string) => string;
  promoteDone: (count: number, environment: string) => string;
  promoteActions: Record<'create' | 'update' | 'unchanged', string>;
  promoteNothing: string;

  // Templates
  fromName: string;
  subject: string;
  body: string;
  modeVisual: string;
  modeHtml: string;
  modeText: string;
  bold: string;
  italic: string;
  insertLink: string;
  insertButton: string;
  insertVariable: string;
  variables: string;
  editSchema: string;
  optional: string;
  noVariables: string;
  preview: string;
  sampleData: string;
  sampleGenerated: string;
  sampleExample: (index: number) => string;
  editSample: string;
  saveSample: string;
  sendTest: string;
  sendTestTo: string;
  sendTestDone: (to: string) => string;
  previewFailed: (reason: string) => string;
  visualHint: string;
  to: string;

  // Message templates
  providerTemplateName: string;
  category: string;
  providerApproval: string;
  providerStatuses: Record<'PENDING' | 'APPROVED' | 'REJECTED' | 'NONE', string>;
  syncedAt: (when: string) => string;
  syncStatus: string;
  header: string;
  footer: string;
  buttons: string;
  buttonType: string;
  buttonText: string;
  buttonUrl: string;
  addButton: string;
  removeButton: string;
  title: string;
  deepLink: string;
  imageUrl: string;
  senderId: string;
  optionalSuffix: (label: string) => string;
  characters: (count: number, limit: number) => string;
  smsCounter: (units: number, perSegment: number, segments: number, encoding: string) => string;
  providerText: string;
  phonePreview: Record<MessageChannel, { name: string; sub: string }>;

  // New entry and schema builder
  newEntryTitle: string;
  kindLabels: Record<
    'CONFIG' | 'EMAIL_TEMPLATE' | 'MESSAGE_TEMPLATE',
    { label: string; hint: string }
  >;
  key: string;
  channel: string;
  startFrom: string;
  presets: Record<string, string>;
  structure: string;
  variablesStructure: string;
  importSample: string;
  importSampleHint: string;
  importSampleApply: string;
  createEntry: string;
  selectedField: string;
  fieldName: string;
  fieldType: string;
  fieldLabel: string;
  fieldHelp: string;
  fieldOptions: string;
  fieldNullable: string;
  rules: Record<string, string>;
  addField: string;
  addFieldTo: (name: string) => string;
  removeField: string;
  listItem: string;
  mapValue: string;
  jsonSchema: string;
  rawSchema: string;
  builderView: string;
  created: (key: string) => string;
}

export const defaultMessages: Messages = {
  appName: 'Laci',
  appTagline: 'Runtime config editor',
  navContent: 'Content',
  navManage: 'Manage',
  navConfig: 'Global Configuration',
  navEmail: 'Email Template',
  navMessage: 'Message Template',
  navHistory: 'History & Audit',
  navSchema: 'Schema Builder',
  runtime: (runtime) => `Local · ${runtime}`,
  actor: (name) => `Saving as ${name}`,
  anonymous: 'anonymous',
  environment: 'Environment',
  production: 'Production data',
  productionWarning: 'You are editing production data: changes go live for your app.',
  database: (label) => `Database: ${label}`,
  loading: 'Loading…',
  loadFailed: (reason) => `Could not load: ${reason}`,
  retry: 'Retry',

  search: 'Search',
  searchConfigs: 'Search key or description',
  searchTemplates: 'Search templates',
  all: 'All',
  noEntries: 'Nothing here yet.',
  newConfig: 'New config',
  newTemplate: 'New template',
  newMessage: 'New message',
  selectEntry: 'Select an entry on the left.',
  statuses: { DRAFT: 'Draft', PUBLISHED: 'Live', DISABLED: 'Off' },
  channels: { WHATSAPP: 'WhatsApp', SMS: 'SMS', PUSH: 'Push notification', IN_APP: 'In-app' },
  versionMeta: (version, when, who) => `v${version} · ${when}${who ? ` · ${who}` : ''}`,

  copyKey: 'Copy key',
  copied: 'Copied',
  publish: 'Publish',
  disable: 'Disable',
  enable: 'Enable',
  promote: 'Promote',
  locale: 'Locale',
  addLocale: 'Add locale…',
  addLocalePrompt: 'New locale, e.g. en-US',
  addLocaleCreate: 'Create draft',
  cancel: 'Cancel',
  close: 'Close',

  tabForm: 'Form',
  tabJson: 'JSON',
  tabSchema: 'Schema',
  tabHistory: 'History',
  tabUsage: 'Usage',
  validAgainstSchema: 'Valid against schema',
  invalidJson: (reason) => `Not valid JSON: ${reason}`,
  applyJson: 'Apply',
  usageTitle: 'Read it from your backend',
  description: 'Description',

  required: 'required',
  items: (count) => `${count} item${count === 1 ? '' : 's'}`,
  addItem: '+ Add item',
  removeItem: 'Remove',
  duplicateItem: 'Duplicate',
  moveUp: 'Move up',
  moveDown: 'Move down',
  collapse: 'Collapse',
  expand: 'Expand',
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  modified: 'Modified',
  addValue: (name) => `Add to ${name}`,
  removeValue: (value) => `Remove ${value}`,
  addKey: '+ Add key',
  keyName: 'Key',
  removeKey: (key) => `Remove ${key}`,
  noValue: 'Not set',
  setValue: 'Set',
  clearValue: 'Clear',
  mismatch: 'The stored value does not match the schema here.',
  editAsJson: 'Edit as JSON',
  contrastLow: (ratio) => `Contrast ${ratio}:1 is below 4.5:1: hard to read`,
  contrastOk: (ratio) => `Contrast ${ratio}:1`,
  errorsInside: (count) => `${count} error${count === 1 ? '' : 's'}`,
  timeOffset: 'UTC offset',

  unsavedChanges: (count) => `${count} unsaved change${count === 1 ? '' : 's'}`,
  validationErrors: (count) => `${count} validation error${count === 1 ? '' : 's'}`,
  noChanges: 'No unsaved changes',
  discard: 'Discard',
  reviewAndSave: 'Review & save',
  reviewAndPublish: 'Review & publish',
  saveDraft: 'Save draft',
  reviewTitle: 'Review changes',
  changesCount: (count) => `${count} change${count === 1 ? '' : 's'}`,
  added: (count) => `+${count} added`,
  modifiedCount: (count) => `${count} modified`,
  removed: (count) => `${count} removed`,
  changeKinds: { added: 'Added', modified: 'Modified', removed: 'Removed' },
  viewFields: 'Fields',
  viewJsonDiff: 'JSON diff',
  none: '(none)',
  schemaValid: 'Schema valid',
  schemaInvalid: (count) => `${count} validation error${count === 1 ? '' : 's'}`,
  latestVersion: (version) => `No newer version on server (v${version} is latest)`,
  newerVersion: (version, by) =>
    `Someone saved v${version}${by ? ` (${by})` : ''} meanwhile: reload before saving`,
  sizeOf: (size, limit) => `Size ${size} of ${limit}`,
  changeNote: 'Change note',
  backToEditor: 'Back to editor',
  save: 'Save',
  saveVersion: (version) => `Save v${version}`,
  publishVersion: (version) => `Publish v${version}`,
  saved: (version) => `Saved as v${version}`,
  conflict: 'This entry changed on the server. Reload it and apply your change again.',
  schemaChanged: 'Schema changed',

  historyTitle: 'History',
  versions: (count) => `${count} version${count === 1 ? '' : 's'}`,
  compare: 'Compare',
  rollBack: 'Roll back to this',
  rollBackTo: (version) => `Roll back to v${version}`,
  rollBackNote: 'Why? (optional)',
  rolledBack: (version) => `Rolled back to v${version}`,
  current: 'current',
  compareTitle: (version, current) => `v${version} → v${current} (current)`,
  loadMore: 'Load more',
  recentChanges: 'Recently changed',
  system: 'system',

  promoteTitle: (key) => `Promote ${key}`,
  promoteFrom: 'From',
  promoteTo: 'To',
  promoteAll: 'All locales and channels of this key',
  promotePreview: 'Preview changes',
  promoteConfirm: (environment) => `Promote to ${environment}`,
  promoteDone: (count, environment) =>
    `Promoted ${count} entr${count === 1 ? 'y' : 'ies'} to ${environment}`,
  promoteActions: { create: 'New', update: 'Update', unchanged: 'Unchanged' },
  promoteNothing: 'Nothing to promote: the target already matches.',

  fromName: 'From name',
  subject: 'Subject',
  body: 'Body',
  modeVisual: 'Visual',
  modeHtml: 'HTML',
  modeText: 'Plain text',
  bold: 'Bold',
  italic: 'Italic',
  insertLink: 'Insert link',
  insertButton: 'Insert button',
  insertVariable: '{ } Variable',
  variables: 'Variables',
  editSchema: 'Edit schema',
  optional: 'optional',
  noVariables: 'No variables yet.',
  preview: 'Preview',
  sampleData: 'Sample data',
  sampleGenerated: 'Generated from schema',
  sampleExample: (index) => `Example ${index}`,
  editSample: 'Edit sample data',
  saveSample: 'Save as example',
  sendTest: 'Send test',
  sendTestTo: 'Send a test to',
  sendTestDone: (to) => `Test sent to ${to}`,
  previewFailed: (reason) => `Preview failed: ${reason}`,
  visualHint: 'Variables are shown as chips. Edit the template in the HTML tab.',
  to: 'to',

  providerTemplateName: 'Provider template name',
  category: 'Category',
  providerApproval: 'Provider approval',
  providerStatuses: {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    NONE: 'Not submitted',
  },
  syncedAt: (when) => `synced ${when}`,
  syncStatus: 'Sync status',
  header: 'Header',
  footer: 'Footer',
  buttons: 'Buttons',
  buttonType: 'Type',
  buttonText: 'Text',
  buttonUrl: 'URL',
  addButton: '+ Add',
  removeButton: 'Remove button',
  title: 'Title',
  deepLink: 'Deep link',
  imageUrl: 'Image URL',
  senderId: 'Sender ID',
  optionalSuffix: (label) => `${label} (optional)`,
  characters: (count, limit) => `${count} / ${limit} characters`,
  smsCounter: (units, perSegment, segments, encoding) =>
    `${units} / ${perSegment} · ${segments} segment${segments === 1 ? '' : 's'} · ${encoding}`,
  providerText: 'As registered with the provider',
  phonePreview: {
    WHATSAPP: { name: 'Business account', sub: 'WhatsApp' },
    SMS: { name: 'SMS', sub: 'Sender ID' },
    PUSH: { name: 'Your app', sub: 'Notification' },
    IN_APP: { name: 'Your app', sub: 'In-app message' },
  },

  newEntryTitle: 'New entry',
  kindLabels: {
    CONFIG: { label: 'Global configuration', hint: 'Any JSON value, nested freely' },
    EMAIL_TEMPLATE: { label: 'Email template', hint: 'Subject, HTML and text body' },
    MESSAGE_TEMPLATE: { label: 'Message template', hint: 'WhatsApp, SMS, push, in-app' },
  },
  key: 'Key',
  channel: 'Channel',
  startFrom: 'Start from',
  presets: {
    single: 'Single value',
    flag: 'Feature flag (date)',
    links: 'Link map',
    strings: 'List of strings',
    objects: 'List of objects',
    colors: 'Color map',
  },
  structure: 'Structure',
  variablesStructure: 'Variables',
  importSample: 'Import from JSON sample',
  importSampleHint: 'Paste an example value; Laci guesses a schema from it.',
  importSampleApply: 'Use this structure',
  createEntry: 'Create entry',
  selectedField: 'Selected field',
  fieldName: 'Name',
  fieldType: 'Type',
  fieldLabel: 'Label shown in editor',
  fieldHelp: 'Help text',
  fieldOptions: 'Options (one per line)',
  fieldNullable: 'Can be empty (null)',
  rules: {
    minLength: 'Min length',
    maxLength: 'Max length',
    pattern: 'Pattern',
    minimum: 'Minimum',
    maximum: 'Maximum',
    minItems: 'Min items',
    maxItems: 'Max items',
    uniqueBy: 'Unique by field',
  },
  addField: '+ field',
  addFieldTo: (name) => `+ Add field to ${name}`,
  removeField: 'Remove field',
  listItem: 'item',
  mapValue: 'value',
  jsonSchema: 'JSON Schema',
  rawSchema: 'Edit as JSON',
  builderView: 'Builder',
  created: (key) => `Created ${key} as a draft`,
};
