import { handleDocumentApi } from '../../../../lib/api';
import { mutateDocument } from '../../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ user, params, readInput }) =>
    mutateDocument(user, params.id, { kind: 'document', method: 'PATCH' }, await readInput()),
  );
}

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ user, params }) =>
    mutateDocument(user, params.id, { kind: 'document', method: 'DELETE' }, null),
  );
}
