import { prepareMonth } from "./month.mjs";

export class AutoSave {
  constructor(
    session,
    { delay = 600, onChange = () => {}, onSaved = () => {} } = {},
  ) {
    this.session = session;
    this.delay = delay;
    this.onChange = onChange;
    this.onSaved = onSaved;
    this.blocked = "";
    this.error = "";
    this.enabled = true;
    this.saving = false;
  }
  fingerprint() {
    const s = this.session;
    return JSON.stringify([s.year, s.month, s.draft]);
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
  }
  schedule(enabled = true) {
    this.cancel();
    this.enabled = enabled;
    const s = this.session;
    if (this.error && this.failedInput !== this.fingerprint()) {
      this.error = "";
      this.onChange();
    }
    if (
      !enabled ||
      this.blocked ||
      this.saving ||
      s.busy ||
      s.navigating ||
      !s.dirty ||
      this.error
    )
      return;
    try {
      prepareMonth(s.draft, s.year, s.month);
    } catch {
      return;
    }
    this.timer = setTimeout(
      () => void this.flush().catch(() => {}),
      this.delay,
    );
  }
  async wait() {
    if (this.task) await this.task;
  }
  hold(message) {
    this.cancel();
    this.blocked = message;
    this.onChange();
  }
  release() {
    this.blocked = "";
    this.error = "";
    this.onChange();
  }
  async flush() {
    this.cancel();
    while (this.task) await this.task;
    this.cancel();
    const s = this.session;
    if (!s.dirty) return true;
    if (this.blocked) throw Error(this.blocked);
    if (s.busy || s.navigating) return false;
    try {
      prepareMonth(s.draft, s.year, s.month);
    } catch {
      return false;
    }
    const year = s.year,
      month = s.month,
      snapshot = structuredClone(s.draft);
    const input = this.fingerprint();
    this.saving = true;
    this.error = "";
    this.task = (async () => {
      try {
        const saved = await s.api.save(snapshot, year, month);
        this.onSaved();
        if (s.year !== year || s.month !== month) return;
        const revisions = new Map(
          saved.companies.map((c) => [c.id, c.revision]),
        );
        const updated = (data) => ({
          ...data,
          ...(saved.databaseGeneration
            ? { databaseGeneration: saved.databaseGeneration }
            : {}),
          companies: data.companies.map((c) =>
            revisions.has(c.id) ? { ...c, revision: revisions.get(c.id) } : c,
          ),
        });
        // 保存開始後の入力と空の入力用行を残し、保存済みの基準だけを進める。
        s.base = updated(snapshot);
        s.draft = updated(s.draft);
      } catch (e) {
        this.error = e instanceof Error ? e.message : "通信に失敗しました。";
        this.failedInput = input;
        throw e;
      } finally {
        this.saving = false;
        this.task = null;
        this.onChange();
        if (this.enabled) this.schedule();
      }
    })();
    this.onChange();
    await this.task;
    return true;
  }
}
