/**
 * Loader hooks for the security self-test (test-only; nothing in the app imports this).
 *  - `server-only`'s default entry throws outside a React server component, so
 *    resolve it to its empty sibling.
 *  - TypeScript source uses extensionless relative imports, which Node ESM does
 *    not resolve, so retry those specifiers with `.ts`.
 *  - The Next runtime modules a route handler pulls in are replaced with stubs,
 *    which is what lets the pure helpers in `api.ts` be tested at all.
 */
const COOKIES_STUB =
  'export async function cookies(){throw new Error("cookies() is unavailable in the self-test")} ' +
  'export async function headers(){throw new Error("headers() is unavailable in the self-test")}';
const NAV_STUB = 'export function redirect(url){throw new Error("redirect(" + url + ")")}';
const RESPONSE_STUB =
  'export class NextResponse { static json(body, init) { return new Response(JSON.stringify(body), init); } }';

const STUBS = {
  'next/headers': `data:text/javascript,${encodeURIComponent(COOKIES_STUB)}`,
  'next/navigation': `data:text/javascript,${encodeURIComponent(NAV_STUB)}`,
  'next/server': `data:text/javascript,${encodeURIComponent(RESPONSE_STUB)}`,
};

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return { url: STUBS[specifier], shortCircuit: true };
  }
  if (specifier === 'server-only') {
    return { url: new URL('../node_modules/server-only/empty.js', import.meta.url).href, shortCircuit: true };
  }
  // tsconfig maps `@/*` to `src/*`; Node has no idea about that alias.
  if (specifier.startsWith('@/')) {
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    const withExt = ['.ts', '.tsx'].find(ext => existsSync(fileURLToPath(base + ext)));
    return next(withExt ? base + withExt : base, context);
  }
  if (/^(\.\.?)\/[^?]*$/.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      return next(`${specifier}.tsx`, context);
    }
  }
  return next(specifier, context);
}
