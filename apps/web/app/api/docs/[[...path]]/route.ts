import { docsApi } from '../../../../lib/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const response = await docsApi(request, (await context.params).path ?? []);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
