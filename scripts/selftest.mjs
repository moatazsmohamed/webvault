/** Entry point for `npm run selftest`: installs the loader hook, then runs the tests. */
import { register } from 'node:module';

register(new URL('./selftest-hooks.mjs', import.meta.url).href, import.meta.url);
await import('./security-selftest.mts');
