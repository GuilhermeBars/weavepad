import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { diffWordsWithSpace } from 'diff';
import { PermissionError, assertPermission, snapshotToPlainText, type PlainBlock } from '@weavepad/shared';
import { documents, documentMembers, snapshots, users } from '@weavepad/shared/db/schema';
import { auth } from '../auth';
import { db, repository } from './db';
import { authorize, checkOwnerChange, HttpError, issueToken } from './access';

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
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(503, 'Version service is unavailable. Try again.'); }
  if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 503, 'Version operation failed. Please try again.');
  return response.json();
}

export async function docsApi(request: Request, path: string[]) {
  try {
    const session = await auth();
    const user = session?.user;
    if (!user?.id) throw new HttpError(401, 'Please sign in.');
    const method = request.method;
    if (!['GET', 'HEAD'].includes(method)) {
      // Next may reconstruct request.url with its internal listener hostname.
      // AUTH_URL is the public origin, including behind a reverse proxy.
      if (request.headers.get('origin') !== new URL(process.env.AUTH_URL || request.url).origin) throw new HttpError(403, 'Invalid request origin.');
      if (Number(request.headers.get('content-length') ?? 0) > 16384) throw new HttpError(413, 'Request too large.');
    }
    const json = async () => {
      const raw = await request.text();
      if (raw.length > 16384) throw new HttpError(413, 'Request too large.');
      try { return JSON.parse(raw) as unknown; } catch { throw new HttpError(400, 'Invalid JSON.'); }
    };
    if (!path.length) {
      if (method === 'GET') {
        const rows = await db.select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt, role: documentMembers.role })
          .from(documents).innerJoin(documentMembers, eq(documents.id, documentMembers.documentId))
          .where(eq(documentMembers.userId, user.id)).orderBy(desc(documents.updatedAt));
        return Response.json({ mine: rows.filter((d) => d.role === 'owner'), shared: rows.filter((d) => d.role !== 'owner') });
      }
      if (method === 'POST') {
        const input = titleSchema.parse(await json());
        const doc = await db.transaction(async (tx) => {
          const [created] = await tx.insert(documents).values({ ...input, ownerId: user.id }).returning();
          await tx.insert(documentMembers).values({ documentId: created!.id, userId: user.id, role: 'owner' });
          return created;
        });
        return Response.json(doc, { status: 201 });
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    const id = uuid.parse(path[0]);
    const action = path[1];
    const role = await authorize(repository, user.id, id, 'read');
    if (action === 'token' && path.length === 2 && method === 'GET') {
      if (!process.env.COLLAB_TOKEN_SECRET) throw new HttpError(503, 'Collaboration is not configured.');
      return Response.json(await issueToken(repository, { id: user.id, name: user.name || 'Anonymous', color: user.color }, id, process.env.COLLAB_TOKEN_SECRET));
    }
    if (action === 'snapshots') {
      if (path.length === 2 && method === 'GET') {
        return Response.json(await db.select({ id: snapshots.id, label: snapshots.label, createdAt: snapshots.createdAt, createdBy: users.name })
          .from(snapshots).innerJoin(users, eq(snapshots.createdBy, users.id)).where(eq(snapshots.documentId, id)).orderBy(desc(snapshots.createdAt)));
      }
      if (path.length === 2 && method === 'POST') {
        assertPermission(role, 'snapshot');
        const { label } = z.object({ label: z.string().trim().min(1).max(200) }).parse(await json());
        return Response.json(await internal(id, 'snapshots', { label, userId: user.id }), { status: 201 });
      }
      const snapshotId = uuid.parse(path[2]);
      const [snapshot] = await db.select().from(snapshots).where(and(eq(snapshots.id, snapshotId), eq(snapshots.documentId, id)));
      if (!snapshot) throw new HttpError(404, 'Version not found.');
      if (path[3] === 'diff' && path.length === 4 && method === 'GET') {
        const current = await internal(id, 'text') as { blocks: PlainBlock[] };
        return Response.json({ words: diffWordsWithSpace(snapshotToPlainText(snapshot.state), current.blocks.map((b) => b.text).join('\n')) });
      }
      if (path[3] === 'restore' && path.length === 4 && method === 'POST') {
        assertPermission(role, 'restore');
        return Response.json(await internal(id, 'restore', { snapshotId, userId: user.id }));
      }
    }
    if (action === 'members' && path.length === 2 && method === 'GET') {
      assertPermission(role, 'share');
      return Response.json(await db.select({ userId: users.id, name: users.name, email: users.email, role: documentMembers.role })
        .from(documentMembers).innerJoin(users, eq(users.id, documentMembers.userId)).where(eq(documentMembers.documentId, id)));
    }
    if ((!action && ['PATCH', 'DELETE'].includes(method)) || (action === 'members' && ['POST', 'PATCH', 'DELETE'].includes(method))) {
      const input = method === 'DELETE' ? null : await json();
      const result = await db.transaction(async (tx) => {
        // All membership mutations lock the same row before checking ownership.
        const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for('update');
        if (!doc) throw new HttpError(404, 'Document not found.');
        const members = await tx.select().from(documentMembers).where(eq(documentMembers.documentId, id));
        assertPermission(members.find((m) => m.userId === user.id)?.role, action ? 'share' : 'manage');
        if (!action) {
          if (method === 'DELETE') await tx.delete(documents).where(eq(documents.id, id));
          else await tx.update(documents).set({ ...titleSchema.parse(input), updatedAt: new Date() }).where(eq(documents.id, id));
          return { ok: true };
        }
        let target: string;
        let next: z.infer<typeof roleSchema> | null;
        if (method === 'POST' && path.length === 2) {
          const invitation = z.object({ email: z.string().trim().email().transform((s) => s.toLowerCase()), role: roleSchema }).parse(input);
          const [existing] = await tx.select().from(users).where(eq(users.email, invitation.email));
          if (!existing) throw new HttpError(404, 'This person must log in once before you can invite them.');
          target = existing.id; next = invitation.role;
        } else if (path.length === 3 && method !== 'POST') {
          target = uuid.parse(path[2]);
          next = method === 'DELETE' ? null : z.object({ role: roleSchema }).parse(input).role;
          if (!members.some((m) => m.userId === target)) throw new HttpError(404, 'Member not found.');
        } else throw new HttpError(404, 'Endpoint not found.');
        checkOwnerChange(members, target, next);
        if (next) await tx.insert(documentMembers).values({ documentId: id, userId: target, role: next })
          .onConflictDoUpdate({ target: [documentMembers.documentId, documentMembers.userId], set: { role: next } });
        else await tx.delete(documentMembers).where(and(eq(documentMembers.documentId, id), eq(documentMembers.userId, target)));
        const replacement = doc.ownerId === target && next !== 'owner' ? members.find((m) => m.role === 'owner' && m.userId !== target)?.userId : doc.ownerId;
        await tx.update(documents).set({ ownerId: replacement!, updatedAt: new Date() }).where(eq(documents.id, id));
        return { ok: true };
      });
      return Response.json(result);
    }
    throw new HttpError(404, 'Endpoint not found.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof PermissionError ? 403 : error instanceof z.ZodError ? 400 : 500;
    return Response.json({ error: status === 500 ? 'Something went wrong. Please try again.' : error instanceof z.ZodError ? 'Check the supplied fields.' : (error as Error).message }, { status });
  }
}
