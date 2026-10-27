import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { touchAccess } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Records an outbound click so "recently accessed" reflects real usage. */
export async function POST(req: Request, { params }: Ctx) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const kind = String(body.kind ?? '').slice(0, 20);
  if (!['live', 'admin', 'developer', 'source', 'hosting', 'page'].includes(kind)) {
    return fail(ERRORS.VALIDATION, 'Unknown link kind.', 400);
  }

  await touchAccess(auth.profile.id, id);
  await audit(auth.profile.id, 'website.open', { entityType: 'website', entityId: id, detail: { kind } });
  return json({ ok: true });
}
