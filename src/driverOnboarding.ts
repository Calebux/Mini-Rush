import { driverName, hasUsername, keepDriverName, setUsername, usernameSaved } from './driver';
import { currentGarageBackup, ensureAccount, nearAccount, nearEnabled } from './near';
import { confirmedBackup } from './garageBackupStatus';
import { SIGN_IN_REQUIRED, shopSignedIn } from './shopSession';

/** Device account onboarding. A driver name is local display data, not a login. */
export function installDriverOnboarding(): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'driver-onboarding';
  dialog.setAttribute('aria-labelledby', 'driver-onboarding-title');
  dialog.innerHTML = `<header><small>MINIRUSH / DRIVER REGISTRATION</small><button type="button" data-driver-close aria-label="Close driver setup">✕</button></header>
    <ol class="driver-steps" aria-label="Driver setup progress"><li data-step-name>01 / NAME</li><li data-step-garage>02 / GARAGE</li><li data-step-backup>03 / BACKUP</li></ol>
    <section data-driver-name-step>
      <h2 id="driver-onboarding-title">Make a name<br>on the street.</h2><p>Your driver name appears in races, friend lobbies and on the boards. Make it yours.</p>
      <form data-driver-form><label for="onboarding-name">DRIVER NAME</label><input id="onboarding-name" name="driverName" minlength="3" maxlength="16" autocomplete="nickname" autocapitalize="characters" spellcheck="false" aria-describedby="driver-name-help driver-name-error" required>
        <p id="driver-name-help" class="driver-fine">3–16 characters: letters, numbers, spaces, - or _. Names are saved on this device and are not exclusive usernames.</p>
        <p id="driver-name-error" role="alert"></p><button type="submit" class="driver-primary">SAVE & CONTINUE →</button>
      </form><button type="button" class="driver-secondary" data-driver-keep>Keep my generated name</button>
    </section>
    <section data-driver-garage-step hidden>
      <h2 id="driver-garage-title">You're on the grid.</h2>
      <div class="driver-license"><span class="driver-license-mark" aria-hidden="true">MR</span><div><small>PLAYING AS</small><strong data-driver-preview></strong><span data-driver-device-status role="status"></span></div><button type="button" data-driver-edit>EDIT NAME</button></div>
      <p data-driver-garage-copy></p><button type="button" class="driver-secondary" data-driver-retry hidden>Retry garage setup</button>
      <div class="driver-backup-callout"><small>KEEP YOUR GARAGE</small><h3 data-driver-backup-title>Take your key with you.</h3><p data-driver-backup-copy>Your garage key is saved in this browser. Download a password-encrypted recovery file before clearing browser data or changing devices.</p><button type="button" class="driver-primary" data-driver-backup>DOWNLOAD ENCRYPTED KEY →</button></div>
      <p class="driver-fine">The recovery file restores your cars, parts and on-chain balances. Keep its password separately. Your driver name, local coins and skins stay on this device.</p>
      <button type="button" class="driver-secondary" data-driver-close data-driver-finish>I'll back up later · continue playing</button>
    </section>
    <footer><button type="button" data-driver-restore>Already have a garage? Restore it</button><span>No wallet extension needed.</span></footer>`;
  document.body.append(dialog);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  let identity: { account: string; publicKey: string } | null = null;
  let checking = false, flight: Promise<void> | null = null;
  let opener: HTMLElement | null = null;
  const backupDate = () => identity ? confirmedBackup(identity.account, identity.publicKey) : null;
  const render = () => {
    const ready = !!identity, backedUp = !!backupDate(), named = hasUsername();
    const state = checking ? 'PREPARING YOUR GARAGE' : ready ? 'DEVICE ACCOUNT ACTIVE' : nearAccount() ? 'GARAGE ACCESS NEEDS RESTORING' : 'LOCAL PLAY · GARAGE OFFLINE';
    const copy = checking ? 'You can race while we prepare your garage.' : ready
      ? 'Your garage opens automatically on this device. You can race, craft and trade.'
      : nearAccount() ? 'This browser cannot read your garage key. Restore a recovery file to regain access.'
      : 'Racing is available. Reconnect to create your garage and use the market.';
    document.querySelector('[data-home-driver-name]')!.textContent = driverName();
    if (!SIGN_IN_REQUIRED) {
      document.querySelector('[data-home-session-label]')!.textContent = state;
      document.querySelector('[data-home-session-copy]')!.textContent = copy;
    }
    const badge = document.querySelector<HTMLElement>('[data-home-backup-status]')!;
    badge.textContent = backedUp ? '✓ Recovery file saved · confirmed by you' : 'Recovery file not confirmed';
    badge.dataset.saved = String(backedUp);
    document.querySelector('#menu [data-driver-onboarding]')!.textContent = named && ready && backedUp ? 'Manage driver ↗' : 'Finish driver setup ↗';
    $('[data-driver-preview]').textContent = driverName();
    $('[data-driver-device-status]').textContent = ready ? 'GARAGE READY / DEVICE ACCESS' : state;
    $('[data-driver-garage-copy]').textContent = copy + (SIGN_IN_REQUIRED && !shopSignedIn() ? ' This deployment requires sign-in before shopping.' : '') +
      (named && !usernameSaved() ? ' Your browser could not save your name; it will last only for this session.' : '');
    for (const [selector, done] of [['[data-step-name]', named], ['[data-step-garage]', ready], ['[data-step-backup]', backedUp]] as const) $(selector).dataset.done = String(done);
    $<HTMLButtonElement>('[data-driver-backup]').disabled = !ready || checking;
    $('[data-driver-backup]').textContent = backedUp ? 'DOWNLOAD ANOTHER COPY →' : 'DOWNLOAD ENCRYPTED KEY →';
    $('[data-driver-backup-title]').textContent = backedUp ? 'Your recovery file is saved.' : 'Take your key with you.';
    $('[data-driver-backup-copy]').textContent = backedUp
      ? 'You confirmed saving a recovery file. Keep it and its password safe. MiniRush cannot check your downloads folder or reset that password.'
      : 'Your garage key is saved in this browser. Download a password-encrypted recovery file before clearing browser data or changing devices.';
    $('[data-driver-finish]').textContent = backedUp ? 'READY · CONTINUE PLAYING →' : "I'll back up later · continue playing";
    $('[data-driver-retry]').hidden = ready || checking || !nearEnabled();
  };
  const connect = (): Promise<void> => {
    if (flight) return flight;
    checking = true; render();
    flight = (async () => {
      try {
        await ensureAccount();
        const saved = await currentGarageBackup();
        identity = { account: saved.account, publicKey: saved.publicKey };
      } catch { identity = null; }
      finally { checking = false; flight = null; render(); }
    })();
    return flight;
  };
  const showStep = (name: boolean) => {
    $('[data-driver-name-step]').hidden = !name;
    $('[data-driver-garage-step]').hidden = name;
    dialog.setAttribute('aria-labelledby', name ? 'driver-onboarding-title' : 'driver-garage-title');
    if (name) {
      const input = $<HTMLInputElement>('#onboarding-name');
      input.value = hasUsername() ? driverName() : ''; input.placeholder = driverName();
      $('[data-driver-keep]').textContent = hasUsername() ? 'Keep my current name' : `Keep ${driverName()}`;
      $('#driver-name-error').textContent = ''; input.focus();
    } else $<HTMLButtonElement>('[data-driver-backup]').focus();
  };
  const dismissWelcome = () => {
    if (!document.getElementById('welcome')!.classList.contains('hidden')) document.getElementById('btn-welcome-menu')!.click();
  };
  const open = (trigger?: HTMLElement) => {
    dismissWelcome(); opener = trigger ?? opener;
    render(); if (!dialog.open) dialog.showModal(); showStep(!hasUsername());
  };
  document.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-driver-onboarding]');
    if (target) open(target);
  });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('keyup', event => event.stopPropagation());
  dialog.addEventListener('close', () => { $<HTMLInputElement>('#onboarding-name').value = ''; opener?.focus(); });
  dialog.addEventListener('submit', event => {
    event.preventDefault();
    const error = setUsername($<HTMLInputElement>('#onboarding-name').value);
    if (error) { $('#driver-name-error').textContent = error; return; }
    render(); showStep(false);
  });
  dialog.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target === dialog || target.closest('[data-driver-close]')) dialog.close();
    if (target.closest('[data-driver-keep]')) { if (!hasUsername()) keepDriverName(); render(); showStep(false); }
    if (target.closest('[data-driver-edit]')) showStep(true);
    if (target.closest('[data-driver-retry]')) void connect();
    const backup = target.closest('[data-driver-backup]'), restore = target.closest('[data-driver-restore]');
    if (backup || restore) {
      dialog.close();
      const protection = document.querySelector<HTMLDialogElement>('#garage-protection')!;
      protection.addEventListener('close', () => { if (!document.getElementById('menu')!.classList.contains('hidden')) open(); }, { once: true });
      document.querySelector<HTMLButtonElement>(backup ? '#menu [data-protect-garage]' : '#menu [data-restore-garage]')!.click();
    }
  });
  window.addEventListener('minirush:driver-name', render);
  window.addEventListener('minirush:backup-confirmed', render);
  window.addEventListener('storage', () => { void connect(); });
  window.addEventListener('online', () => { if (!identity) void connect(); });
  window.addEventListener('minirush:garage-updated', () => { if (!identity || nearAccount() !== identity.account) void connect(); });
  void connect();
}
