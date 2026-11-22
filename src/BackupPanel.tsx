import React, { useEffect, useState } from "react";
import { BackupSession } from "./backup-session.mjs";
import { AppHeader } from "./AppHeader";
import { AppFooter } from "./AppFooter";
type BackupInfo = {
  id?: string;
  createdAt: string;
  savedAt?: string;
  counts: Record<string, number>;
  fileName?: string;
  location?: string;
  method?: string;
  previewToken?: string;
};
type BackupState = {
  busy: boolean;
  fileName: string;
  error: string;
  result: BackupInfo | null;
  lastBackup: BackupInfo | null;
  backups: BackupInfo[];
  preview: BackupInfo | null;
};
type ViewProps = {
  state: BackupState;
  dirty: boolean;
  onFile?: (file: File | null) => void;
  onBackup?: () => void;
  onCheck?: () => void;
  onRestore?: () => void;
};
const dateText = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
const countText = (counts: Record<string, number>) =>
  "会社 " +
  (counts.clients ?? 0) +
  "件・請求 " +
  (counts.invoices ?? 0) +
  "件・明細 " +
  (counts.billable_items ?? 0) +
  "件・請求内訳 " +
  (counts.invoice_lines ?? 0) +
  "件・月別表示設定 " +
  (counts.client_month_visibility ?? 0) +
  "件";
