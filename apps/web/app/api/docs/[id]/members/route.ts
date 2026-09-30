import { handleDocumentApi } from '../../../../../lib/api';
import { listMembers, mutateDocument } from '../../../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ params, role }) =>
    listMembers(params.id, role),
  );
}

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ user, params, readInput }) =>
    mutateDocument(user, params.id, { kind: 'invite', method: 'POST' }, await readInput()),
  );
}
