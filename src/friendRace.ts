import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { driverName } from './driver';
import { FRIEND_LENGTH, type FriendRoom } from '../shared/friendRace';
import './friendRace.css';

const ref = (name: string) => makeFunctionReference<'mutation'>(`friends:${name}`);
const view = makeFunctionReference<'query', { code: string; token: string }, FriendRoom & { slot: number }>('friends:view');
const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
type Hooks = { prepare: (room: FriendRoom, slot: number) => Promise<void>; update: (room: FriendRoom, slot: number) => void; exit: () => void };

/** A tab owns one private seat. Invite links contain only the public room code. */
export class FriendRace {
  room: FriendRoom | null = null;
  slot = 0;
  private client: ConvexClient | null = null;
  private token = '';
  private code = '';
  private unsubscribe: (() => void) | null = null;
  private timer = 0;
  private prepared = 0;
  private offset = 0;
  private bestRtt = Infinity;
  private seq = 0;
  private sending = false;
  private sentAt = 0;
  private busy = false;
  private pinging = false;
  private acting = false;
  private generation = 0;
  private previousFocus: HTMLElement | null = null;
  private panel = document.createElement('dialog');
  private bar = document.createElement('div');
  private message: HTMLElement;

  constructor(private hooks: Hooks) {
    this.panel.id = 'friends-dialog';
    this.panel.setAttribute('aria-labelledby', 'friends-title');
    this.panel.innerHTML = `<div class="friends-card"><header><span class="friends-eyebrow">PRIVATE GRID · 2 DRIVERS</span><button type="button" data-friend="leave" aria-label="Leave Race Friends">×</button></header>
      <h2 id="friends-title">Race friends.</h2><p class="friends-intro">Same road. Same car. Settle it on the streets of Lagos.</p>
      <div class="friends-spec"><span>LAGOS CIRCUIT <b>1.8 KM</b></span><span>VIPER GT <b>STOCK</b></span><span>RACE TYPE <b>FRIENDLY</b></span></div>
      <p class="friends-rules">Two live drivers. No traffic or bots. Non-contact racing. No entry fee or rewards.</p>
      <div data-friend-setup><button type="button" data-friend="create" class="friends-primary">CREATE A RACE ↗</button>
        <form><label for="friends-code">Have an invite?</label><div class="friends-join"><input id="friends-code" maxlength="8" pattern="[a-fA-F0-9]{8}" placeholder="8-character code" autocomplete="off" required aria-label="Room code"><button type="submit">JOIN RACE</button></div></form></div>
      <div data-friend-room hidden><div class="friends-invite"><span>ROOM <strong data-friend-code></strong></span><button type="button" data-friend="copy">COPY INVITE</button></div>
        <ol data-friend-drivers></ol><button type="button" data-friend="ready" class="friends-primary">I’M READY</button></div>
      <p data-friend-message role="status" aria-live="polite"></p><footer>Steer: ← → / A D · Brake: ↓ / S · Boost: Space<br>On mobile, use the race controls. Keep this tab open during the race.</footer></div>`;
    this.bar.id = 'friends-bar'; this.bar.hidden = true;
    this.bar.innerHTML = '<span></span><button type="button">LEAVE RACE</button>';
    document.body.append(this.panel, this.bar);
    this.message = this.panel.querySelector('[data-friend-message]')!;
    this.panel.addEventListener('cancel', e => { e.preventDefault(); void this.leave(); });
    this.panel.addEventListener('click', e => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-friend]')?.dataset.friend;
      if (action === 'leave') void this.leave();
      if (action === 'create') void this.enter(true);
      if (action === 'ready') void this.action('ready');
      if (action === 'copy') void navigator.clipboard.writeText(`${location.origin}/?race=${this.code}`).then(() => this.say('Invite copied. Send it to your friend.'), () => this.say(`Share this code: ${this.code}`));
    });
    this.panel.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); void this.enter(false); });
    this.bar.querySelector('button')!.onclick = () => { void this.leave(); };
    document.getElementById('btn-friends')?.addEventListener('click', () => this.open());
    // Modal controls must not steer/fire the car behind the card.
    for (const kind of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) this.panel.addEventListener(kind, e => e.stopPropagation());
    const invite = new URLSearchParams(location.search).get('race');
    if (invite && /^[a-f0-9]{8}$/i.test(invite)) {
      (this.panel.querySelector('input') as HTMLInputElement).value = invite.toUpperCase();
      this.open();
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem('minirush.friend-seat') ?? 'null');
      if (saved && /^[A-F0-9]{8}$/.test(saved.code) && /^[a-f0-9]{64}$/.test(saved.token) && (!invite || saved.code === invite.toUpperCase())) {
        this.open(); void this.enter(false, saved);
      }
    } catch { /* A blocked session store only disables refresh recovery. */ }
  }
  get now(): number { return Date.now() + this.offset; }
  private say(message: string) { this.message.textContent = message; }
  private open() {
    this.previousFocus = document.activeElement as HTMLElement;
    if (!this.panel.open) this.panel.showModal();
  }
  private error(e: unknown) {
    const data = (e as { data?: unknown })?.data;
    this.say(typeof data === 'string' ? data : 'Connection interrupted. Check your internet, then try again.');
  }
  private async enter(create: boolean, resume?: { code: string; token: string }) {
    if (this.busy || this.room) return;
    const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
    if (!url) { this.say('Multiplayer is unavailable on this build.'); return; }
    const code = resume?.code ?? (create ? hex(4).toUpperCase() : (this.panel.querySelector('input') as HTMLInputElement).value.trim().toUpperCase());
    if (!/^[A-F0-9]{8}$/.test(code)) { this.say('Enter the eight-character code from your friend.'); return; }
    this.busy = true; this.say('Connecting to the paddock…');
    const generation = ++this.generation;
    try {
      this.client ??= new ConvexClient(url);
      this.token = resume?.token ?? hex(32); this.code = code;
      let timer = 0;
      const { slot } = await Promise.race([
        this.client.mutation(ref(create ? 'create' : 'join'), { code, token: this.token, name: driverName() }),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('timeout')), 15000); })
      ]).finally(() => window.clearTimeout(timer));
      if (generation !== this.generation) return;
      this.slot = slot;
      try { sessionStorage.setItem('minirush.friend-seat', JSON.stringify({ code, token: this.token })); } catch { /* Optional. */ }
      this.unsubscribe = this.client.onUpdate(view, { code, token: this.token }, r => {
        this.room = r; this.slot = r.slot;
        this.hooks.update(r, this.slot);
        this.draw();
        if ((r.state === 'loading' || r.state === 'race') && !r.players[this.slot].dnf && r.players[this.slot].finishAt === null && this.prepared !== r.round) {
          this.prepared = r.round; this.seq = r.players[this.slot].seq + 1;
          void this.prepare(r, generation);
        }
      }, e => this.error(e));
      this.timer = window.setInterval(() => { void this.action('ping'); this.draw(); }, 3000);
    } catch (e) {
      if (generation !== this.generation) return;
      this.error(e);
      try { sessionStorage.removeItem('minirush.friend-seat'); } catch { /* Optional. */ }
      void this.client?.close(); this.client = null;
    }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async prepare(r: FriendRoom, generation: number) {
    try {
      await this.hooks.prepare(r, this.slot);
      if (generation !== this.generation) return;
      await this.action('loaded');
    } catch (e) { this.error(e); await this.leave(); }
  }
  async action(action: 'ready' | 'loaded' | 'ping') {
    if (!this.client || !this.room || this.room.state === 'closed') return;
    if (action === 'ping' && this.pinging) return;
    if (action === 'ready' && this.acting) return;
    if (action === 'ping') this.pinging = true;
    if (action === 'ready') this.acting = true;
    const sent = Date.now(), generation = this.generation;
    try {
      const { now } = await this.client.mutation(ref('command'), { code: this.code, token: this.token, round: this.room.round, action });
      if (generation !== this.generation) return;
      const rtt = Date.now() - sent;
      if (rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = now - (sent + rtt / 2); }
    } catch (e) { if (generation === this.generation) this.error(e); }
    finally { if (generation === this.generation) { if (action === 'ping') this.pinging = false; if (action === 'ready') this.acting = false; } }
  }
  sample(s: number, x: number, v: number) {
    if (!this.client || !this.room || this.sending || performance.now() - this.sentAt < 200 || this.room.state !== 'race') return;
    const p = this.room.players[this.slot];
    if (p.dnf || p.finishAt !== null) return;
    this.sentAt = performance.now(); this.sending = true;
    const generation = this.generation;
    void this.client.mutation(ref('sample'), { code: this.code, token: this.token, round: this.room.round, seq: this.seq++, s: Math.min(FRIEND_LENGTH, Math.max(0, s)), x, v })
      .catch(e => { if (generation === this.generation) this.error(e); }).finally(() => { if (generation === this.generation) this.sending = false; });
  }
  private draw() {
    let r = this.room;
    if (!r) return;
    const expired = this.now >= r.expiresAt;
    if (expired && r.state !== 'closed') { r = this.room = { ...r, state: 'closed' }; this.hooks.update(r, this.slot); }
    const me = r.players[this.slot], opponent = r.players[1 - this.slot];
    this.panel.querySelector('h2')!.textContent = r.state === 'finished' ? 'Race complete.' : me.finishAt !== null ? 'Across the line.' : 'Race friends.';
    const racing = r.state === 'race' && me.finishAt === null && !me.dnf;
    this.bar.hidden = !racing;
    this.bar.querySelector('span')!.textContent = !navigator.onLine || this.now - me.seen > 6000 ? 'RECONNECTING · THE RACE CLOCK KEEPS RUNNING'
      : opponent?.dnf ? 'OPPONENT DISCONNECTED · FINISH YOUR LAP'
      : opponent && this.now - opponent.seen > 6000 ? 'OPPONENT RECONNECTING…'
      : `LIVE · ${opponent?.name ?? 'Waiting for driver'} · ROUND ${r.round}`;
    if (racing) { this.panel.close(); return; }
    if (!this.panel.open) this.panel.showModal();
    (this.panel.querySelector('[data-friend-setup]') as HTMLElement).hidden = true;
    (this.panel.querySelector('[data-friend-room]') as HTMLElement).hidden = false;
    this.panel.querySelector('[data-friend-code]')!.textContent = r.code;
    const list = this.panel.querySelector('ol')!;
    list.replaceChildren();
    const sorted = r.players.map((p, slot) => ({ ...p, slot })).sort((a, b) => (a.finishAt ?? Infinity) - (b.finishAt ?? Infinity));
    sorted.forEach((p, i) => {
      const li = document.createElement('li'), name = document.createElement('strong'), status = document.createElement('span');
      name.textContent = `${p.slot === this.slot ? 'YOU · ' : ''}${p.name}`;
      status.textContent = p.finishAt !== null ? `P${i + 1} · ${((p.finishAt - r.startAt) / 1000).toFixed(2)}s`
        : p.dnf ? 'DID NOT FINISH' : r.state === 'loading' ? (p.loaded ? 'ON THE GRID' : 'LOADING…')
        : r.state === 'race' ? `${Math.round(p.s / FRIEND_LENGTH * 100)}% · RACING` : p.ready ? 'READY' : 'NOT READY';
      li.append(name, status); list.append(li);
    });
    if (r.players.length === 1) { const li = document.createElement('li'); li.textContent = '02 / Waiting for your friend…'; list.append(li); }
    const ready = this.panel.querySelector<HTMLButtonElement>('[data-friend="ready"]')!;
    ready.hidden = r.state !== 'lobby' && r.state !== 'finished';
    ready.disabled = r.players.length !== 2;
    ready.textContent = me.ready ? 'READY · CANCEL' : r.state === 'finished' ? 'REMATCH ↗' : 'I’M READY';
    this.say(expired ? 'This invite has expired. Close this card to create a new race.' : r.state === 'closed' ? 'A driver left. Close this card to create a new room.' : r.state === 'loading' ? 'Both drivers ready. Preparing the grid…'
      : r.state === 'finished' ? 'Race complete. Both drivers must choose rematch to go again.'
      : me.dnf ? 'Connection lost or race time limit reached.' : me.finishAt !== null ? 'You’re home. Waiting for the other driver…'
      : r.players.length < 2 ? 'Send your invite. Your friend can race as a guest.' : 'Both drivers are here. Ready when you are.');
  }
  private async leave() {
    const client = this.client, room = this.room;
    const code = this.code, token = this.token;
    ++this.generation; window.clearInterval(this.timer); this.unsubscribe?.(); this.unsubscribe = null;
    this.room = null; this.prepared = 0; this.busy = false; this.bestRtt = Infinity; this.offset = 0;
    this.pinging = this.acting = this.sending = false;
    this.client = null; this.panel.close(); this.bar.hidden = true;
    try { sessionStorage.removeItem('minirush.friend-seat'); } catch { /* Optional. */ }
    (this.panel.querySelector('[data-friend-setup]') as HTMLElement).hidden = false;
    (this.panel.querySelector('[data-friend-room]') as HTMLElement).hidden = true;
    this.panel.querySelector('h2')!.textContent = 'Race friends.';
    this.say(''); this.hooks.exit(); this.previousFocus?.focus();
    if (client) {
      if (room) await Promise.race([client.mutation(ref('command'), { code, token, round: room.round, action: 'leave' }).catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
      await client.close();
    }
  }
}
