import { assertEnv } from '@/lib/env';
import { audit, guard, json, rejectCrossSite } from '@/lib/api';
import { listRooms, listWebsites, listCredentialMeta } from '@/lib/db';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CSV_COLUMNS = [
  'room', 'name', 'status', 'category', 'client', 'description', 'tags',
  'live_url', 'admin_url', 'developer_url', 'source_url', 'hosting_url',
  'credential_count', 'credential_hints', 'added_at', 'last_accessed_at',
];

/**
 * Backup/export of PROJECT METADATA only.
 * Credential rows are reduced to a count and a masked hint; there is no code
 * path here that touches a *_enc column, so an export file is always safe to
 * keep in a drawer or email to yourself.
 */
export async function GET(req: Request) {
  assertEnv();
  const auth = await guard();
  if (!auth.ok) return auth.response;

  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const owner = auth.profile.id;
  const rooms = await listRooms(owner, { includeArchived: true });
  const websites = await listWebsites(owner, { includeArchived: true, limit: 1000 });

  const metaBySite = new Map<string, { count: number; hints: string[] }>();
  for (const site of websites) {
    const meta = await listCredentialMeta(owner, { websiteId: site.id });
    metaBySite.set(site.id, { count: meta.length, hints: meta.map(m => `${m.account_type}:${m.username_hint}`) });
  }

  const rows = websites.map(site => {
    const creds = metaBySite.get(site.id) ?? { count: 0, hints: [] };
    return {
      room: rooms.find(r => r.id === site.room_id)?.name ?? '',
      id: site.id,
      name: site.name,
      status: site.status,
      category: site.category,
      client: site.client_name,
      description: site.description,
      tags: site.tags,
      urls: site.urls,
      credential_count: creds.count,
      credential_hints: creds.hints,
      added_at: site.created_at,
      last_accessed_at: site.last_accessed_at,
    };
  });

  const payload = {
    exported_at: new Date().toISOString(),
    app: 'WebVault',
    secrets_included: false,
    note: 'Metadata only. Passwords, usernames and encryption keys are never exported.',
    rooms: rooms.map(r => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, color: r.color, icon: r.icon, archived: r.archived, website_count: r.website_count })),
    websites: rows,
  };

  await audit(owner, 'data.export', { entityType: 'export', entityId: format, detail: { websites: rows.length } });

  if (format === 'csv') {
    const esc = (value: unknown) => {
      const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [CSV_COLUMNS.join(',')];
    for (const row of rows) {
      lines.push([
        row.room, row.name, row.status, row.category, row.client, row.description, row.tags.join('|'),
        row.urls.live ?? '', row.urls.admin ?? '', row.urls.developer ?? '', row.urls.source ?? '', row.urls.hosting ?? '',
        row.credential_count, row.credential_hints.join('|'), row.added_at, row.last_accessed_at ?? '',
      ].map(esc).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="webvault-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  return json(payload, { headers: { 'content-disposition': `attachment; filename="webvault-${new Date().toISOString().slice(0, 10)}.json"` } });
}
