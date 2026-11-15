import React, { useEffect, useRef, useState } from "react";
import { BackupSession } from "./backup-session.mjs";

type BackupInfo = {
  title?: string;
  createdAt: string;
  counts: Record<string, number>;
  url?: string;
  previewToken?: string;
};
type BackupState = {
  busy: boolean;
  configured: boolean;
  connected: boolean;
  destination: string;
  selectedFile: { id: string; name: string; url?: string } | null;
  error: string;
  result: BackupInfo | null;
  preview: BackupInfo | null;
  selected: string;
  backups: { sheetId: number; title: string; createdAt: string }[];
};
type ViewProps = {
  state: BackupState;
  dirty: boolean;
  onSheet: (value: string) => void;
  onConfigure: (file: File) => void;
  onConnect: () => void;
  onBackup: () => void;
  onList: () => void;
  onCheck: () => void;
  onRestore: () => void;
  onClose: () => void;
};
const dateText = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const countText = (counts: Record<string, number>) =>
  `会社 ${counts.clients ?? 0}件・請求 ${counts.invoices ?? 0}件・明細 ${counts.billable_items ?? 0}件・請求内訳 ${counts.invoice_lines ?? 0}件・月別表示設定 ${counts.client_month_visibility ?? 0}件`;
export function BackupView({
  state,
  dirty,
  onSheet,
  onConfigure,
  onConnect,
  onBackup,
  onList,
  onCheck,
  onRestore,
  onClose,
}: ViewProps) {
  const blocked = state.busy || dirty;
  return (
    <>
      <div className="backup-heading">
        <h2 id="backup-title">バックアップ・復元</h2>
        <button
          disabled={state.busy}
          onClick={onClose}
          aria-label="バックアップを閉じる"
        >
          閉じる
        </button>
      </div>
      <p>保存済みの全会社・全年月を、日時付きの新しいタブへ保存します。</p>
      {dirty && (
        <p className="mm-error" role="alert">
          先に月次入力を保存してください。閉じても編集中の入力は保持されます。
        </p>
      )}
      <section aria-label="Google連携" className="backup-section">
        <h3>Google連携</h3>
        <details open={!state.configured}>
          <summary>Google接続の初期設定・変更</summary>
          <p>
            初回は、ツールの提供者から受け取ったGoogle連携の設定JSONを、このPCで読み込んでください。ご自身でGoogle
            Cloudプロジェクトを作る必要はありません。
          </p>
          <label>
            Google連携の設定JSON
            <input
              type="file"
              accept=".json,application/json"
              disabled={state.busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onConfigure(file);
                event.target.value = "";
              }}
            />
          </label>
          <p className="backup-note">
            設定ファイルと認証情報は、この端末内だけで管理します。
          </p>
        </details>
        <p role="status">
          {state.connected
            ? "Google接続済み"
            : state.configured
              ? "接続設定済み・Googleログイン待ち"
              : "Google接続は未設定です"}
        </p>
        {state.configured && (
          <>
            <button disabled={blocked} onClick={onConnect}>
              {state.connected
                ? "Googleで保存先を選び直す"
                : "Googleで保存先を選ぶ"}
            </button>
            <p className="backup-note">
              Googleで選んだファイルへのアクセスを許可します。このツールは現在の保存先のバックアップタブだけを操作します。
            </p>
          </>
        )}
      </section>
      <section aria-label="バックアップの保存先" className="backup-section">
        <h3>保存先</h3>
        <p aria-label="選択した保存先">
          {state.selectedFile?.name ||
            "保存先はまだ選択されていません。Googleで選んでください。"}
        </p>
        {state.destination && (
          <p>
            <a href={state.destination} target="_blank" rel="noreferrer">
              選択したスプレッドシートを開く
            </a>
          </p>
        )}
        <p className="backup-note">
          既存のタブと過去のバックアップは上書きしません。同じ分のバックアップ名が存在する場合は、次の分になってから実行してください。
        </p>
        <button
          className="primary-button"
          disabled={blocked || !state.connected || !state.destination}
          onClick={onBackup}
        >
          今すぐバックアップ
        </button>
        {state.result && (
          <div className="backup-result" role="status">
            <strong>読戻し検証済みのバックアップ</strong>
            <p>{dateText(state.result.createdAt)}（日本時間）</p>
            <p>{countText(state.result.counts)}</p>
            {state.result.url ? (
              <a href={state.result.url} target="_blank" rel="noreferrer">
                {state.result.title}
              </a>
            ) : (
              <p>{state.result.title}</p>
            )}
          </div>
        )}
      </section>
      <section aria-label="バックアップから復元" className="backup-section">
        <h3>バックアップから復元</h3>
        <p>
          現在の全データを、選んだ保存時点の内容へ戻します。実行前に現在のDBを退避します。
        </p>
        <button
          disabled={state.busy || !state.connected || !state.destination}
          onClick={onList}
        >
          保存先のバックアップ一覧を読む
        </button>
        {state.backups.length > 0 && (
          <>
            <label>
              復元する保存日時
              <select
                value={state.selected}
                disabled={blocked}
                onChange={(event) => onSheet(event.target.value)}
              >
                <option value="">選択してください</option>
                {state.backups.map((backup) => (
                  <option key={backup.sheetId} value={backup.sheetId}>
                    {dateText(backup.createdAt)}（日本時間）
                  </option>
                ))}
              </select>
            </label>
            <button disabled={blocked || !state.selected} onClick={onCheck}>
              復元する内容を確認
            </button>
          </>
        )}
        {state.preview && (
          <div className="backup-preview">
            <strong>この内容へ全件を復元します</strong>
            <p>{dateText(state.preview.createdAt)}（日本時間）</p>
            <p>{countText(state.preview.counts)}</p>
            <p>
              保存後に追加・変更した現在のデータは、このバックアップの内容へ置き換わります。
            </p>
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
  const url =
    action === "status"
      ? "/api/backup/status"
      : action.startsWith("google/")
        ? `/api/${action}`
        : `/api/backup/${action}`;
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Invoice-Request": "1",
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response
    .json()
    .catch(() => ({ message: "通信に失敗しました。再試行してください。" }));
  if (!response.ok)
    throw Object.assign(Error(value.message || "処理に失敗しました。"), {
      statusCode: response.status,
    });
  return value;
}
export function BackupPanel({
  dirty = false,
  disabled = false,
}: {
  dirty?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URL(window.location.href).searchParams.get("backup") === "open",
  );
  const [model] = useState(() => new BackupSession(request));
  const [, redraw] = useState(0),
    dialog = useRef<HTMLDialogElement>(null);
  const refresh = () => redraw((value) => value + 1);
  async function run(task: () => Promise<unknown>) {
    const result = task();
    refresh();
    await result;
    refresh();
  }
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      void run(() => model.open());
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("backup")) {
      url.searchParams.delete("backup");
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search,
      );
    }
  }, [open]);
  const close = () => {
    if (!model.busy) setOpen(false);
  };
  return (
    <>
      <button disabled={disabled} onClick={() => setOpen(true)}>
        バックアップ・復元
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="backup-dialog"
          aria-labelledby="backup-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <BackupView
            state={model as unknown as BackupState}
            dirty={dirty}
            onClose={close}
            onSheet={(value) => {
              model.selectSheet(value);
              refresh();
            }}
            onConfigure={(file) =>
              void run(() =>
                model.run(async () => {
                  if (file.size > 65536)
                    throw Error("OAuthクライアントJSONを選んでください。");
                  let config;
                  try {
                    config = JSON.parse(await file.text());
                  } catch {
                    throw Error("JSONファイルを読み取れません。");
                  }
                  const state = await request("google/configure", config);
                  model.applyStatus(state);
                }),
              )
            }
            onConnect={() =>
              void run(() =>
                model.run(async () => {
                  model.ensureSaved(dirty);
                  const { url } = await request("google/start", {
                    returnTo: window.location.pathname + window.location.search,
                  });
                  window.location.assign(url);
                }),
              )
            }
            onBackup={() => void run(() => model.backup(dirty))}
            onList={() => void run(() => model.list())}
            onCheck={() => void run(() => model.check(dirty))}
            onRestore={() =>
              void run(async () => {
                await model.restore(dirty);
                if (model.restored) window.location.reload();
              })
            }
          />
        </dialog>
      )}
    </>
  );
}
