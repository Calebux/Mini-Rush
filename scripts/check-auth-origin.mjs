// Preflight for hosted sign-in: asks NEAR Auth's login server whether it will
// return players to a given site. Run it before deploying sign-in to a domain,
// and again once the NEAR Auth team says the domain has been added.
//
//   npm run check:auth-origin -- https://minirush.site https://www.minirush.site
//
// It only requests the public authorization page. No credentials, tokens or
// transactions are involved, and nothing is written anywhere.
import { createHash, randomBytes } from 'node:crypto';

const LOGIN = 'https://login.testnet.fast-auth.com';
const AUDIENCE = 'auth0.jwt.fast-auth.testnet';
const clientId = process.env.VITE_NEAR_AUTH_CLIENT_ID?.trim() || 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl';
const origins = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (!origins.length) origins.push('https://minirush.site');

const b64 = bytes => Buffer.from(bytes).toString('base64url');

/** 'accepted' when the server moves on to its login screen, otherwise why it refused. */
async function probe(redirectUri, responseMode) {
  const query = new URLSearchParams({
    client_id: clientId, response_type: 'code', scope: 'openid', audience: AUDIENCE,
    state: b64(randomBytes(16)), nonce: b64(randomBytes(16)),
    code_challenge: b64(createHash('sha256').update(b64(randomBytes(32))).digest()), code_challenge_method: 'S256',
    response_mode: responseMode, redirect_uri: redirectUri
  });
  const res = await fetch(`${LOGIN}/authorize?${query}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? '';
    return to.startsWith('/u/login') || to.startsWith(`${LOGIN}/u/login`) ? 'accepted' : `redirected to ${to.slice(0, 60)}`;
  }
  const body = await res.text();
  return /callback url mismatch/i.test(body) ? 'rejected: Callback URL mismatch' : `rejected: HTTP ${res.status}`;
}

let ready = true;
for (const given of origins) {
  let origin;
  try { origin = new URL(given).origin; } catch { console.error(`Not a URL: ${given}`); process.exitCode = 2; continue; }
  // The popup returns to the bare origin; full-page sign-in returns to the home path.
  const results = [];
  for (const [label, uri, mode] of [['popup', origin, 'web_message'], ['full page', `${origin}/`, 'query']]) {
    const result = await probe(uri, mode).catch(error => `could not reach the login server (${error.name})`);
    results.push(`${label}: ${result}`);
    if (result !== 'accepted') ready = false;
  }
  console.log(`${origin}\n  ${results.join('\n  ')}`);
}
console.log(ready
  ? 'READY: sign-in can return to every origin checked.'
  : `NOT READY: ask the NEAR Auth team to allow the rejected origins for client ${clientId} before deploying sign-in there.`);
if (!ready && !process.exitCode) process.exitCode = 1;
