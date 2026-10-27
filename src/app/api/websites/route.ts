import { assertEnv } from '@/lib/env';
import { audit, ERRORS, fail, guard, json, rejectCrossSite } from '@/lib/api';
import { createWebsite, listWebsites, NotFound } from '@/lib/db';
import { parse, websiteCreate } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  assertEnv();
  const auth = await guard();
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const websites = await listWebsites(auth.profile.id, {
    roomId: sp.get('room') ?? undefined,
    q: sp.get('q') ?? undefined,
    status: (sp.get('status') as never) ?? undefined,
    category: sp.get('category') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    since: sp.get('since') ?? undefined,
    includeArchived: sp.get('archived') === '1',
    sort: (sp.get('sort') as 'recent' | 'name' | 'accessed') ?? 'recent',
  });
  return json({ websites });
}

export async function POST(req: Request) {
  assertEnv();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const auth = await guard();
  if (!auth.ok) return auth.response;

  const parsed = parse(websiteCreate, await req.json().catch(() => null));
  if (!parsed.ok) return fail(ERRORS.VALIDATION, 'Check the website details.', 400, { issues: parsed.issues });

  try {
    const website = await createWebsite(auth.profile.id, parsed.value);
    await audit(auth.profile.id, 'website.create', { entityType: 'website', entityId: website.id, detail: { room: website.room_id } });
    return json({ website }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFound) return fail(ERRORS.NOT_FOUND, 'That room does not exist.', 404);
    return fail(ERRORS.SERVER, error instanceof Error ? error.message : 'Create failed.', 500);
  }
}
