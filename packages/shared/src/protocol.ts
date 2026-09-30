/** Standard y-websocket outer message tags. */
export const MESSAGE_TYPE = { SYNC: 0, AWARENESS: 1, AUTH: 2, QUERY_AWARENESS: 3 } as const;
/** y-protocols/sync inner message tags; viewers must not send STEP2 or UPDATE. */
export const SYNC_MESSAGE_TYPE = { STEP1: 0, STEP2: 1, UPDATE: 2 } as const;
export const CLOSE_CODE = { UNAUTHORIZED: 4401, FORBIDDEN: 4403 } as const;
export const COLLAB_TOKEN_TTL_SECONDS = 5 * 60;
export const DOCUMENT_FRAGMENT = 'default';
