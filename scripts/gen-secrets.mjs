import { randomBytes } from 'node:crypto';

/** Prints the exact values to paste into .env.local — nothing is written to disk. */
const lines = [
  ['WEBVAULT_ENC_KEY', randomBytes(32).toString('base64'), 'AES-256 key for the credentials vault (base64, 32 bytes)'],
  ['WEBVAULT_SESSION_SECRET', randomBytes(32).toString('hex'), 'HMAC key for the vault-unlock cookie (hex, 64 chars)'],
  ['WEBVAULT_SETUP_KEY', randomBytes(18).toString('hex'), 'One-time gate for the first-run setup page (set only until the admin exists)'],
];

console.log('# WebVault secrets — copy each line into .env.local, then delete this output.');
console.log('# Regenerating WEBVAULT_ENC_KEY after credentials exist makes them unreadable.\n');
for (const [name, value, comment] of lines) console.log(`${comment}\n${name}=${value}\n`);
