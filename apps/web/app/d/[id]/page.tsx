import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from '@weavepad/shared/db/schema';
import { auth } from '../../../auth';
import { db, repository } from '../../../lib/db';
import { DocumentWorkspace } from '../../../components/document-workspace';
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await auth())?.user;
  if (!user) redirect('/login');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const role = await repository.role(id, user.id);
  if (!role) notFound();
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) notFound();
  return <DocumentWorkspace id={id} title={doc.title} role={role} user={{ id: user.id, name: user.name || 'Anonymous', color: user.color }} />;
}
