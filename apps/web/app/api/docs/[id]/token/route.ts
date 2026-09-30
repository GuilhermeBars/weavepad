import { handleDocumentApi } from '../../../../../lib/api';
import { getDocumentToken } from '../../../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ user, params }) =>
    getDocumentToken(user, params.id),
  );
}
