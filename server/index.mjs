import { resolve } from "node:path";
import { createApp } from "./app.mjs";
const port = Number(process.env.PORT || 8787);
const app = createApp({
  path: resolve(process.env.INVOICE_DB_PATH || ".local-data/invoice.sqlite"),
  port,
});
await app.listen({ host: "127.0.0.1", port });
console.log(`請求管理ツール http://127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
