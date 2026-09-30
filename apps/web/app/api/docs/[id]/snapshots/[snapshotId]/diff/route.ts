import { handleDocumentApi } from '../../../../../../../lib/api';
import { diffSnapshot } from '../../../../../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  request: Request,
  context: { params: Promise<{ id: string; snapshotId: string }> },
) {
  return handleDocumentApi(request, context, async ({ params }) =>
    diffSnapshot(params.id, params.snapshotId),
  );
}
