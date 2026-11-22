import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readPrivateJSON, savePrivateJSON } from "./private-json.mjs";
const recordId = /^(?:[0-9a-f-]{36}|legacy-[0-9a-f]{32})$/;
function valid(record) {
  return (
    record &&
    typeof record.fileName === "string" &&
    record.fileName.length <= 255 &&
    typeof record.location === "string" &&
    record.location.length <= 1024 &&
    ["directory", "file", "download"].includes(record.method) &&
    typeof record.createdAt === "string" &&
    Number.isFinite(new Date(record.createdAt).getTime()) &&
    typeof record.savedAt === "string" &&
    Number.isFinite(new Date(record.savedAt).getTime()) &&
    record.counts &&
    typeof record.counts === "object" &&
    !Array.isArray(record.counts) &&
    Object.values(record.counts).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  );
}
export class BackupHistory {
  constructor(directory) {
    this.directory = directory ? join(directory, "records") : null;
    this.records = [];
    this.warning = "";
    let damaged = false;
    if (this.directory && existsSync(this.directory)) {
      try {
        if (
          lstatSync(this.directory).isSymbolicLink() ||
          !lstatSync(this.directory).isDirectory()
        )
          throw Error();
        for (const name of readdirSync(this.directory)) {
          if (!name.endsWith(".json")) continue;
          try {
            const entry = readPrivateJSON(this.directory, name);
            if (
              !valid(entry) ||
              !recordId.test(entry.id) ||
              name !== entry.id + ".json" ||
              !Number.isSafeInteger(entry.order) ||
              entry.order < 0
            )
              throw Error();
            this.records.push(entry);
          } catch {
            damaged = true;
          }
        }
      } catch {
        damaged = true;
      }
    }
    try {
      const old = readPrivateJSON(directory, "latest.json");
      if (old) {
        if (!valid(old)) throw Error();
        const id =
          "legacy-" +
          createHash("sha256")
            .update(JSON.stringify(old))
            .digest("hex")
            .slice(0, 32);
        if (!this.records.some((entry) => entry.id === id))
          this.records.push({ ...old, id, order: 0 });
      }
    } catch {
      damaged = true;
    }
    this.records.sort(
      (a, b) =>
        b.order - a.order || Date.parse(b.savedAt) - Date.parse(a.savedAt),
    );
    if (damaged)
      this.warning =
        "一部のバックアップ記録を読み取れません。表示できる履歴と新しい保存は利用できます。";
  }
  append(backupId, values) {
    const entry = {
      ...values,
      id: backupId,
      order:
        this.records.reduce((max, record) => Math.max(max, record.order), 0) +
        1,
    };
    if (
      !valid(entry) ||
      !recordId.test(entry.id) ||
      !Number.isSafeInteger(entry.order)
    )
      throw Error("バックアップ記録を保存できません。");
    for (const old of this.records) {
      if (
        old.id.startsWith("legacy-") &&
        this.directory &&
        !existsSync(join(this.directory, old.id + ".json"))
      )
        savePrivateJSON(this.directory, old.id + ".json", old);
    }
    savePrivateJSON(this.directory, entry.id + ".json", entry);
    this.records = [entry, ...this.records];
    return entry;
  }
}
