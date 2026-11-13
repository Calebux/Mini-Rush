import './socialSignIn.css';
import type { SavedOwnershipProof } from './ownershipProof';
import { shopSignedIn } from './shopSession';

/** Home-screen account entry; guest play stays open and purchases require login. */
export function installSocialSignIn(): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'social-sign-in';
  dialog.setAttribute('aria-labelledby', 'social-sign-in-title');
  dialog.innerHTML = `<header><small>MINIRUSH · DRIVER ACCOUNT</small><button type="button" data-auth-close aria-label="Close sign-in">✕</button></header>
    <h2 id="social-sign-in-title">Your driver account</h2>
    <p data-auth-intro>Sign in to shop for cars, paint and parts. Choose Google on the secure sign-in screen.</p>
    <p class="auth-scope">Racing is always open to guests. Your garage stays in this browser; recovery on another device is not available yet.</p>
    <div class="auth-status" role="status" aria-live="polite" data-auth-status>Loading sign-in…</div>
    <button type="button" class="auth-primary" data-auth-login disabled>Continue with Google</button>
    <button type="button" class="auth-secondary" data-auth-redirect hidden>Use full-page sign-in</button>
    <button type="button" class="auth-secondary" data-auth-logout hidden>Sign out</button>
    <button type="button" class="auth-secondary" data-auth-retry hidden>Check sign-in again</button>
    <section class="auth-proof" data-auth-proof-section hidden aria-label="Garage ownership">
      <h3>Verify your garage</h3><p>Confirm that this identity and your current garage belong to you. This records an ownership link; account recovery is still a separate step.</p>
      <p data-auth-proof-status role="status" aria-live="polite"></p>
      <button type="button" class="auth-secondary" data-auth-proof disabled>Verify garage ownership</button>
    </section>
    <details data-auth-details hidden><summary>Sign-in details</summary><p>NEAR testnet identity key</p><code data-auth-key></code><p>This is a public identity key. It does not mean your garage has been linked or backed up.</p></details>
    <footer><button type="button" data-auth-close>Keep playing</button><span>Signing in never buys an item.</span></footer>`;
  document.body.append(dialog);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const status = $('[data-auth-status]');
  const login = $<HTMLButtonElement>('[data-auth-login]');
  const redirect = $<HTMLButtonElement>('[data-auth-redirect]');
  const logout = $<HTMLButtonElement>('[data-auth-logout]');
  const retry = $<HTMLButtonElement>('[data-auth-retry]');
  const proofButton = $<HTMLButtonElement>('[data-auth-proof]');
  let proofModule: typeof import('./ownershipProof') | undefined;
  let proof: SavedOwnershipProof | null = null;
  let identityKey: string | null = null;
  let module: typeof import('./nearAuth') | undefined;
  let auth: Awaited<ReturnType<typeof import('./nearAuth')['loadNearAuth']>> | undefined;
  let busy = false;
  let restoringProof = false;
  let proofRevision = 0;
  const renderHomeSession = () => {
    const member = shopSignedIn();
    document.querySelector('[data-home-session-label]')!.textContent = member ? 'SIGNED IN' : 'GUEST DRIVER';
    document.querySelector('[data-home-session-copy]')!.textContent = member ? 'Ready to race. Ready to shop.' : 'Race and earn. Sign in to shop.';
    document.getElementById('home-sign-in')!.textContent = member ? 'ACCOUNT ↗' : 'SIGN IN ↗';
  };
  window.addEventListener('minirush:session', renderHomeSession);
  document.getElementById('home-sign-in')!.hidden = false;
  renderHomeSession();

  const setBusy = (value: boolean) => {
    busy = value;
    for (const button of [login, redirect, logout, retry, proofButton]) button.disabled = value;
    if (!auth) login.disabled = redirect.disabled = true;
    if (!proofModule || !identityKey || restoringProof) proofButton.disabled = true;
  };
  const renderProof = () => {
    $('[data-auth-proof-section]').hidden = !identityKey;
    const state = proof?.result.state;
    const expired = proof && proof.challenge.expiresAt <= Date.now();
    $('[data-auth-proof-status]').textContent = proof?.result.message ?? 'Your existing garage access will stay on this device.';
    proofButton.hidden = state === 'verified';
    proofButton.textContent = state === 'pending' ? 'Check ownership progress' : state === 'needs_approval' && !expired ? 'Approve ownership check' : 'Verify garage ownership';
  };
  const restoreProof = async (key: string) => {
    const revision = ++proofRevision;
    restoringProof = true; setBusy(busy);
    try {
      proofModule ??= await import('./ownershipProof');
      if (identityKey !== key || revision !== proofRevision) return;
      proof = proofModule.savedOwnershipProof(key);
      // A local success flag cannot establish ownership. Recheck the server record.
      if (proof && (proof.result.state === 'verified' || proof.result.state === 'pending')) {
        const saved = proof;
        proof = { ...saved, result: { state: 'pending', message: 'Checking your previous ownership request…' } };
        renderProof();
        const checked = await proofModule.submitOwnershipProof(saved);
        if (identityKey !== key || revision !== proofRevision) return;
        proof = checked;
      }
      renderProof(); setBusy(busy);
    } catch { if (identityKey === key && revision === proofRevision) $('[data-auth-proof-status]').textContent = 'Ownership verification is unavailable right now.'; }
    finally { if (revision === proofRevision) { restoringProof = false; setBusy(busy); } }
  };
  const showIdentity = (identity: import('./nearAuth').AuthIdentity | null) => {
    ++proofRevision; restoringProof = false;
    identityKey = identity?.publicKey ?? null; proof = null; renderProof();
    if (identityKey) void restoreProof(identityKey);
    login.hidden = !!identity;
    logout.hidden = !identity;
    redirect.hidden = true;
    retry.hidden = true;
    $('[data-auth-details]').hidden = !identity;
    $('[data-auth-key]').textContent = identity?.publicKey ?? '';
    status.textContent = identity ? `${identity.google ? 'Google sign-in' : 'Sign-in'} verified. You can shop now. Garage recovery is not linked yet.` : 'Ready when you are. Guest play is still available.';
  };
  const reportError = (error: unknown) => {
    const code = error && typeof error === 'object' && 'error' in error ? String(error.error) : error instanceof Error ? error.message : '';
    status.textContent = /cancel|closed|access_denied/i.test(code)
      ? 'Sign-in was cancelled. Your garage is unchanged.'
      : 'We couldn’t complete sign-in. Try again or use full-page sign-in. Your garage is unchanged.';
    // Do not render raw SDK errors: they can contain callback parameters or tokens.
    redirect.hidden = !auth;
    retry.hidden = false;
  };
  const prepare = async (callback = false) => {
    if (busy) return;
    setBusy(true);
    try {
      module ??= await import('./nearAuth');
      if (callback) showIdentity(await module.finishAuthCallback());
      auth = await module.loadNearAuth();
      if (!callback) showIdentity(await module.authIdentity());
    } catch (error) { reportError(error); }
    finally { setBusy(false); }
  };
  const open = () => {
    if (!dialog.open) dialog.showModal();
    void prepare();
  };
  document.addEventListener('click', event => {
    if (!(event.target as HTMLElement).closest('[data-social-sign-in]')) return;
    open();
  });
  window.addEventListener('minirush:sign-in', () => {
    $('[data-auth-intro]').textContent = 'Sign in to buy this item, then return and confirm your purchase. You can keep racing as a guest.';
    open();
  });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target === dialog || (event.target as HTMLElement).closest('[data-auth-close]')) dialog.close();
  });
  login.addEventListener('click', async () => {
    if (busy || !auth || !module) return;
    setBusy(true); status.textContent = 'Finish signing in on the secure screen…';
    try {
      await module.loginWithPopup(auth);
      const identity = await module.authIdentity();
      if (!identity) throw new Error('login_incomplete');
      showIdentity(identity);
    } catch (error) { reportError(error); }
    finally { setBusy(false); }
  });
  redirect.addEventListener('click', async () => {
    if (busy || !auth || !module) return;
    setBusy(true); status.textContent = 'Opening secure sign-in…';
    try { await module.loginWithRedirect(auth); }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  });
  logout.addEventListener('click', async () => {
    if (busy || !module) return;
    setBusy(true);
    try { await module.logoutAuth(); showIdentity(null); status.textContent = 'Signed out of the preview. Your guest garage remains on this device.'; }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  });
  retry.addEventListener('click', () => { void prepare(); });
  proofButton.addEventListener('click', async () => {
    if (busy || restoringProof || !auth || !module || !identityKey || !proofModule) return;
    setBusy(true);
    try {
      if (proof?.result.state === 'pending') proof = await proofModule.submitOwnershipProof(proof);
      else if (proof?.result.state === 'needs_approval' && proof.challenge.expiresAt > Date.now()) {
        $('[data-auth-proof-status]').textContent = 'Approve the ownership message on the secure screen…';
        const token = await module.requestIdentitySignature(auth, proof.challenge);
        proof = await proofModule.submitOwnershipProof(proof, token);
      } else proof = await proofModule.prepareOwnershipProof(identityKey);
      renderProof();
    } catch {
      $('[data-auth-proof-status]').textContent = 'Ownership check did not complete. The service may need enabling, or approval was cancelled. Your garage is unchanged.';
    } finally { setBusy(false); }
  });
  try {
    const query = new URLSearchParams(location.search);
    if (sessionStorage.getItem('minirush.auth.callback.v1') && ((query.has('code') && query.has('state')) || query.has('error'))) {
      dialog.showModal(); void prepare(true);
    }
  } catch { /* Storage unavailable: the popup flow remains usable. */ }
  // Restore the provider session without interrupting guest play or opening a popup.
  if (!dialog.open) void import('./nearAuth').then(m => m.restoreLoginSession()).catch(() => {});
  window.addEventListener('focus', () => { if (!busy) void import('./nearAuth').then(m => m.loginToken()).catch(() => {}); });
}
