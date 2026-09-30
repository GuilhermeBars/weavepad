import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { diffWordsWithSpace } from 'diff';
import { assertPermission, snapshotToPlainText, type PlainBlock } from '@weavepad/shared';
import { documents, documentMembers, snapshots, users } from '@weavepad/shared/db/schema';
import { db, repository } from './db';
import { checkOwnerChange, HttpError, issueToken } from './access';
import type { Identity } from './access';
import type { Role } from '@weavepad/shared';

const uuid = z.string().uuid();
const titleSchema = z.object({ title: z.string().trim().min(1).max(200) });
const roleSchema = z.enum(['owner', 'editor', 'viewer']);
async function internal(id: string, operation: string, body?: unknown) {
  const base = process.env.SYNC_INTERNAL_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!base || !secret) throw new HttpError(503, 'Version service is not configured.');
  let response: Response;
  try {
    response = await fetch(`${base}/internal/docs/${id}/${operation}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(503, 'Version service is unavailable. Try again.');
  }
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 503,
      'Version operation failed. Please try again.',
    );
  return response.json();
}

export async function listDocuments(user: Identity) {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      updatedAt: documents.updatedAt,
      role: documentMembers.role,
    })
    .from(documents)
    .innerJoin(documentMembers, eq(documents.id, documentMembers.documentId))
    .where(eq(documentMembers.userId, user.id))
    .orderBy(desc(documents.updatedAt));
  return Response.json({
    mine: rows.filter((d) => d.role === 'owner'),
    shared: rows.filter((d) => d.role !== 'owner'),
  });
}

export async function createDocument(user: Identity, input: unknown) {
  const title = titleSchema.parse(input);
  const doc = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(documents)
      .values({ ...title, ownerId: user.id })
      .returning();
    await tx
      .insert(documentMembers)
      .values({ documentId: created!.id, userId: user.id, role: 'owner' });
    return created;
  });
  return Response.json(doc, { status: 201 });
}

export async function getDocumentToken(user: Identity, id: string) {
  if (!process.env.COLLAB_TOKEN_SECRET)
    throw new HttpError(503, 'Collaboration is not configured.');
  return Response.json(
    await issueToken(
      repository,
      { id: user.id, name: user.name || 'Anonymous', color: user.color },
      id,
      process.env.COLLAB_TOKEN_SECRET,
    ),
  );
}

export async function listSnapshots(id: string) {
  return Response.json(
    await db
      .select({
        id: snapshots.id,
        label: snapshots.label,
        createdAt: snapshots.createdAt,
        createdBy: users.name,
      })
      .from(snapshots)
      .innerJoin(users, eq(snapshots.createdBy, users.id))
      .where(eq(snapshots.documentId, id))
      .orderBy(desc(snapshots.createdAt)),
  );
}

export async function createSnapshot(
  user: Identity,
  id: string,
  role: Role,
  readInput: () => Promise<unknown>,
) {
  assertPermission(role, 'snapshot');
  const { label } = z.object({ label: z.string().trim().min(1).max(200) }).parse(await readInput());
  return Response.json(await internal(id, 'snapshots', { label, userId: user.id }), {
    status: 201,
  });
}

async function findSnapshot(id: string, snapshotId: string) {
  uuid.parse(snapshotId);

  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, snapshotId), eq(snapshots.documentId, id)));
  if (!snapshot) throw new HttpError(404, 'Version not found.');

  return snapshot;
}

export async function diffSnapshot(id: string, snapshotId: string) {
  const snapshot = await findSnapshot(id, snapshotId);

  const current = (await internal(id, 'text')) as { blocks: PlainBlock[] };
  return Response.json({
    words: diffWordsWithSpace(
      snapshotToPlainText(snapshot.state),
      current.blocks.map((b) => b.text).join('\n'),
    ),
  });
}

export async function restoreSnapshot(user: Identity, id: string, role: Role, snapshotId: string) {
  await findSnapshot(id, snapshotId);

  assertPermission(role, 'restore');
  return Response.json(await internal(id, 'restore', { snapshotId, userId: user.id }));
}

export async function listMembers(id: string, role: Role) {
  assertPermission(role, 'share');
  return Response.json(
    await db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: documentMembers.role,
      })
      .from(documentMembers)
      .innerJoin(users, eq(users.id, documentMembers.userId))
      .where(eq(documentMembers.documentId, id)),
  );
}

type DocumentChange =
  | { kind: 'document'; method: 'PATCH' | 'DELETE' }
  | { kind: 'invite'; method: 'POST' }
  | { kind: 'member'; method: 'PATCH' | 'DELETE'; userId: string };

export async function mutateDocument(
  user: Identity,
  id: string,
  change: DocumentChange,
  input: unknown,
) {
  const result = await db.transaction(async (tx) => {
    // All membership mutations lock the same row before checking ownership.
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for('update');
    if (!doc) throw new HttpError(404, 'Document not found.');
    const members = await tx
      .select()
      .from(documentMembers)
      .where(eq(documentMembers.documentId, id));
    assertPermission(
      members.find((m) => m.userId === user.id)?.role,
      change.kind === 'document' ? 'manage' : 'share',
    );
    if (change.kind === 'document') {
      if (change.method === 'DELETE') await tx.delete(documents).where(eq(documents.id, id));
      else
        await tx
          .update(documents)
          .set({ ...titleSchema.parse(input), updatedAt: new Date() })
          .where(eq(documents.id, id));
      return { ok: true };
    }
    let target: string;
    let next: z.infer<typeof roleSchema> | null;
    if (change.kind === 'invite') {
      const invitation = z
        .object({
          email: z
            .string()
            .trim()
            .email()
            .transform((s) => s.toLowerCase()),
          role: roleSchema,
        })
        .parse(input);
      const [existing] = await tx.select().from(users).where(eq(users.email, invitation.email));
      if (!existing)
        throw new HttpError(404, 'This person must log in once before you can invite them.');
      target = existing.id;
      next = invitation.role;
    } else {
      target = uuid.parse(change.userId);
      next = change.method === 'DELETE' ? null : z.object({ role: roleSchema }).parse(input).role;
      if (!members.some((m) => m.userId === target)) throw new HttpError(404, 'Member not found.');
    }
    checkOwnerChange(members, target, next);
    if (next)
      await tx
        .insert(documentMembers)
        .values({ documentId: id, userId: target, role: next })
        .onConflictDoUpdate({
          target: [documentMembers.documentId, documentMembers.userId],
          set: { role: next },
        });
    else
      await tx
        .delete(documentMembers)
        .where(and(eq(documentMembers.documentId, id), eq(documentMembers.userId, target)));
    const replacement =
      doc.ownerId === target && next !== 'owner'
        ? members.find((m) => m.role === 'owner' && m.userId !== target)?.userId
        : doc.ownerId;
    await tx
      .update(documents)
      .set({ ownerId: replacement!, updatedAt: new Date() })
      .where(eq(documents.id, id));
    return { ok: true };
  });
  return Response.json(result);
}
