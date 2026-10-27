'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';
import { ConfirmDialog, Field, Modal, Spinner, useLocale, useToast } from './ui';
import { URL_ORDER } from './website-card';
import { ApiError, api } from '@/lib/client-api';
import type { DictKey } from '@/lib/i18n';
import type { Room, UrlKind, WebsiteDetail, WebsiteStatus } from '@/lib/types';
import { STATUSES } from '@/lib/types';

const SLOT_KEYS: Record<UrlKind, DictKey> = {
  live: 'url_live',
  admin: 'url_admin',
  developer: 'url_developer',
  source: 'url_source',
  hosting: 'url_hosting',
};

const HTTP_RE = /^https?:\/\/[^\s]+$/i;

type Draft = {
  room_id: string;
  name: string;
  description: string;
  category: string;
  client_name: string;
  status: WebsiteStatus;
  thumbnail_url: string;
  notes: string;
  tags: string;
  urls: Record<UrlKind, string>;
};

const blankUrls: Record<UrlKind, string> = { live: '', admin: '', developer: '', source: '', hosting: '' };

function draftFrom(site: WebsiteDetail | null, fallbackRoom: string): Draft {
  const urls: Record<UrlKind, string> = { ...blankUrls };
  for (const kind of URL_ORDER) urls[kind] = site?.urls[kind] ?? '';
  return {
    room_id: site?.room_id ?? fallbackRoom,
    name: site?.name ?? '',
    description: site?.description ?? '',
    category: site?.category ?? '',
    client_name: site?.client_name ?? '',
    status: site?.status ?? 'active',
    thumbnail_url: site?.thumbnail_url ?? '',
    notes: site?.notes ?? '',
    tags: site?.tags.join(', ') ?? '',
    urls,
  };
}

