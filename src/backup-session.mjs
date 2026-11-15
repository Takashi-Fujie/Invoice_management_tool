export class BackupSession {
  constructor(request, idFactory = () => crypto.randomUUID()) {
    this.request = request;
    this.idFactory = idFactory;
    this.connected = false;
    this.configured = false;
    this.destination = "";
    this.selectedFile = null;
    this.connectionId = null;
    this.backups = [];
    this.selected = "";
    this.preview = null;
    this.result = null;
    this.error = "";
    this.busy = false;
    this.requestId = null;
    this.restored = false;
  }
  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      return await task();
    } catch (error) {
      this.error = error.message || "処理に失敗しました。再試行してください。";
    } finally {
      this.busy = false;
    }
  }
  async open() {
    return this.run(async () => {
      const state = await this.request("status");
      this.applyStatus(state);
    });
  }
  applyStatus(state) {
    const destination = state.connected
      ? state.destination || state.selectedFile?.url || ""
      : "";
    if (
      destination !== this.destination ||
      this.connectionId !== state.connectionId
    )
      this.resetDestination(destination);
    this.connected = state.connected;
    this.configured = state.configured;
    this.selectedFile = state.connected ? state.selectedFile || null : null;
    this.connectionId = state.connectionId || null;
    this.error =
      state.selectionError || state.setupError || state.preferenceWarning || "";
    this.result = state.lastSuccess || null;
  }
  setDestination(value) {
    if (this.busy) return;
    this.resetDestination(value);
  }
  resetDestination(value) {
    this.destination = value;
    this.requestId = null;
    this.preview = null;
    this.backups = [];
    this.selected = "";
    this.result = null;
  }
  selectSheet(value) {
    if (this.busy) return;
    this.selected = value;
    this.preview = null;
  }
  ensureSaved(dirty) {
    if (dirty)
      throw Error(
        "先に月次入力を保存してから、バックアップ・復元を行ってください。",
      );
  }
  async backup(dirty) {
    return this.run(async () => {
      this.ensureSaved(dirty);
      this.requestId ??= this.idFactory();
      try {
        this.result = await this.request("run", {
          destination: this.destination,
          connectionId: this.connectionId,
          requestId: this.requestId,
        });
      } catch (error) {
        if (error.statusCode === 409) this.requestId = null;
        throw error;
      }
      this.requestId = null;
    });
  }
  async list() {
    return this.run(async () => {
      this.preview = null;
      this.selected = "";
      this.backups = (
        await this.request("list", {
          destination: this.destination,
          connectionId: this.connectionId,
        })
      ).backups;
    });
  }
  async check(dirty) {
    return this.run(async () => {
      this.ensureSaved(dirty);
      this.preview = null;
      if (!this.selected) throw Error("復元するバックアップを選んでください。");
      this.preview = await this.request("preview", {
        destination: this.destination,
        connectionId: this.connectionId,
        sheetId: Number(this.selected),
      });
    });
  }
  async restore(dirty) {
    return this.run(async () => {
      this.ensureSaved(dirty);
      if (!this.preview) throw Error("先に復元する内容を確認してください。");
      await this.request("restore", {
        previewToken: this.preview.previewToken,
        connectionId: this.connectionId,
      });
      this.restored = true;
    });
  }
}
