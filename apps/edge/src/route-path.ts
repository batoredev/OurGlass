/**
 * `/functions/v1/api/turn` and `/api/turn` both become `/turn`; anything not
 * under the `api` function is null. Separate from router.ts so it can be
 * tested without importing every route (and with them, `pg`).
 */
export function routePath(pathname: string): string | null {
  const match = /^(?:\/functions\/v1)?\/api(\/.*)?$/.exec(pathname);
  if (!match) return null;
  return match[1] ?? "/";
}
