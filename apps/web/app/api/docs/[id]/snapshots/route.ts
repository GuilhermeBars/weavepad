import { handleDocumentApi } from '../../../../../lib/api';
import { listSnapshots, createSnapshot } from '../../../../../lib/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ params }) => listSnapshots(params.id));
}

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleDocumentApi(request, context, async ({ user, params, role, readInput }) =>
    createSnapshot(user, params.id, role, readInput),
  );
}
