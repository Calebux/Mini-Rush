import { GARAGE, nearAccount, currentGarageBackup, verifyRecoveryAccess, restoreSavedGarage, waitForGarageCreation } from './near';
import { BACKUP_LIMIT, encryptGarageBackup, decryptGarageBackup, type GarageBackup } from '../shared/garageBackup';
import { credentialSnapshot } from '../shared/garageCredentials';
import { confirmBackup } from './garageBackupStatus';

/** Secrets stay in this closure until download/check finishes or the dialog closes. */
export function installGarageProtection(): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'garage-protection';
  dialog.setAttribute('aria-labelledby', 'garage-protection-title');
  document.body.append(dialog);
  let mode: 'protect' | 'restore' = 'protect', busy = false, generation = 0;
  let imported: GarageBackup | null = null, expected = '', checkedAt = 0, downloadUrl: string | null = null;
  let opener: HTMLElement | null = null;
  let prepared: { account: string; publicKey: string } | null = null;
  let downloadRequested = false;
  const clear = () => {
    generation++; imported = null; expected = ''; checkedAt = 0;
    prepared = null; downloadRequested = false;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    dialog.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.value = ''; input.checked = false; });
  };
  const status = (message: string, error = false) => {
    const el = dialog.querySelector<HTMLElement>('[data-protection-status]')!;
    el.textContent = message; el.dataset.error = String(error);
  };
  const working = (on: boolean) => {
    busy = on; dialog.setAttribute('aria-busy', String(on));
    dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach(el => { el.disabled = on; });
  };
  const render = () => {
    const protect = mode === 'protect';
    dialog.innerHTML = `<header><div><small>YOUR GARAGE / YOUR PROGRESS</small><h2 id="garage-protection-title">${protect ? 'Protect your garage' : 'Restore garage'}</h2></div><button type="button" data-protection-close aria-label="Close garage protection">✕</button></header>
      <p class="gp-intro">${protect ? 'Keep your cars and parts within reach. Save an encrypted recovery file and a password you will remember.' : 'Bring your garage to this browser with the recovery file and password you saved earlier.'}</p>
      <div class="gp-account"><small>${protect ? 'GARAGE TO PROTECT' : 'CURRENT GARAGE'}</small><code data-protection-account></code></div>
      <form data-protection-form>
        ${protect ? '' : '<label for="garage-recovery-file">Recovery file</label><input id="garage-recovery-file" name="recoveryFile" type="file" accept=".json,application/json" required>'}
        <label for="garage-backup-password">${protect ? 'Choose a recovery password' : 'Recovery password'}</label>
        <input id="garage-backup-password" type="password" name="recoveryPassword" autocomplete="${protect ? 'new-password' : 'current-password'}" ${protect ? 'minlength="12"' : ''} maxlength="256" required aria-describedby="garage-password-help">
        <p class="gp-help" id="garage-password-help">${protect ? 'Use 12 or more characters. A unique, long passphrase is best. Keep it separate from the file.' : 'The password is the one you chose when you made this file. MiniRush cannot reset it.'}</p>
        ${protect ? '<label for="garage-backup-confirm">Confirm password</label><input id="garage-backup-confirm" type="password" name="confirmPassword" autocomplete="new-password" minlength="12" maxlength="256" required>' : ''}
        <button type="submit" class="gp-primary">${protect ? 'CREATE RECOVERY FILE' : 'CHECK RECOVERY FILE'}</button>
      </form>
      <div data-protection-download hidden><a class="gp-primary" data-backup-download>DOWNLOAD RECOVERY FILE ↓</a><p class="gp-help">Keep this file somewhere safe. Anyone with the file and password can control your garage. Saving another copy does not change your key.</p><button type="button" class="gp-primary" data-backup-saved hidden>I SAVED MY FILE · DONE ✓</button><p class="gp-help">After downloading, check your downloads folder before confirming. We cannot check that the file was saved.</p></div>
      <section data-protection-preview hidden><small>OWNERSHIP CHECKED / NEAR TESTNET</small><h3>Ready to restore</h3><code data-restore-account></code><p data-restore-date></p>
        <p class="gp-help">Restoring reloads MiniRush in your open tabs. Finish any races first.</p>
        <label class="gp-ack"><input type="checkbox" data-restore-ack><span>I have saved a recovery file for my current garage, or I understand that switching without one can lose access to it.</span></label>
        <button type="button" class="gp-primary" data-restore-confirm>RESTORE & RELOAD</button>
      </section>
      <p data-protection-status role="status" aria-live="polite"></p>
      <details><summary>What this protects</summary><p>This file restores your NEAR testnet account and its on-chain cars, parts and balances. Local coins, cosmetics and race records stay on this device and are not in the file.</p><p>It must be created before access is lost. It does not recover a forgotten password or a removed account key. Your active game key still lives in this browser; backup encryption does not protect it from malicious scripts.</p></details>
      <button type="button" class="gp-switch" data-protection-switch>${protect ? 'Already have a file? Restore garage' : 'Protect this garage instead'}</button>`;
    dialog.querySelector('[data-protection-account]')!.textContent = nearAccount() ?? 'No saved garage on this browser';
  };
  const open = (next: typeof mode, trigger: HTMLElement) => {
    if (busy) return;
    if (!document.getElementById('welcome')?.classList.contains('hidden')) document.getElementById('btn-welcome-menu')?.click();
    clear(); mode = next; opener = trigger;
    // Activity is another native modal; return to the home screen for switching.
    const activity = document.querySelector<HTMLDialogElement>('#garage-activity');
    if (activity?.open) activity.close();
    render(); if (!dialog.open) dialog.showModal();
  };
  document.addEventListener('click', e => {
    const trigger = (e.target as HTMLElement).closest<HTMLElement>('[data-protect-garage],[data-restore-garage]');
    if (trigger) open(trigger.hasAttribute('data-restore-garage') ? 'restore' : 'protect', trigger);
  });
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('keyup', e => e.stopPropagation());
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', () => { clear(); dialog.innerHTML = ''; opener?.focus(); });
  dialog.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    if (busy) return;
    if (target.closest('[data-protection-close]') || target === dialog) { dialog.close(); return; }
    if (target.closest('[data-protection-switch]')) { clear(); mode = mode === 'protect' ? 'restore' : 'protect'; render(); return; }
    if (target.closest('[data-backup-download]')) {
      downloadRequested = true;
      dialog.querySelector<HTMLElement>('[data-backup-saved]')!.hidden = false;
      status('Download requested. Check that the file saved, and keep the password separately.');
    }
    if (target.closest('[data-backup-saved]') && downloadRequested && prepared) {
      if (credentialSnapshot(localStorage) !== expected) { status('Your garage changed. Create a new recovery file for the current garage.', true); return; }
      if (!confirmBackup(prepared.account, prepared.publicKey)) { status('Your file still works, but this browser could not save the confirmation. Keep the file safe.', true); return; }
      dialog.close();
    }
    if (target.closest('[data-restore-confirm]') && imported) {
      const ack = dialog.querySelector<HTMLInputElement>('[data-restore-ack]')!;
      if (!ack.checked) { status('Save your current garage first, then acknowledge the switch.', true); ack.focus(); return; }
      if (Date.now() - checkedAt > 5 * 60_000) { clear(); render(); status('The ownership check expired. Check the file again.', true); return; }
      working(true); status('Checking ownership again before switching…');
      try {
        await restoreSavedGarage(imported, expected);
        clear(); location.reload();
      } catch (error) { status(error instanceof Error ? error.message : 'Restore did not complete. Your current garage is unchanged.', true); }
      finally { working(false); }
    }
  });
  dialog.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const passwordInput = dialog.querySelector<HTMLInputElement>('#garage-backup-password')!;
    let password = passwordInput.value;
    if (mode === 'protect' && password !== dialog.querySelector<HTMLInputElement>('#garage-backup-confirm')!.value) {
      status('The passwords do not match. Enter the same password twice.', true); return;
    }
    const selected = dialog.querySelector<HTMLInputElement>('#garage-recovery-file')?.files?.[0];
    if (mode === 'restore' && (!selected || selected.size > BACKUP_LIMIT)) { status('Choose a MiniRush recovery file smaller than 16 KB.', true); return; }
    working(true); status(mode === 'protect' ? 'Checking your garage and encrypting the recovery file…' : 'Decrypting locally and checking account ownership…');
    const attempt = generation;
    try {
      await waitForGarageCreation();
      expected = credentialSnapshot(localStorage);
      if (mode === 'protect') {
        const payload = await currentGarageBackup();
        await verifyRecoveryAccess(payload);
        const file = await encryptGarageBackup(payload, password);
        if (credentialSnapshot(localStorage) !== expected) throw new Error('Your garage changed. Open Protect your garage again.');
        if (attempt !== generation) return;
        prepared = { account: payload.account, publicKey: payload.publicKey };
        downloadUrl = URL.createObjectURL(new Blob([file], {type:'application/json'}));
        const link = dialog.querySelector<HTMLAnchorElement>('[data-backup-download]')!;
        link.href = downloadUrl; link.download = `minirush-${payload.account}-recovery.json`;
        dialog.querySelector<HTMLElement>('[data-protection-download]')!.hidden = false;
        status('Recovery file ready. Download it before closing this window.'); link.focus();
      } else {
        const payload = await decryptGarageBackup(await selected!.text(), password, GARAGE);
        await verifyRecoveryAccess(payload);
        if (credentialSnapshot(localStorage) !== expected) throw new Error('Your garage changed. Check the recovery file again.');
        if (attempt !== generation) return;
        imported = payload; checkedAt = Date.now();
        dialog.querySelector('[data-restore-account]')!.textContent = payload.account;
        dialog.querySelector('[data-restore-date]')!.textContent = `Recovery file created ${new Date(payload.createdAt).toLocaleDateString()}.`;
        dialog.querySelector<HTMLElement>('[data-protection-preview]')!.hidden = false;
        status('The key still controls this account. Review the address before restoring.');
      }
      dialog.querySelector<HTMLElement>('[data-protection-form]')!.hidden = true;
    } catch (error) {
      if (attempt === generation) status(error instanceof Error ? error.message : 'Could not complete this check. Your garage is unchanged.', true);
    } finally {
      password = ''; passwordInput.value = '';
      const confirm = dialog.querySelector<HTMLInputElement>('#garage-backup-confirm'); if (confirm) confirm.value = '';
      if (attempt === generation) working(false);
    }
  });
}
