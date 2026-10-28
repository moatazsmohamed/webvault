import 'server-only';
import { admin } from './supabase/server';
import { blindIndex, decrypt, encrypt, hint } from './crypto';
import type { AccountType, CredentialMeta, DashboardStats, RevealedCredential, Room, UrlKind, WebsiteCard, WebsiteDetail, WebsiteStatus } from './types';
import { URL_KINDS } from './types';

/**
 * Data access. Every function is owner-scoped and never reads an `*_enc` column
 * except `revealCredential`, which is reached only behind the unlock check.
 */

export class NotFound extends Error {
  constructor() {
    super('NOT_FOUND');
    this.name = 'NotFound';
  }
}

/** True only while no profile exists — decides between /login and first-run setup. */
export async function isFirstRun(): Promise<boolean> {
  const { data } = await admin().rpc('webvault_is_first_run');
  return data === true;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\u0000-\u007e]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'room';

async function uniqueSlug(owner: string, base: string, ignoreId?: string): Promise<string> {
  const db = admin();
  let candidate = slugify(base);
  for (let i = 0; i < 50; i += 1) {
    let query = db.from('rooms').select('id').eq('owner_id', owner).eq('slug', candidate).limit(1);
    if (ignoreId) query = query.neq('id', ignoreId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
    candidate = `${slugify(base)}-${(i + 2).toString(36)}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
}

// ─── rooms ───────────────────────────────────────────────────────────────────

export async function listRooms(owner: string, opts: { includeArchived?: boolean } = {}): Promise<Room[]> {
  const db = admin();
  let query = db.from('rooms').select('*').eq('owner_id', owner).order('created_at', { ascending: true });
  if (!opts.includeArchived) query = query.eq('archived', false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const { data: stats, error: statsError } = await db.rpc('webvault_room_stats', { p_owner: owner });
  if (statsError) throw new Error(statsError.message);
  const byId = new Map<string, Record<string, number>>(
    (stats ?? []).map((s: { room_id: string; website_count: number; active_count: number; dashboard_count: number; incomplete_count: number }) => [
      s.room_id,
      { website: s.website_count, active: s.active_count, dashboards: s.dashboard_count, incomplete: s.incomplete_count },
    ]),
  );

  return (data ?? []).map(r => ({
    ...r,
    website_count: byId.get(r.id)?.website ?? 0,
    active_count: byId.get(r.id)?.active ?? 0,
    dashboard_count: byId.get(r.id)?.dashboards ?? 0,
    incomplete_count: byId.get(r.id)?.incomplete ?? 0,
  })) as Room[];
}

export async function getRoom(owner: string, id: string): Promise<Room | null> {
  const rooms = await listRooms(owner, { includeArchived: true });
  return rooms.find(r => r.id === id) ?? null;
}

export async function createRoom(owner: string, input: { name: string; slug?: string; description: string; color: string; icon: string }): Promise<Room> {
  const db = admin();
  const slug = input.slug?.trim() || (await uniqueSlug(owner, input.name));
  const { data, error } = await db
    .from('rooms')
    .insert({ owner_id: owner, name: input.name, slug, description: input.description, color: input.color, icon: input.icon })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return { ...data, website_count: 0, active_count: 0, dashboard_count: 0, incomplete_count: 0 } as Room;
}

export async function updateRoom(owner: string, id: string, patch: Partial<Pick<Room, 'name' | 'slug' | 'description' | 'color' | 'icon' | 'archived'>>): Promise<Room> {
  const db = admin();
  const { data: existing, error: findError } = await db.from('rooms').select('id,name,slug').eq('owner_id', owner).eq('id', id).maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!existing) throw new NotFound();

  const body: Record<string, unknown> = { ...patch };
  if (patch.slug === undefined && patch.name && patch.name !== existing.name) {
    body.slug = await uniqueSlug(owner, patch.name, id);
  }
  const { data, error } = await db.from('rooms').update(body).eq('owner_id', owner).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  return (await getRoom(owner, data.id))!;
}

export async function deleteRoom(owner: string, id: string): Promise<void> {
  const { error } = await admin().from('rooms').delete().eq('owner_id', owner).eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── websites ────────────────────────────────────────────────────────────────

type WebsiteRow = Record<string, unknown>;

async function attachDetails(owner: string, rows: WebsiteRow[]): Promise<WebsiteCard[]> {
  if (rows.length === 0) return [];
  const db = admin();
  const ids = rows.map(r => String(r.id));

  const [urlsRes, tagsRes, credsRes] = await Promise.all([
    db.from('website_urls').select('website_id,kind,url').in('website_id', ids),
    db.from('website_tags').select('website_id, tags(name)').in('website_id', ids),
    db.from('credentials').select('website_id').in('website_id', ids),
  ]);

  const urlMap = new Map<string, Partial<Record<UrlKind, string>>>();
  for (const u of urlsRes.data ?? []) {
    const slot = urlMap.get(u.website_id) ?? {};
    slot[u.kind as UrlKind] = u.url;
    urlMap.set(u.website_id, slot);
  }
  const tagMap = new Map<string, string[]>();
  for (const t of tagsRes.data ?? []) {
    const list = tagMap.get(t.website_id) ?? [];
    const name = (t as unknown as { tags: { name: string } | null }).tags?.name;
    if (name) list.push(name);
    tagMap.set(t.website_id, list);
  }
  const credMap = new Map<string, number>();
  for (const c of credsRes.data ?? []) {
    credMap.set(c.website_id, (credMap.get(c.website_id) ?? 0) + 1);
  }

  return rows.map(r => ({
    ...(r as object),
    urls: urlMap.get(String(r.id)) ?? {},
    tags: tagMap.get(String(r.id)) ?? [],
    credential_count: credMap.get(String(r.id)) ?? 0,
  })) as WebsiteCard[];
}

const WEBSITE_SELECT = 'id,name,description,category,client_name,thumbnail_url,status,room_id,created_at,updated_at,access_count,last_accessed_at,rooms(name,color)';

/** Supabase types a to-one embed as an array, so both shapes are accepted here. */
function flatten(row: WebsiteRow): WebsiteRow {
  const { rooms, ...rest } = row;
  const embedded = (Array.isArray(rooms) ? rooms[0] : rooms) as { name?: string; color?: string } | undefined;
  return { ...rest, room_name: embedded?.name ?? '', room_color: embedded?.color ?? '#6366f1' };
}

export type WebsiteFilter = {
  roomId?: string;
  q?: string;
  status?: WebsiteStatus;
  category?: string;
  tag?: string;
  since?: string;
  includeArchived?: boolean;
  sort?: 'recent' | 'name' | 'accessed';
  limit?: number;
};

export async function listWebsites(owner: string, filter: WebsiteFilter = {}): Promise<WebsiteCard[]> {
  const db = admin();

  // A tag filter resolves to an id set, and the url/room search below needs the
  // same set as its starting point, so it is applied to every page built here.
  let allowedIds: string[] | null = null;
  if (filter.tag) {
    const { data: tagRows } = await db.from('tags').select('id').eq('owner_id', owner).eq('name', filter.tag).limit(5);
    const tagIds = (tagRows ?? []).map(t => t.id);
    if (tagIds.length === 0) return [];
    const { data: links } = await db.from('website_tags').select('website_id').in('tag_id', tagIds).limit(1000);
    const ids = (links ?? []).map(l => l.website_id);
    if (ids.length === 0) return [];
    allowedIds = ids;
  }

  function base() {
    let query = db.from('websites').select(WEBSITE_SELECT).eq('owner_id', owner);
    if (filter.roomId) query = query.eq('room_id', filter.roomId);
    if (!filter.includeArchived && !filter.status) query = query.neq('status', 'archived');
    if (filter.status) query = query.eq('status', filter.status);
    if (filter.category) query = query.eq('category', filter.category);
    if (filter.since) query = query.gte('created_at', filter.since);
    if (allowedIds) query = query.in('id', allowedIds);
    return query;
  }
  type Page = ReturnType<typeof base>;

  async function run(select: (query: Page) => Page): Promise<WebsiteRow[]> {
    let query = select(base());
    if (filter.sort === 'name') query = query.order('name', { ascending: true });
    else if (filter.sort === 'accessed') query = query.order('last_accessed_at', { ascending: false, nullsFirst: false });
    else query = query.order('created_at', { ascending: false });
    const { data, error } = await query.limit(filter.limit ?? 200);
    if (error) throw new Error(error.message);
    return (data ?? []).map(flatten);
  }

  const q = filter.q?.trim();
  if (!q) return attachDetails(owner, await run(query => query));

  const like = `%${q.replace(/[%,()]/g, ' ')}%`;
  const textHits = await run(query =>
    query.or(`name.ilike.${like},client_name.ilike.${like},category.ilike.${like},description.ilike.${like}`),
  );

  // URLs and room names live in other tables, so each contributes its own page.
  const [urlHits, roomHits] = await Promise.all([
    db.from('website_urls').select('website_id').eq('owner_id', owner).ilike('url', like).limit(200),
    db.from('rooms').select('id').eq('owner_id', owner).ilike('name', like).limit(50),
  ]);
  const siteIds = [...new Set((urlHits.data ?? []).map(u => String(u.website_id)))];
  const roomIds = [...new Set((roomHits.data ?? []).map(r => String(r.id)))];
  if (siteIds.length === 0 && roomIds.length === 0) return attachDetails(owner, textHits);

  const linked = await Promise.all([
    ...(siteIds.length ? [run(query => query.in('id', siteIds))] : []),
    ...(roomIds.length ? [run(query => query.in('room_id', roomIds))] : []),
  ]);

  const byId = new Map<string, WebsiteRow>();
  for (const row of [...textHits, ...linked.flat()]) byId.set(String(row.id), row);
  const merged = [...byId.values()].sort(compareRows(filter.sort));
  return attachDetails(owner, merged.slice(0, filter.limit ?? 200));
}

function compareRows(sort: WebsiteFilter['sort']) {
  const stamp = (value: unknown) => Date.parse(String(value ?? '')) || 0;
  if (sort === 'name') return (a: WebsiteRow, b: WebsiteRow) => String(a.name).localeCompare(String(b.name));
  if (sort === 'accessed') return (a: WebsiteRow, b: WebsiteRow) => stamp(b.last_accessed_at) - stamp(a.last_accessed_at);
  return (a: WebsiteRow, b: WebsiteRow) => stamp(b.created_at) - stamp(a.created_at);
}


export async function getWebsite(owner: string, id: string): Promise<WebsiteDetail | null> {
  const db = admin();
  const { data, error } = await db
    .from('websites')
    .select(`${WEBSITE_SELECT},notes`)
    .eq('owner_id', owner)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const [card] = await attachDetails(owner, [flatten(data)]);
  const meta = await listCredentialMeta(owner, { websiteId: id });
  return { ...(card as WebsiteCard), notes: String(data.notes ?? ''), credentials: meta };
}

async function syncTags(owner: string, websiteId: string, names: string[]): Promise<void> {
  const db = admin();
  const wanted = [...new Set(names.map(n => n.trim()).filter(Boolean))].slice(0, 20);

  const { data: existing } = await db.from('tags').select('id,name').eq('owner_id', owner);
  const byName = new Map((existing ?? []).map(t => [t.name.toLowerCase(), t.id]));
  const ids: string[] = [];

  for (const name of wanted) {
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const { data: created, error } = await db.from('tags').insert({ owner_id: owner, name }).select('id').single();
      if (error || !created) continue;
      id = created.id;
      byName.set(name.toLowerCase(), id);
    }
    ids.push(id);
  }

  await db.from('website_tags').delete().eq('website_id', websiteId);
  if (ids.length > 0) {
    await db.from('website_tags').insert(ids.map(tag_id => ({ website_id: websiteId, tag_id })));
  }
}

async function syncUrls(owner: string, websiteId: string, urls: Partial<Record<UrlKind, string | null>>): Promise<void> {
  const db = admin();
  for (const kind of URL_KINDS) {
    const value = urls?.[kind]?.trim();
    if (!value) {
      await db.from('website_urls').delete().eq('website_id', websiteId).eq('kind', kind);
      continue;
    }
    await db
      .from('website_urls')
      .upsert({ owner_id: owner, website_id: websiteId, kind, url: value }, { onConflict: 'website_id,kind' });
  }
}

export async function createWebsite(owner: string, input: {
  room_id: string; name: string; description: string; category: string; client_name: string;
  thumbnail_url?: string | null; status: WebsiteStatus; notes: string; tags: string[]; urls: Partial<Record<UrlKind, string | null>>;
}): Promise<WebsiteDetail> {
  const db = admin();
  const { data: room } = await db.from('rooms').select('id').eq('owner_id', owner).eq('id', input.room_id).maybeSingle();
  if (!room) throw new NotFound();

  const { data, error } = await db
    .from('websites')
    .insert({
      owner_id: owner,
      room_id: input.room_id,
      name: input.name,
      description: input.description,
      category: input.category,
      client_name: input.client_name,
      thumbnail_url: input.thumbnail_url || null,
      status: input.status,
      notes: input.notes,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'INSERT_FAILED');

  await syncUrls(owner, data.id, input.urls ?? {});
  await syncTags(owner, data.id, input.tags ?? []);
  return (await getWebsite(owner, data.id))!;
}

export async function updateWebsite(owner: string, id: string, patch: Record<string, unknown>): Promise<WebsiteDetail> {
  const db = admin();
  const { data: existing } = await db.from('websites').select('id').eq('owner_id', owner).eq('id', id).maybeSingle();
  if (!existing) throw new NotFound();

  const { tags, urls, room_id, ...body } = patch as { tags?: string[]; urls?: Partial<Record<UrlKind, string>>; room_id?: string } & Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (['name', 'description', 'category', 'client_name', 'thumbnail_url', 'status', 'notes'].includes(k)) {
      clean[k] = k === 'thumbnail_url' ? (v || null) : v;
    }
  }
  if (room_id) {
    const { data: room } = await db.from('rooms').select('id').eq('owner_id', owner).eq('id', room_id).maybeSingle();
    if (!room) throw new NotFound();
    clean.room_id = room_id;
  }
  if (Object.keys(clean).length > 0) {
    const { error } = await db.from('websites').update(clean).eq('owner_id', owner).eq('id', id);
    if (error) throw new Error(error.message);
  }
  if (urls) await syncUrls(owner, id, urls);
  if (tags) await syncTags(owner, id, tags);
  return (await getWebsite(owner, id))!;
}

export async function deleteWebsite(owner: string, id: string): Promise<void> {
  const { error } = await admin().from('websites').delete().eq('owner_id', owner).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setStatus(owner: string, id: string, status: WebsiteStatus): Promise<WebsiteDetail> {
  return updateWebsite(owner, id, { status });
}

/** Called when the admin opens an external link through the dashboard. */
export async function touchAccess(owner: string, id: string): Promise<void> {
  const db = admin();
  const { data } = await db.from('websites').select('access_count').eq('owner_id', owner).eq('id', id).maybeSingle();
  if (!data) return;
  await db.from('websites').update({ access_count: Number(data.access_count ?? 0) + 1, last_accessed_at: new Date().toISOString() }).eq('owner_id', owner).eq('id', id);
}

// ─── credentials ─────────────────────────────────────────────────────────────

/** Metadata only. There is no code path here that returns a stored secret. */
export async function listCredentialMeta(owner: string, opts: { websiteId?: string } = {}): Promise<CredentialMeta[]> {
  const db = admin();
  let query = db
    .from('credentials')
    .select('id,website_id,account_type,title,login_url,username_hint,created_at,updated_at,last_revealed_at,reveal_count,password_changed_at')
    .eq('owner_id', owner);
  if (opts.websiteId) query = query.eq('website_id', opts.websiteId);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CredentialMeta[];
}

export async function listAllCredentials(owner: string): Promise<(CredentialMeta & { website_name: string; room_name: string })[]> {
  const db = admin();
  const { data, error } = await db
    .from('credentials')
    .select('id,website_id,account_type,title,login_url,username_hint,created_at,updated_at,last_revealed_at,reveal_count,password_changed_at,websites(name,rooms(name))')
    .eq('owner_id', owner)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const site = row.websites as { name: string; rooms: { name: string } | null } | null;
    const { websites, ...rest } = row;
    return { ...(rest as CredentialMeta), website_name: site?.name ?? '', room_name: site?.rooms?.name ?? '' };
  });
}

export async function createCredential(owner: string, input: {
  website_id: string; account_type: AccountType; title: string; login_url?: string | null; username: string; password: string; notes?: string;
}): Promise<CredentialMeta> {
  const db = admin();
  const { data: site } = await db.from('websites').select('id').eq('owner_id', owner).eq('id', input.website_id).maybeSingle();
  if (!site) throw new NotFound();

  const { data, error } = await db
    .from('credentials')
    .insert({
      owner_id: owner,
      website_id: input.website_id,
      account_type: input.account_type,
      title: input.title || input.account_type,
      login_url: input.login_url || null,
      username_enc: encrypt(input.username),
      password_enc: encrypt(input.password),
      notes_enc: input.notes ? encrypt(input.notes) : null,
      username_hint: hint(input.username),
      username_idx: blindIndex(input.username),
      password_changed_at: new Date().toISOString(),
    })
    .select('id,website_id,account_type,title,login_url,username_hint,created_at,updated_at,last_revealed_at,reveal_count,password_changed_at')
    .single();
  if (error) throw new Error(error.message);
  return data as CredentialMeta;
}

export async function updateCredential(owner: string, id: string, patch: {
  account_type?: AccountType; title?: string; login_url?: string | null; username?: string; password?: string; notes?: string;
}): Promise<CredentialMeta> {
  const db = admin();
  const { data: existing } = await db.from('credentials').select('id').eq('owner_id', owner).eq('id', id).maybeSingle();
  if (!existing) throw new NotFound();

  const body: Record<string, unknown> = {};
  if (patch.account_type) body.account_type = patch.account_type;
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.login_url !== undefined) body.login_url = patch.login_url || null;
  if (patch.username) {
    body.username_enc = encrypt(patch.username);
    body.username_hint = hint(patch.username);
    body.username_idx = blindIndex(patch.username);
  }
  if (patch.password) {
    body.password_enc = encrypt(patch.password);
    body.password_changed_at = new Date().toISOString();
  }
  if (patch.notes !== undefined) body.notes_enc = patch.notes ? encrypt(patch.notes) : null;

  const { error } = await db.from('credentials').update(body).eq('owner_id', owner).eq('id', id);
  if (error) throw new Error(error.message);
  const meta = await listCredentialMeta(owner);
  return meta.find(m => m.id === id)!;
}

export async function deleteCredential(owner: string, id: string): Promise<void> {
  const { error } = await admin().from('credentials').delete().eq('owner_id', owner).eq('id', id);
  if (error) throw new Error(error.message);
}

/** The one function that decrypts. Callers must have already checked the unlock state. */
export async function revealCredential(owner: string, id: string): Promise<RevealedCredential | null> {
  const db = admin();
  const { data, error } = await db
    .from('credentials')
    .select('id,website_id,account_type,title,login_url,username_hint,created_at,updated_at,last_revealed_at,reveal_count,password_changed_at,username_enc,password_enc,notes_enc')
    .eq('owner_id', owner)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: site } = await db.from('websites').select('name').eq('owner_id', owner).eq('id', data.website_id).maybeSingle();
  await db.from('credentials').update({ reveal_count: Number(data.reveal_count ?? 0) + 1, last_revealed_at: new Date().toISOString() }).eq('owner_id', owner).eq('id', id);

  const { username_enc, password_enc, notes_enc, ...meta } = data;
  void username_enc;
  return {
    ...(meta as CredentialMeta),
    website_name: site?.name ?? '',
    username: decryptOrThrow(username_enc),
    password: decryptOrThrow(password_enc),
    notes: notes_enc ? decryptOrThrow(notes_enc) : '',
  };
}

function decryptOrThrow(value: unknown): string {
  if (typeof value !== 'string') throw new Error('VAULT_DECRYPT_FAILED');
  return decrypt(value);
}

// ─── dashboard ───────────────────────────────────────────────────────────────

export async function dashboardStats(owner: string): Promise<DashboardStats> {
  const db = admin();
  const [{ data: rooms }, { data: sites }, { data: creds }, { data: dashboards }] = await Promise.all([
    db.from('rooms').select('id').eq('owner_id', owner),
    db.from('websites').select('id,status,description,category').eq('owner_id', owner),
    db.from('credentials').select('id').eq('owner_id', owner),
    db.from('website_urls').select('website_id').eq('owner_id', owner).eq('kind', 'admin'),
  ]);

  const list = sites ?? [];
  const adminSites = new Set((dashboards ?? []).map(d => d.website_id));
  const incomplete = list.filter(s => !s.description || !s.category || !adminSites.has(s.id)).length;

  return {
    rooms: (rooms ?? []).length,
    websites: list.length,
    dashboards: adminSites.size,
    credentials: (creds ?? []).length,
    active: list.filter(s => s.status === 'active').length,
    inDevelopment: list.filter(s => s.status === 'in_development').length,
    paused: list.filter(s => s.status === 'paused').length,
    archived: list.filter(s => s.status === 'archived').length,
    incomplete,
  };
}

export async function recentWebsites(owner: string, limit = 6): Promise<WebsiteCard[]> {
  return listWebsites(owner, { includeArchived: true, limit });
}

export async function recentlyAccessed(owner: string, limit = 6): Promise<WebsiteCard[]> {
  const db = admin();
  const { data, error } = await db
    .from('websites')
    .select(WEBSITE_SELECT)
    .eq('owner_id', owner)
    .not('last_accessed_at', 'is', null)
    .order('last_accessed_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return attachDetails(owner, (data ?? []).map(flatten));
}

export async function incompleteWebsites(owner: string, limit = 8): Promise<WebsiteCard[]> {
  const all = await listWebsites(owner, { includeArchived: false, limit: 200 });
  return all
    .filter(w => !w.description.trim() || !w.category.trim() || Object.keys(w.urls).length === 0)
    .slice(0, limit);
}

export async function activityFeed(owner: string, limit = 20) {
  const { data, error } = await admin()
    .from('activity_logs')
    .select('id,action,entity_type,entity_id,detail,created_at')
    .eq('owner_id', owner)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as import('./types').ActivityEntry[];
}

export async function allTags(owner: string): Promise<string[]> {
  const { data } = await admin().from('tags').select('name').eq('owner_id', owner).order('name');
  return (data ?? []).map(t => t.name);
}

export async function allCategories(owner: string): Promise<string[]> {
  const { data } = await admin().from('websites').select('category').eq('owner_id', owner).neq('category', '');
  return [...new Set((data ?? []).map(d => d.category).filter(Boolean))].sort();
}
