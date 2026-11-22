import { MAX_BACKUP_BYTES } from "./backup-file-name.mjs";
import { prepareBackupSave } from "./backup-files.mjs";
export class BackupSession {
  constructor(request, prepareSave = prepareBackupSave) {
    this.request = request;
    this.prepareSave = prepareSave;
    this.file = null;
    this.fileName = "";
    this.preview = null;
    this.previousToken = null;
    this.result = null;
    this.lastBackup = null;
    this.backups = [];
    this.error = "";
    this.busy = false;
    this.restored = false;
  }
  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      return await task();
    } catch (error) {
      if (error.name !== "AbortError")
        this.error =
          error.message || "処理に失敗しました。再試行してください。";
    } finally {
      this.busy = false;
    }
  }
  async open() {
    return this.run(async () => {
      const state = await this.request("status");
      this.lastBackup = state.lastBackup || null;
      this.backups =
        state.backups || (this.lastBackup ? [this.lastBackup] : []);
      this.error = state.recordWarning || "";
    });
  }
  selectFile(file) {
    if (this.busy) return;
    this.previousToken = this.preview?.previewToken || this.previousToken;
    this.file = file;
    this.fileName = file?.name || "";
    this.preview = null;
    this.error = "";
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
      this.result = null;
      const write = await this.prepareSave();
      const { snapshot, fileName } = await this.request("export", {});
      const saved = await write(snapshot, fileName);
      this.result = {
        ...saved,
        createdAt: snapshot.manifest.createdAt,
        counts: snapshot.manifest.counts,
      };
      try {
        const response = await this.request("record", {
          ...saved,
          backupId: snapshot.manifest.backupId,
        });
        this.lastBackup = response.lastBackup;
        this.backups =
          response.backups || (this.lastBackup ? [this.lastBackup] : []);
      } catch {
        throw Error(
          saved.method === "download"
            ? "ダウンロードを開始しましたが、日時・保存場所の記録を確認できません。画面を開き直して確認してください。"
            : "ファイルは保存しましたが、日時・保存場所の記録を確認できません。画面を開き直して確認してください。",
        );
      }
    });
  }
  async check(dirty) {
    return this.run(async () => {
      this.ensureSaved(dirty);
      this.previousToken = this.preview?.previewToken || this.previousToken;
      this.preview = null;
      if (!this.file)
        throw Error("復元するバックアップJSONファイルを選んでください。");
      if (this.file.size > MAX_BACKUP_BYTES)
        throw Error("20MiB以下のバックアップJSONファイルを選んでください。");
      let backup;
      try {
        backup = JSON.parse(await this.file.text());
      } catch {
        throw Error(
          "バックアップJSONファイルを読み取れません。ファイルを選び直してください。",
        );
      }
      this.preview = await this.request("preview", {
        backup,
        previousToken: this.previousToken,
      });
      this.previousToken = null;
    });
  }
  async restore(dirty) {
    return this.run(async () => {
      this.ensureSaved(dirty);
      if (!this.preview) throw Error("先に復元する内容を確認してください。");
      await this.request("restore", {
        previewToken: this.preview.previewToken,
      });
      this.restored = true;
    });
  }
}
