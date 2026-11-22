export async function prepareBackupSave(environment = globalThis) {
  if (typeof environment.showDirectoryPicker === "function") {
    let directory;
    try {
      directory = await environment.showDirectoryPicker({
        id: "invoice-backups",
        mode: "readwrite",
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw Error(
        "保存先フォルダを選べません。ブラウザのファイル操作の許可を確認して再試行してください。",
      );
    }
    return async (snapshot, fileName) => {
      const text = JSON.stringify(snapshot);
      let exists = false;
      try {
        await directory.getFileHandle(fileName);
        exists = true;
      } catch (error) {
        if (error.name !== "NotFoundError")
          throw Error("保存先を確認できません。フォルダを選び直してください。");
      }
      if (exists)
        throw Error(
          "同じ名前のファイルがあります。上書きせず、バックアップをやり直してください。",
        );
      let writable;
      try {
        const file = await directory.getFileHandle(fileName, { create: true });
        writable = await file.createWritable();
        await writable.write(text);
        await writable.close();
        if ((await (await file.getFile()).text()) !== text) throw Error();
      } catch {
        try {
          await writable?.abort();
        } catch {
          /* 終了したストリームはそのまま保持する。 */
        }
        throw Error(
          "ファイルの保存・読戻しを確認できません。以前のバックアップは保持されています。保存先を確認して再試行してください。",
        );
      }
      return {
        method: "directory",
        fileName,
        location: directory.name + "/" + fileName,
      };
    };
  }
  return async (snapshot, fileName) => {
    const blob = new environment.Blob([JSON.stringify(snapshot)], {
      type: "application/json",
    });
    const url = environment.URL.createObjectURL(blob);
    const anchor = environment.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    environment.document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      environment.setTimeout(() => environment.URL.revokeObjectURL(url), 60000);
    }
    return {
      method: "download",
      fileName,
      location: "ブラウザのダウンロード先（フォルダ未確認）",
    };
  };
}
