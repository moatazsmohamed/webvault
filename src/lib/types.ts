export type UrlKind = 'live' | 'admin' | 'developer' | 'source' | 'hosting';
export type WebsiteStatus = 'active' | 'in_development' | 'paused' | 'archived';
export type AccountType = 'admin' | 'developer' | 'client' | 'other';
export type Locale = 'ar' | 'en';

export const URL_KINDS: UrlKind[] = ['live', 'admin', 'developer', 'source', 'hosting'];
export const STATUSES: WebsiteStatus[] = ['active', 'in_development', 'paused', 'archived'];
export const ACCOUNT_TYPES: AccountType[] = ['admin', 'developer', 'client', 'other'];

export type Room = {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  icon: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  website_count: number;
  active_count: number;
  dashboard_count: number;
  incomplete_count: number;
};

/** What every list/detail screen may show. Note what is absent: no *_enc columns. */
export type WebsiteCard = {
  id: string;
  name: string;
  description: string;
  category: string;
  client_name: string;
  thumbnail_url: string | null;
  status: WebsiteStatus;
  room_id: string;
  room_name: string;
  room_color: string;
  urls: Partial<Record<UrlKind, string>>;
  tags: string[];
  credential_count: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WebsiteDetail = WebsiteCard & {
  notes: string;
  credentials: CredentialMeta[];
};

/** Credential metadata only — enough to identify a row without unlocking anything. */
export type CredentialMeta = {
  id: string;
  website_id: string;
  website_name?: string;
  room_name?: string;
  account_type: AccountType;
  title: string;
  login_url: string | null;
  username_hint: string;
  created_at: string;
  updated_at: string;
  last_revealed_at: string | null;
  reveal_count: number;
  password_changed_at: string | null;
};

export type RevealedCredential = CredentialMeta & {
  username: string;
  password: string;
  notes: string;
};

export type ActivityEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type DashboardStats = {
  rooms: number;
  websites: number;
  dashboards: number;
  credentials: number;
  active: number;
  inDevelopment: number;
  paused: number;
  archived: number;
  incomplete: number;
};
