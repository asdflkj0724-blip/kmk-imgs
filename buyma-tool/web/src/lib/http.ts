/** API の返事を作る小さな道具。拡張機能（chrome-extension://）から呼べるように CORS を付ける */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const extId = process.env.NEXT_PUBLIC_EXTENSION_ID;
  const allowed = origin.startsWith('chrome-extension://') && (!extId || origin === `chrome-extension://${extId}`);
  return allowed
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        Vary: 'Origin',
      }
    : {};
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req), ...extra },
  });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
