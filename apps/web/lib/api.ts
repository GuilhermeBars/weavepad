import { z } from 'zod';
import { PermissionError, type Role } from '@weavepad/shared';
import { auth } from '../auth';
import { repository } from './db';
import { authorize, HttpError, type Identity } from './access';

type RequestContext = { user: Identity; readInput: () => Promise<unknown> };
export async function handleApi(
  request: Request,
  operation: (context: RequestContext) => Promise<Response>,
) {
  const response = await executeApi(request, operation);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
async function executeApi(
  request: Request,
  operation: (context: RequestContext) => Promise<Response>,
) {
  try {
    const session = await auth();

    const user = session?.user;
    if (!user?.id) throw new HttpError(401, 'Please sign in.');
    const method = request.method;
    if (!['GET', 'HEAD'].includes(method)) {
      // Next may reconstruct request.url with its internal listener hostname.
      // AUTH_URL is the public origin, including behind a reverse proxy.
      if (request.headers.get('origin') !== new URL(process.env.AUTH_URL || request.url).origin)
        throw new HttpError(403, 'Invalid request origin.');
      if (Number(request.headers.get('content-length') ?? 0) > 16384)
        throw new HttpError(413, 'Request too large.');
    }
    const readInput = async () => {
      // Bound actual bytes as they arrive; Content-Length is optional and untrusted.
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16384) {
              await reader.cancel();
              throw new HttpError(413, 'Request too large.');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new HttpError(400, 'Invalid JSON.');
      }
    };

    return await operation({
      user: { id: user.id, name: user.name || 'Anonymous', color: user.color },
      readInput,
    });
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof PermissionError
          ? 403
          : error instanceof z.ZodError
            ? 400
            : 500;
    return Response.json(
      {
        error:
          status === 500
            ? 'Something went wrong. Please try again.'
            : error instanceof z.ZodError
              ? 'Check the supplied fields.'
              : (error as Error).message,
      },
      { status },
    );
  }
}

export function handleDocumentApi<P extends { id: string }>(
  request: Request,
  context: { params: Promise<P> },
  operation: (context: RequestContext & { params: P; role: Role }) => Promise<Response>,
) {
  return handleApi(request, async (authenticated) => {
    const params = await context.params;
    z.string().uuid().parse(params.id);
    const role = await authorize(repository, authenticated.user.id, params.id, 'read');
    return operation({ ...authenticated, params, role });
  });
}
