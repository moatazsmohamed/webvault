'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from './icons';
import { ConfirmDialog, Field, Modal, Spinner, useLocale, useToast } from './ui';
import { ApiError, api } from '@/lib/client-api';
import type { Room } from '@/lib/types';

const ICON_CHOICES: IconName[] = ['folder', 'globe', 'grid', 'vault', 'key', 'shield', 'server', 'code', 'spark', 'clock'];
const COLOR_CHOICES = ['#6366f1', '#60a5fa', '#22d3ee', '#34d399', '#a3e635', '#fbbf24', '#f472b6', '#a78bfa'];

type Draft = { name: string; description: string; color: string; icon: IconName };

const emptyDraft: Draft = { name: '', description: '', color: '#6366f1', icon: 'folder' };

export function RoomFormModal({ open, room, onClose }: { open: boolean; room?: Room | null; onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(room ? { name: room.name, description: room.description, color: room.color, icon: room.icon as IconName } : emptyDraft);
    setError('');
  }, [open, room]);

  const iconSafe: IconName = ICON_CHOICES.includes(draft.icon) ? draft.icon : 'folder';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (room) await api.patch(`/api/rooms/${room.id}`, draft);
      else await api.post('/api/rooms', draft);
      toast.push('ok', room ? t('updated_ok') : t('created_ok'));
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('err_server'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={room ? t('edit_room') : t('new_room')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="submit" form="room-form" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner /> : <Icon name="check" size={16} />}
            {t('save')}
          </button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('room_name')} required>
          <input className="field" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} maxLength={80} required autoFocus />
        </Field>

        <Field label={t('room_desc')} hint={t('optional')}>
          <textarea
            className="field min-h-20 resize-y"
            value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            maxLength={500}
          />
        </Field>

        <Field label={t('room_icon')}>
          <div className="flex flex-wrap gap-2">
            {ICON_CHOICES.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => setDraft(d => ({ ...d, icon: name }))}
                className="grid h-10 w-10 place-items-center rounded-xl border transition"
                style={
                  draft.icon === name
                    ? { borderColor: draft.color, background: `color-mix(in srgb, ${draft.color} 18%, transparent)`, color: draft.color }
                    : { color: 'var(--txt-low)' }
                }
                aria-label={name}
                aria-pressed={draft.icon === name}
              >
                <Icon name={name} size={17} />
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('room_color')}>
          <div className="flex flex-wrap items-center gap-2">
            {COLOR_CHOICES.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => setDraft(d => ({ ...d, color }))}
                className="h-8 w-8 rounded-full border-2 transition"
                style={{ background: color, borderColor: draft.color === color ? 'var(--txt-hi)' : 'transparent' }}
                aria-label={color}
              />
            ))}
            <input
              type="color"
              value={draft.color}
              onChange={e => setDraft(d => ({ ...d, color: e.target.value }))}
              className="h-8 w-12 cursor-pointer rounded-lg border bg-ink-850"
              aria-label={t('room_color')}
            />
            <span className="chip bg-ink-800 font-mono text-xs">
              <span className="h-3 w-3 rounded-full" style={{ background: draft.color }} />
              {draft.color}
            </span>
          </div>
        </Field>

        <div className="card flex items-center gap-3 !p-3" style={{ borderColor: `color-mix(in srgb, ${draft.color} 40%, transparent)` }}>
          <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${draft.color} 18%, transparent)`, color: draft.color }}>
            <Icon name={iconSafe} size={17} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{draft.name || t('room')}</p>
            <p className="truncate text-xs faint">{draft.description || t('optional')}</p>
          </div>
        </div>

        {error ? <p className="text-sm text-bad">{error}</p> : null}
      </form>
    </Modal>
  );
}

export function RoomCreateButton({ label }: { label?: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        {label ?? t('new_room')}
      </button>
      <RoomFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function RoomEditButton({ room }: { room: Room }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Icon name="edit" size={15} />
        {t('edit')}
      </button>
      <RoomFormModal open={open} room={room} onClose={() => setOpen(false)} />
    </>
  );
}

export function RoomDeleteButton({ room }: { room: Room }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api.del(`/api/rooms/${room.id}`, { confirm: true });
      toast.push('ok', t('deleted_ok'));
      router.push('/rooms');
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
        title={t('delete_room')}
        body={t('delete_room_warning')}
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

export function RoomArchiveButton({ room }: { room: Room }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await api.patch(`/api/rooms/${room.id}`, { archived: !room.archived });
      toast.push('ok', t('updated_ok'));
      router.refresh();
    } catch (err) {
      toast.push('bad', err instanceof ApiError ? err.message : t('err_server'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} disabled={busy}>
      {busy ? <Spinner /> : <Icon name={room.archived ? 'unlock' : 'vault'} size={15} />}
      {room.archived ? t('restore') : t('archive')}
    </button>
  );
}
