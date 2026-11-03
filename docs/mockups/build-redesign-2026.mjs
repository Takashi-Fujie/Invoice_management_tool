// 再生成: node docs/mockups/build-redesign-2026.mjs
// 本番distには書かず、架空データ専用の単体モックを生成する。
import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const result = await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    write: false,
    cssCodeSplit: false,
    rolldownOptions: {
      input: resolve(here, "redesign-2026.html"),
      output: { codeSplitting: false },
    },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const code = output.find((x) => x.type === "chunk" && x.isEntry)?.code;
const css = output.find(
  (x) => x.type === "asset" && x.fileName.endsWith(".css"),
)?.source;
let html = String(
  output.find((x) => x.type === "asset" && x.fileName.endsWith(".html"))
    ?.source,
);
if (!code || !css || !html.startsWith("<!doctype html>"))
  throw Error("モックのビルド結果を確認してください。");
html = html.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/, "");
html = html.replace(
  /<link\b[^>]*rel="stylesheet"[^>]*>/,
  () => `<style>${css}</style>`,
);
html = html.replace(
  "</body>",
  () =>
    `<script type="module">${code.replace(/<\/script/gi, "<\\/script")}</script></body>`,
);
const source = await readFile(resolve(here, "redesign-2026.jsx"), "utf8");
if (
  /fetch\s*\(|localStorage|sessionStorage|XMLHttpRequest|WebSocket/.test(source)
)
  throw Error("モックへ外部通信・永続保存を追加しないでください。");
if (/<script[^>]+src=|<link[^>]+href=/.test(html))
  throw Error("単体HTMLに外部依存が残っています。");
html = html.replace(/[ \t]+$/gm, "");
const destination = resolve(here, "redesign-2026-preview.html");
await writeFile(
  destination,
  "<!-- 生成物。編集元: redesign-2026.jsx / redesign-2026.css / redesign-2026-model.mjs。再生成: node docs/mockups/build-redesign-2026.mjs -->\n" +
    html,
);
console.log(`単体モック生成: ${destination}`);

await writeFile(
  resolve(here, "redesign-2026-mobile.html"),
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>スマートフォン表示｜請求管理ツールのモック</title><style>body{margin:0;display:grid;place-items:start center;background:#e5e9e5}iframe{display:block;width:390px;max-width:100vw;height:844px;border:0;background:#fff}</style></head><body><iframe src="./redesign-2026-preview.html" title="390px幅のデザインモック"></iframe></body></html>`,
);

await writeFile(
  resolve(here, "redesign-2026-desktop.html"),
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>デスクトップ表示｜請求管理ツールのモック</title><style>body{margin:0;background:#e5e9e5}iframe{display:block;width:1512px;height:767px;border:0}</style></head><body><iframe src="./redesign-2026-preview.html" title="1512px幅のデザインモック"></iframe></body></html>`,
);