export function WebsiteFormModal({
  open,
  site,
  rooms,
  categories,
  defaultRoomId,
  onClose,
}: {
  open: boolean;
  site?: WebsiteDetail | null;
  rooms: Room[];
  categories: string[];
  defaultRoomId?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(null, defaultRoomId ?? rooms[0]?.id ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(site ?? null, defaultRoomId ?? rooms[0]?.id ?? ''));
    setErrors({});
  }, [open, site, defaultRoomId, rooms]);

  const tagList = useMemo(() => draft.tags.split(',').map(x => x.trim()).filter(Boolean), [draft.tags]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!draft.name.trim()) next.name = t('required_field');
    if (!draft.room_id) next.room_id = t('required_field');
    if (draft.thumbnail_url && !HTTP_RE.test(draft.thumbnail_url)) next.thumbnail_url = t('url_hint');
    for (const kind of URL_ORDER) {
      const value = draft.urls[kind];
      if (value && !HTTP_RE.test(value)) next[`urls.${kind}`] = t('url_hint');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);

    const payload = {
      room_id: draft.room_id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      category: draft.category.trim(),
      client_name: draft.client_name.trim(),
      status: draft.status,
      thumbnail_url: draft.thumbnail_url.trim() || null,
      notes: draft.notes.trim(),
      tags: tagList,
      urls: Object.fromEntries(URL_ORDER.filter(kind => draft.urls[kind].trim()).map(kind => [kind, draft.urls[kind].trim()])),
    };

    try {
      if (site) {
        await api.patch(`/api/websites/${site.id}`, payload);
        toast.push('ok', t('updated_ok'));
      } else {
        const res = await api.post<{ website: WebsiteDetail }>('/api/websites', payload);
        toast.push('ok', t('created_ok'));
        router.push(`/websites/${res.website.id}`);
      }
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(Object.fromEntries(err.issues.map(i => [i.split(':')[0] ?? 'form', i])));
      else toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
      setBusy(false);
    }
  }

  const usableRooms = rooms.filter(r => !r.archived || site?.room_id === r.id);

  return (
    <Modal
      open={open}
      wide
      title={site ? t('edit_site') : t('new_site')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="submit" form="site-form" className="btn btn-primary" disabled={busy || usableRooms.length === 0}>
            {busy ? <Spinner /> : <Icon name="check" size={16} />}
            {t('save')}
          </button>
        </>
      }
    >
      <form id="site-form" onSubmit={submit} className="flex flex-col gap-4">
        {usableRooms.length === 0 ? (
          <p className="rounded-xl border px-3 py-2.5 text-sm" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' }}>
            {t('empty_rooms')}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('site_name')} required error={errors.name}>
            <input className="field" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} maxLength={120} required autoFocus />
          </Field>
          <Field label={t('filter_room')} required error={errors.room_id}>
            <select className="field" value={draft.room_id} onChange={e => setDraft(d => ({ ...d, room_id: e.target.value }))}>
              {usableRooms.map(room => (
                <option key={room.id} value={room.id}>
                  {room.name}
                  {room.archived ? ` — ${t('archived')}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t('description')} hint={t('optional')}>
          <textarea className="field min-h-20 resize-y" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} maxLength={600} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('category')} hint={t('optional')}>
            <input className="field" list="wv-categories" value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} maxLength={60} />
            <datalist id="wv-categories">
              {categories.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label={t('client')} hint={t('optional')}>
            <input className="field" value={draft.client_name} onChange={e => setDraft(d => ({ ...d, client_name: e.target.value }))} maxLength={120} />
          </Field>
          <Field label={t('status')}>
            <select className="field" value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as WebsiteStatus }))}>
              {STATUSES.map(status => (
                <option key={status} value={status}>
                  {t(`status_${status}` as DictKey)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('tags')} hint={t('tags_hint')}>
            <input className="field" value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} maxLength={200} />
          </Field>
          <Field label={t('thumbnail')} hint={t('optional')} error={errors.thumbnail_url}>
            <input className="field" inputMode="url" placeholder={t('url_hint')} value={draft.thumbnail_url} onChange={e => setDraft(d => ({ ...d, thumbnail_url: e.target.value }))} maxLength={2048} />
          </Field>
        </div>

        <div className="rounded-2xl border bg-ink-850/60 p-4">
          <p className="label mb-3">{t('edit_link_slots')}</p>
          <div className="flex flex-col gap-3">
            {URL_ORDER.map(kind => (
              <div key={kind} className="grid items-center gap-2 sm:grid-cols-[9.5rem_1fr]">
                <span className="flex items-center gap-2 text-xs muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {t(SLOT_KEYS[kind])}
                </span>
                <div className="relative">
                  <input
                    className="field pe-9"
                    inputMode="url"
                    placeholder={t('url_hint')}
                    value={draft.urls[kind]}
                    onChange={e => setDraft(d => ({ ...d, urls: { ...d.urls, [kind]: e.target.value } }))}
                    maxLength={2048}
                  />
                  {draft.urls[kind] ? (
                    <span className="pointer-events-none absolute inset-y-0 grid w-9 place-items-center text-ok ltr:right-0 rtl:left-0">
                      <Icon name="check" size={15} />
                    </span>
                  ) : null}
                </div>
                {errors[`urls.${kind}`] ? <p className="text-xs text-bad sm:col-start-2">{errors[`urls.${kind}`]}</p> : null}
              </div>
            ))}
          </div>
        </div>

        <Field label={t('notes')} hint={t('optional')}>
          <textarea className="field min-h-16 resize-y" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} maxLength={2000} />
        </Field>
      </form>
    </Modal>
  );
}

export function WebsiteCreateButton({
  rooms,
  categories,
  defaultRoomId,
  label,
  autoOpen,
}: {
  rooms: Room[];
  categories: string[];
  defaultRoomId?: string;
  label?: string;
  autoOpen?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(Boolean(autoOpen));
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        {label ?? t('new_site')}
      </button>
      <WebsiteFormModal open={open} rooms={rooms} categories={categories} defaultRoomId={defaultRoomId} onClose={() => setOpen(false)} />
    </>
  );
}

export function WebsiteEditButton({ site, rooms, categories }: { site: WebsiteDetail; rooms: Room[]; categories: string[] }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Icon name="edit" size={15} />
        {t('edit')}
      </button>
      <WebsiteFormModal open={open} site={site} rooms={rooms} categories={categories} onClose={() => setOpen(false)} />
    </>
  );
}

export function WebsiteDeleteButton({ siteId, siteName }: { siteId: string; siteName: string }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api.del(`/api/websites/${siteId}`, { confirm: true });
      toast.push('ok', t('deleted_ok'));
      router.push('/websites');
      router.refresh();
    } catch (err) {
      toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
        <Icon name="trash" size={15} />
        {t('delete')}
      </button>
      <ConfirmDialog
        open={open}
        title={`${t('delete_site')} — ${siteName}`}
        body={t('delete_site_warning')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        requireText="DELETE"
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      />
    </>
  );
}
