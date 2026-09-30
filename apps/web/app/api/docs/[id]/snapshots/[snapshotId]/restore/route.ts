import { handleDocumentApi } from '../../../../../../../lib/api';
import { restoreSnapshot } from '../../../../../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(
  request: Request,
  context: { params: Promise<{ id: string; snapshotId: string }> },
) {
  return handleDocumentApi(request, context, async ({ user, params, role }) =>
    restoreSnapshot(user, params.id, role, params.snapshotId),
  );
}
