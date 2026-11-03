import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.mjs";

test("公開版は中立的なパッケージ名・DB設定・画面名を使う", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const entry = readFileSync(
    new URL("../server/index.mjs", import.meta.url),
    "utf8",
  );
  expect(pkg.name).toBe("invoice-management-tool");
  expect(entry).toContain("process.env.INVOICE_DB_PATH");
  expect(entry).toContain(".local-data/invoice.sqlite");
  expect(entry).toContain("請求管理ツール");
});

test("公開版の一括保存は専用の要求ヘッダーを確認し、保存内容を再読込できる", async () => {
  const app = createApp({ path: ":memory:" });
  try {
    const headers = { host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787" };
    const url = "/api/month/2026/11";
    const loaded = await app.inject({ method: "GET", url, headers });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().companies).toEqual([]);
    const data = {
      companies: [
        {
          id: "public-test",
          name: "公開確認会社（架空）",
          revision: 0,
          visible: true,
          invoiced: false,
          paid: false,
          withholdingAmount: 0,
          rows: [
            { id: "public-row", description: "制作（架空）", amount: 12000 },
          ],
        },
      ],
    };
    const missing = await app.inject({
      method: "PUT",
      url,
      headers,
      payload: data,
    });
    expect(missing.statusCode).toBe(403);
    const saved = await app.inject({
      method: "PUT",
      url,
      headers: { ...headers, "x-invoice-request": "1" },
      payload: data,
    });
    expect(saved.statusCode).toBe(200);
    const reread = await app.inject({ method: "GET", url, headers });
    expect(reread.json()).toEqual(saved.json());
  } finally {
    await app.close();
  }
});
