import { handleApi } from '../../../lib/api';
import { listDocuments, createDocument } from '../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleApi(request, async ({ user }) => listDocuments(user));
}

export function POST(request: Request) {
  return handleApi(request, async ({ user, readInput }) => createDocument(user, await readInput()));
}
