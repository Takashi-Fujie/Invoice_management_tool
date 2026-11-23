const channelName = "invoice-month-updates";
const conflict =
  "別タブで更新されました。入力を保持して自動保存を停止しています。最新データを確認してください。";
const revisions = (data) =>
  JSON.stringify([
    data.databaseGeneration || "",
    data.companies
      .map((c) => [c.id, c.revision])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);

export class TabSync {
  constructor(
    session,
    autosave,
    { onChange = () => {}, canRefresh = () => Boolean(true) } = {},
  ) {
    this.session = session;
    this.autosave = autosave;
    this.onChange = onChange;
    this.canRefresh = canRefresh;
    this.notice = "";
    this.pending = false;
    this.checking = false;
  }
  start(browser) {
    this.browser = browser;
    this.onFocus = () => void this.check();
    this.onStorage = (event) => {
      if (event.key === channelName) void this.check();
    };
    browser.addEventListener("focus", this.onFocus);
    browser.addEventListener("storage", this.onStorage);
    if (browser.BroadcastChannel) {
      this.channel = new browser.BroadcastChannel(channelName);
      this.channel.onmessage = (event) => {
        if (event.data?.type === "saved") void this.check();
      };
    }
  }
  stop() {
    this.browser?.removeEventListener("focus", this.onFocus);
    this.browser?.removeEventListener("storage", this.onStorage);
    this.channel?.close();
  }
  publish() {
    try {
      if (this.channel) this.channel.postMessage({ type: "saved" });
      else
        this.browser?.localStorage.setItem(
          channelName,
          String(Date.now()) + Math.random(),
        );
    } catch {
      // 通知が使えなくても前面復帰時の読取とAPIの競合拒否を使う。
    }
  }
  async check() {
    this.autosave.schedule(false);
    this.pending = true;
    if (this.task) return this.task;
    const s = this.session;
    if (s.busy || s.navigating || !this.canRefresh()) return "deferred";
    this.pending = false;
    this.checking = true;
    this.task = (async () => {
      try {
        await this.autosave.wait().catch(() => {});
        const year = s.year,
          month = s.month;
        const latest = await s.api.load(year, month);
        if (
          s.year !== year ||
          s.month !== month ||
          s.busy ||
          s.navigating ||
          !this.canRefresh()
        ) {
          this.pending = true;
          return "deferred";
        }
        if (revisions(latest) === revisions(s.base)) {
          if (this.failedCheck) {
            this.failedCheck = false;
            this.notice = "";
            this.autosave.release();
          }
          return "unchanged";
        }
        if (s.dirty) {
          this.notice = conflict;
          this.autosave.hold(conflict);
          return "conflict";
        }
        s.draft = latest;
        s.base = structuredClone(latest);
        this.failedCheck = false;
        this.notice = "別タブの変更を反映しました。";
        this.autosave.release();
        return "updated";
      } catch {
        this.failedCheck = true;
        this.notice =
          "最新データを確認できません。入力を保持して自動保存を停止しています。接続を確認して再確認してください。";
        this.autosave.hold(this.notice);
        return "failed";
      } finally {
        this.checking = false;
        this.task = null;
        this.onChange();
      }
    })();
    this.onChange();
    return this.task;
  }
  async reload() {
    this.autosave.schedule(false);
    if (this.task) await this.task;
    await this.autosave.wait().catch(() => {});
    await this.session.open();
    this.notice = "";
    this.failedCheck = false;
    this.pending = false;
    this.autosave.release();
    this.onChange();
  }
}
