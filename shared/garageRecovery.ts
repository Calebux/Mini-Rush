export interface ActionResult { state: 'pending' | 'confirmed' | 'failed'; tx?: string; value?: unknown; message?: string }
export interface SavedAction {
  id: string; scope: string; method: string; args: Record<string, unknown>; signedDelegate: string;
  createdAt: number; result: ActionResult;
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const ACTIONS_KEY = 'minirush.garage-actions.v1';
/** The journal is written before sending. Unknown results remain pending, never "failed". */
export class ActionJournal {
  private storage: StorageLike;
  constructor(storage: StorageLike) { this.storage = storage; }
  list(scope: string): SavedAction[] {
    return this.all().filter(a => a.scope === scope);
  }
  private all(): SavedAction[] {
    const raw = this.storage.getItem(ACTIONS_KEY);
    if (!raw) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items) || items.some(a => !a || typeof a.id !== 'string' || typeof a.scope !== 'string' || typeof a.signedDelegate !== 'string' || !['pending','confirmed','failed'].includes(a.result?.state))) {
      throw new Error('Saved purchase history could not be read. Keep this browser data and contact support.');
    }
    return items;
  }
  pending(scope: string): SavedAction | undefined { return this.list(scope).find(a => a.result.state === 'pending'); }
  save(action: SavedAction): void {
    const all = this.all().filter(a => a.id !== action.id);
    all.push(action);
    const keep = [...all.filter(a => a.result.state === 'pending'), ...all.filter(a => a.result.state !== 'pending').slice(-30)];
    this.storage.setItem(ACTIONS_KEY, JSON.stringify(keep));
  }
  begin(action: SavedAction): void {
    if (this.pending(action.scope)) throw new Error('Your previous action is still completing. Check Activity for its progress.');
    this.save(action);
  }
  settle(action: SavedAction, result: ActionResult): SavedAction {
    const latest = this.all().find(a => a.id === action.id);
    if (!latest) throw new Error('Saved action is missing.');
    if (latest.result.state !== 'pending') return latest; // Delayed responses cannot undo confirmation.
    if (!result || !['pending','confirmed','failed'].includes(result.state)) return latest;
    if (result.state === 'confirmed' && !result.tx) return latest;
    const next = { ...latest, result };
    this.save(next); return next;
  }
}

/** Only finalized, receipt-checked results can release a pending purchase. */
export function settledOutcome(result: unknown, hash: string): ActionResult | null {
  const r = result as { final_execution_status?: string; transaction?: { hash?: string };
    status?: { Failure?: unknown; SuccessValue?: string }; receipts_outcome?: { outcome: { status: { Failure?: unknown; SuccessValue?: string } } }[] };
  if (!r || r.final_execution_status !== 'FINAL' || r.transaction?.hash !== hash || !r.status || typeof r.status !== 'object' || !Array.isArray(r.receipts_outcome)) return null;
  const failure = r.status.Failure ?? r.receipts_outcome.find(o => o.outcome.status?.Failure)?.outcome.status.Failure;
  if (failure) return { state: 'failed', tx: hash, message: 'This action could not be completed. Refresh your garage before trying again.' };
  if (!('SuccessValue' in r.status)) return null;
  return { state: 'confirmed', tx: hash };
}
