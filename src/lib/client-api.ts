export type ApiIssue = string;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: ApiIssue[];
  readonly retryAfter: number;

  constructor(code: string, message: string, status: number, issues: ApiIssue[] = [], retryAfter = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
    this.retryAfter = retryAfter;
  }
}

type FetchBody = BodyInit | Record<string, unknown> | null;

async function call<T>(method: string, path: string, body?: FetchBody, headers?: Record<string, string>): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body === null || body === undefined ? {} : { body: typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body) }),
  };

  const res = await fetch(path, init);
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const payload = (isJson ? await res.json().catch(() => null) : null) as Record<string, unknown> | null;

  if (!res.ok) {
    const code = String(payload?.error ?? 'SERVER_ERROR');
    const message = String(payload?.message ?? 'Something went wrong.');
    const issues = Array.isArray(payload?.issues) ? (payload.issues as ApiIssue[]) : [];
    const retryAfter = Number(payload?.retry_after ?? 0);
    throw new ApiError(code, message, res.status, issues, retryAfter);
  }
  return (payload ?? {}) as T;
}

export const api = {
  get: <T,>(path: string) => call<T>('GET', path),
  post: <T,>(path: string, body?: FetchBody) => call<T>('POST', path, body ?? {}),
  patch: <T,>(path: string, body: FetchBody) => call<T>('PATCH', path, body),
  put: <T,>(path: string, body: FetchBody) => call<T>('PUT', path, body),
  del: <T,>(path: string, opts: { confirm?: boolean } = {}) =>
    call<T>('DELETE', path, null, opts.confirm ? { 'x-confirm-delete': 'DELETE' } : undefined),
};

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard API needs a secure context and a user gesture; fall back to execCommand.
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
