import {
  bigserial,
  customType,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
export const documentRole = pgEnum('document_role', ['owner', 'editor', 'viewer']);
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  image: text('image'),
  color: text('color').notNull(),
  createdAt: createdAt(),
});
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('documents_owner_idx').on(table.ownerId)],
);
export const documentMembers = pgTable(
  'document_members',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: documentRole('role').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.userId] }),
    index('document_members_user_idx').on(table.userId),
  ],
);
export const documentState = pgTable('document_state', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  updatedAt: updatedAt(),
});
export const documentUpdates = pgTable(
  'document_updates',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    update: bytea('update').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('document_updates_document_id_idx').on(table.documentId, table.id)],
);
export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    state: bytea('state').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('snapshots_document_created_idx').on(table.documentId, table.createdAt)],
);