export function BackupView({
  state,
  dirty,
  onFile,
  onBackup,
  onCheck,
  onRestore,
}: ViewProps) {
  const blocked = state.busy || dirty;
  const records = state.backups?.length
    ? state.backups
    : state.lastBackup
      ? [state.lastBackup]
      : [];
  return (
    <>
      <p>保存済みの全会社・全年月を、日時付きのJSONファイルにまとめます。</p>
      {dirty && (
        <p className="mm-error" role="alert">
          先に月次入力を保存してください。閉じても編集中の入力は保持されます。
        </p>
      )}
      <div className="backup-actions">
        <section
          aria-label="バックアップファイルを保存"
          className="backup-card"
        >
          <h2>バックアップ保存</h2>
          <p>
            保存先のフォルダを選んでください。Google
            Driveへ保存するときは、PCの同期フォルダを選びます。
          </p>
          <p className="backup-note">
            フォルダの選択画面が出ない環境ではダウンロードします。その場合は、ファイルをGoogle
            Driveの同期フォルダへ移動してください。
          </p>
          <button
            className="primary-button"
            disabled={blocked}
            onClick={onBackup}
          >
            バックアップファイルを保存
          </button>
          {state.result && (
            <div className="backup-result" role="status">
              <strong>
                {state.result.method === "download"
                  ? "ダウンロードを開始しました"
                  : "ファイルの保存と読戻しを確認しました"}
              </strong>
              <p>{state.result.location}</p>
              <p>{countText(state.result.counts)}</p>
            </div>
          )}
        </section>
        <section aria-label="バックアップから復元" className="backup-card">
          <h2>復元</h2>
          <p>
            現在の全データを、選んだファイルの内容へ戻します。実行前に現在のDBを退避します。
          </p>
          <label>
            復元するバックアップJSON
            <input
              type="file"
              accept=".json,application/json"
              disabled={blocked}
              onChange={(event) => {
                onFile?.(event.target.files?.[0] || null);
                event.target.value = "";
              }}
            />
          </label>
          {state.fileName && <p>選択したファイル：{state.fileName}</p>}
          <button disabled={blocked || !state.fileName} onClick={onCheck}>
            復元する内容を確認
          </button>
          {state.preview && (
            <div className="backup-preview">
              <strong>この内容へ全件を復元します</strong>
              <p>{dateText(state.preview.createdAt)}（日本時間）</p>
              <p>{countText(state.preview.counts)}</p>
              <p>現在の全データは、このバックアップの内容へ置き換わります。</p>
              <button
                className="backup-restore"
                disabled={blocked}
                onClick={onRestore}
              >
                現在のDBを退避して復元する
              </button>
            </div>
          )}
        </section>
      </div>
      <section
        className="backup-card backup-history"
        aria-label="バックアップリスト"
      >
        <h2>バックアップリスト</h2>
        <p className="backup-note">
          このPCで記録した保存履歴を、新しい順に表示します。復元するファイルは上の復元欄で選んでください。
        </p>
        {records.length ? (
          <table
            className="backup-history-table"
            aria-label="保存したバックアップ"
          >
            <thead>
              <tr>
                <th scope="col">日時（日本時間）</th>
                <th scope="col">保存場所</th>
                <th scope="col">含まれるデータ</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record, index) => (
                <tr key={record.id || record.savedAt || index}>
                  <td data-label="日時（日本時間）">
                    <time dateTime={record.savedAt || record.createdAt}>
                      {dateText(record.savedAt || record.createdAt)}
                    </time>
                    <br />
                    <span
                      className={
                        "backup-record-status " +
                        (record.method === "download"
                          ? "unconfirmed"
                          : "confirmed")
                      }
                    >
                      {record.method === "download"
                        ? "ダウンロード開始（保存未確認）"
                        : "ファイル保存確認済み"}
                    </span>
                  </td>
                  <td data-label="保存場所">{record.location}</td>
                  <td data-label="含まれるデータ">
                    <div>{dateText(record.createdAt)} 時点</div>
                    <div className="backup-note">
                      {countText(record.counts || {})}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>バックアップの記録はまだありません。</p>
        )}
        <p className="backup-note">
          保存場所はフォルダ名とファイル名です。ファイルの移動・削除は一覧に反映されません。Google
          Driveの同期状況はPCのDriveアプリで確認してください。
        </p>
      </section>
      {state.busy && <p role="status">処理中です。完了までお待ちください。</p>}
      {state.error && (
        <p className="mm-error" role="alert">
          {state.error}
        </p>
      )}
    </>
  );
}
async function request(action: string, body?: unknown) {
  const response = await fetch("/api/backup/" + action, {
    signal: AbortSignal.timeout(30000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Invoice-Request": "1",
          },
          body: JSON.stringify(body),
        }),
  }).catch(() => {
    throw Error(
      "通信に失敗しました。入力を保持しています。再試行してください。",
    );
  });
  const value = await response
    .json()
    .catch(() => ({ message: "通信に失敗しました。再試行してください。" }));
  if (!response.ok)
    throw Object.assign(Error(value.message || "処理に失敗しました。"), {
      statusCode: response.status,
    });
  if (action === "export") {
    const name = response.headers.get("X-Invoice-Backup-File");
    if (!name) throw Error("バックアップのファイル名を確認できません。");
    return { snapshot: value, fileName: decodeURIComponent(name) };
  }
  return value;
}
export function BackupPage({
  year,
  month,
  model: providedModel,
}: {
  year: number;
  month: number;
  model?: BackupSession;
}) {
  const [model] = useState(() => providedModel || new BackupSession(request));
  const [, redraw] = useState(0);
  const refresh = () => redraw((value) => value + 1);
  async function run(task: () => Promise<unknown>) {
    const result = task();
    refresh();
    await result;
    refresh();
  }
  useEffect(() => {
    void run(() => model.open());
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (model.busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [model]);
  return (
    <div id="app" className="backup-app">
      <AppHeader
        view="backup"
        year={year}
        month={month}
        disabled={model.busy}
      />
      <main className="workspace backup-workspace">
        <div className="page-toolbar">
          <div className="page-title">
            <h1>バックアップ・復元</h1>
          </div>
        </div>
        <BackupView
          state={model as unknown as BackupState}
          dirty={false}
          onFile={(file) => {
            model.selectFile(file);
            refresh();
          }}
          onBackup={() => void run(() => model.backup(false))}
          onCheck={() => void run(() => model.check(false))}
          onRestore={() =>
            void run(async () => {
              await model.restore(false);
              if (model.restored) window.location.reload();
            })
          }
        />
      </main>
      <AppFooter />
    </div>
  );
}
