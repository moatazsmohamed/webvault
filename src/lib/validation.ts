import { z } from 'zod';

/** https? only — blocks javascript:, data:, file: and anything that could turn a link into an XSS vector. */
export const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\/[^\s<>"']+$/i, 'Use a full http(s):// address');

const optionalUrl = z.union([httpUrl, z.literal('')]).optional().or(z.null());

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'Lowercase letters, numbers and dashes only');

export const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a hex colour like #6366f1');

export const iconId = z.string().trim().regex(/^[a-z0-9_-]{1,32}$/);

export const tagName = z.string().trim().min(1).max(32);

export const statusEnum = z.enum(['active', 'in_development', 'paused', 'archived']);
export const urlKindEnum = z.enum(['live', 'admin', 'developer', 'source', 'hosting']);
export const accountTypeEnum = z.enum(['admin', 'developer', 'client', 'other']);

export const roomCreate = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slug.optional(),
  description: z.string().trim().max(500).default(''),
  color: hexColor.default('#6366f1'),
  icon: iconId.default('folder'),
});

export const roomUpdate = roomCreate.partial().extend({ archived: z.boolean().optional() });

export const urlsInput = z.object({
  live: optionalUrl,
  admin: optionalUrl,
  developer: optionalUrl,
  source: optionalUrl,
  hosting: optionalUrl,
}).partial();

export const websiteCreate = z.object({
  room_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(''),
  category: z.string().trim().max(60).default(''),
  client_name: z.string().trim().max(120).default(''),
  thumbnail_url: optionalUrl,
  status: statusEnum.default('active'),
  notes: z.string().trim().max(2000).default(''),
  tags: z.array(tagName).max(20).default([]),
  urls: urlsInput.default({}),
});

export const websiteUpdate = z.object({
  room_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(600).optional(),
  category: z.string().trim().max(60).optional(),
  client_name: z.string().trim().max(120).optional(),
  thumbnail_url: optionalUrl,
  status: statusEnum.optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(tagName).max(20).optional(),
  urls: urlsInput.optional(),
});

/**
 * A password is never validated for "strength" beyond a floor, but it can never
 * be empty on create, and it is never logged or echoed back.
 */
export const credentialCreate = z.object({
  website_id: z.string().uuid(),
  account_type: accountTypeEnum.default('admin'),
  title: z.string().trim().max(80).default(''),
  login_url: optionalUrl,
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(512),
  notes: z.string().trim().max(1000).optional(),
});

export const credentialUpdate = z.object({
  account_type: accountTypeEnum.optional(),
  title: z.string().trim().max(80).optional(),
  login_url: optionalUrl,
  username: z.string().trim().min(1).max(320).optional(),
  password: z.string().min(1).max(512).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const loginInput = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(512),
});

export const setupInput = z.object({
  username: z.string().trim().regex(/^[a-zA-Z0-9._-]{3,40}$/, '3–40 characters: letters, numbers, dot, dash, underscore'),
  password: z.string().min(12, 'Use at least 12 characters').max(512),
  display_name: z.string().trim().max(80).default(''),
  locale: z.enum(['ar', 'en']).default('ar'),
  setup_key: z.string().max(200).default(''),
});

export const passwordChangeInput = z.object({
  current_password: z.string().min(1).max(512),
  new_password: z.string().min(12, 'Use at least 12 characters').max(512),
});

export const usernameChangeInput = z.object({
  username: z.string().trim().regex(/^[a-zA-Z0-9._-]{3,40}$/),
  password: z.string().min(1).max(512),
});

export const profileSettingsInput = z.object({
  display_name: z.string().trim().max(80),
  locale: z.enum(['ar', 'en']),
  theme: z.enum(['dark', 'light']),
});

export const unlockInput = z.object({ password: z.string().min(1).max(512) });

/** The shape matches the database CHECK on profiles.recovery_email; '' clears the address. */
export const recoveryEmailInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine(v => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v), 'Use a full address like name@example.com'),
  password: z.string().min(1).max(512),
});

export const forgotRequestInput = z.object({
  username: z.string().trim().min(1).max(80),
});

export const passwordResetInput = z.object({
  username: z.string().trim().min(1).max(80),
  code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits'),
  password: z.string().min(12, 'Use at least 12 characters').max(512),
});

export const searchInput = z.object({
  q: z.string().trim().max(200).default(''),
  room: z.string().trim().max(64).optional(),
  status: statusEnum.optional(),
  category: z.string().trim().max(60).optional(),
  tag: z.string().trim().max(32).optional(),
  since: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

/** T binds to the schema's OUTPUT type, so `.default()` fields arrive already filled in. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): { ok: true; value: T } | { ok: false; issues: string[] } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`) };
}
