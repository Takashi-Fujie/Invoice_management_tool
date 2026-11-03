import { annualSummary } from "../src/annual.mjs";
import Fastify from "fastify";
import { validChecks } from "../src/checks.mjs";
import {
  isNonFeeType,
  validRowAmount,
  normalizeRow,
  companyTotals,
  normalizeWithholdingAmount,
} from "../src/reward.mjs";
import { migrateDatabase } from "./migrations.mjs";
import {
  visibilityBlockReason,
  isCompanyVisible,
} from "../src/company-visibility.mjs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { randomUUID } from "node:crypto";
const bad = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
function period(y, m) {
  y = Number(y);
  m = Number(m);
  if (
    !Number.isInteger(y) ||
    y < 1 ||
    y > 9999 ||
    !Number.isInteger(m) ||
    m < 1 ||
    m > 12
  )
    throw bad("対象の年・月を確認してください。");
  return [y, m];
}
export function createApp({
  path,
  port = 8787,
  staticRoot = resolve("dist"),
} = {}) {
  if (!path) throw Error("保存先の指定が必要です");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  let migrationBackup;
  try {
    migrationBackup = migrateDatabase(db, path);
  } catch (e) {
    db.close();
    throw e;
  }
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;",
  );
  const clients = () =>
    db.prepare("SELECT * FROM clients ORDER BY rowid").all();
  function load(y, m) {
    return {
      companies: clients().map((c) => {
        const invoice = db
          .prepare(
            "SELECT * FROM invoices WHERE client_id=? AND target_year=? AND target_month=?",
          )
          .get(c.id, y, m);
        const settings = db
          .prepare(
            "SELECT visible FROM client_month_visibility WHERE client_id=? AND target_year=? AND target_month=?",
          )
          .get(c.id, y, m);
        const company = {
          id: c.id,
          name: c.name,
          revision: c.version,
          rows: invoice
            ? db
                .prepare(
                  "SELECT b.id,b.description,b.amount_yen amount,CASE WHEN b.kind IN('travel','expense','adjustment') THEN b.kind ELSE b.reward_type END rewardType,b.hours_text hours,b.rate_text rate,b.manual_amount_yen manualAmount,b.price_mode priceMode,b.fee_price_mode feePriceMode,b.travel_price_mode travelPriceMode,b.discount_enabled discountEnabled,b.discount_rate discountRate,b.withholding_enabled withholdingEnabled FROM invoice_lines l JOIN billable_items b ON b.id=l.billable_item_id WHERE l.invoice_id=? ORDER BY l.line_no",
                )
                .all(invoice.id)
                .map((r) => ({
                  ...r,
                  discountEnabled: !!r.discountEnabled,
                  withholdingEnabled: !!r.withholdingEnabled,
                }))
            : [],
          withholdingAmount: invoice?.withholding_yen ?? 0,
          invoiced: !!invoice?.invoiced,
          paid: !!invoice?.paid,
          visible: !!settings?.visible,
        };
        company.visible = isCompanyVisible(company, y, m);
        return company;
      }),
    };
  }
  function save(y, m, p) {
    if (
      !p ||
      !Array.isArray(p.companies) ||
      !p.companies.length ||
      p.companies.length > 1000
    )
      throw bad("会社と入力内容を確認してください。");
    const companyIds = new Set(),
      rowIds = new Set();
    const validId = (id) =>
      typeof id === "string" && id.length > 0 && id.length <= 100;
    const incoming = p.companies.map((c) => {
      if (
        !c ||
        !validId(c.id) ||
        companyIds.has(c.id) ||
        typeof c.name !== "string" ||
        !c.name.trim() ||
        c.name.length > 80 ||
        !Number.isSafeInteger(c.revision) ||
        c.revision < 0 ||
        !Array.isArray(c.rows) ||
        c.rows.length > 1000 ||
        typeof c.invoiced !== "boolean" ||
        typeof c.paid !== "boolean"
      )
        throw bad("会社名・会社ID・入力内容を確認してください。");
      companyIds.add(c.id);
      if (c.visible !== undefined && typeof c.visible !== "boolean")
        throw bad("会社の表示・非表示を確認してください。");
      if (!validChecks(c.invoiced, c.paid))
        throw bad(
          "請求済にしてから入金済にしてください。請求済を外す前に入金済を外してください。",
        );
      let withholdingAmount;
      try {
        withholdingAmount = normalizeWithholdingAmount(c.withholdingAmount);
      } catch {
        throw bad("源泉徴収額は0〜999,999,999円の整数で入力してください。");
      }
      const rows = c.rows.map((r) => {
        if (
          !r ||
          !validId(r.id) ||
          rowIds.has(r.id) ||
          typeof r.description !== "string" ||
          !r.description.trim() ||
          r.description.length > 160 ||
          !validRowAmount(r.amount, r.rewardType)
        )
          throw bad("業務内容・円単位の報酬額・明細IDを確認してください。");
        rowIds.add(r.id);
        try {
          return normalizeRow(
            { ...r, description: r.description.trim() },
            y,
            m,
          );
        } catch {
          throw bad(
            "報酬タイプ・時間・単価・金額・税込／税抜・値引き・源泉を確認してください。",
          );
        }
      });
      if (companyTotals(rows).invoice < 0)
        throw bad("調整後の小計は0円以上にしてください。");
      if (
        c.visible === false &&
        visibilityBlockReason({ ...c, rows, withholdingAmount }, y, m)
      )
        throw bad("入力のある会社は非表示にできません。");
      return { ...c, name: c.name.trim(), rows, withholdingAmount };
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = clients(),
        current = load(y, m).companies;
      const conflict = () =>
        bad(
          "別の画面で保存されています。入力を控え、再読み込みして確認してください。",
          409,
        );
      if (existing.some((c) => !companyIds.has(c.id))) throw conflict();
      for (const c of incoming) {
        const old = existing.find((x) => x.id === c.id);
        if ((old?.version || 0) !== c.revision) throw conflict();
        const before = current.find((x) => x.id === c.id);
        if (c.visible === undefined)
          c.visible = !!visibilityBlockReason(c, y, m) || !!before?.visible;
        if (
          before?.invoiced &&
          c.invoiced &&
          (JSON.stringify(before.rows) !== JSON.stringify(c.rows) ||
            before.withholdingAmount !== c.withholdingAmount)
        )
          throw bad(
            "外部の請求状態を確認し、請求済を外してから明細・源泉徴収額を訂正してください。",
          );
        for (const r of c.rows) {
          const item = db
            .prepare(
              "SELECT client_id,target_year,target_month FROM billable_items WHERE id=?",
            )
            .get(r.id);
          if (
            item &&
            (item.client_id !== c.id ||
              item.target_year !== y ||
              item.target_month !== m)
          )
            throw bad("別の会社・月の明細は使用できません。");
        }
      }
      for (const c of incoming) {
        if (!existing.some((x) => x.id === c.id))
          db.prepare("INSERT INTO clients(id,name,version) VALUES(?,?,0)").run(
            c.id,
            c.name,
          );
        db.prepare(
          "UPDATE clients SET name=?,version=version+1 WHERE id=?",
        ).run(c.name, c.id);
        db.prepare(
          "INSERT INTO client_month_visibility(client_id,target_year,target_month,visible) VALUES(?,?,?,?) ON CONFLICT(client_id,target_year,target_month) DO UPDATE SET visible=excluded.visible",
        ).run(c.id, y, m, +c.visible);
        const old = db
          .prepare(
            "SELECT id FROM invoices WHERE client_id=? AND target_year=? AND target_month=?",
          )
          .get(c.id, y, m);
        // 空月を表示・会社名を保存するだけでは空の請求を作らない。
        if (
          !old &&
          !c.rows.length &&
          !c.invoiced &&
          !c.paid &&
          !c.withholdingAmount
        )
          continue;
        const invoiceId = old?.id || randomUUID();
        const lineIds = new Map(
          old
            ? db
                .prepare(
                  "SELECT id,billable_item_id FROM invoice_lines WHERE invoice_id=?",
                )
                .all(old.id)
                .map((l) => [l.billable_item_id, l.id])
            : [],
        );
        if (old)
          db.prepare("DELETE FROM invoice_lines WHERE invoice_id=?").run(
            old.id,
          );
        db.prepare(
          "DELETE FROM billable_items WHERE client_id=? AND target_year=? AND target_month=?",
        ).run(c.id, y, m);
        db.prepare(
          "INSERT INTO invoices(id,client_id,target_year,target_month,total_yen,invoiced,paid,withholding_yen) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET total_yen=excluded.total_yen,invoiced=excluded.invoiced,paid=excluded.paid,withholding_yen=excluded.withholding_yen",
        ).run(
          invoiceId,
          c.id,
          y,
          m,
          companyTotals(c.rows).invoice,
          +c.invoiced,
          +c.paid,
          c.withholdingAmount,
        );
        c.rows.forEach((r, i) => {
          db.prepare(
            "INSERT INTO billable_items(id,client_id,target_year,target_month,description,amount_yen,reward_type,hours_text,rate_text,manual_amount_yen,kind,price_mode,fee_price_mode,travel_price_mode,discount_enabled,discount_rate,withholding_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            r.id,
            c.id,
            y,
            m,
            r.description,
            r.amount,
            isNonFeeType(r.rewardType) ? "per_item" : r.rewardType,
            r.hours,
            r.rate,
            r.manualAmount,
            isNonFeeType(r.rewardType) ? r.rewardType : "fee",
            r.priceMode,
            r.feePriceMode,
            r.travelPriceMode,
            +r.discountEnabled,
            r.discountRate,
            +r.withholdingEnabled,
          );
          db.prepare(
            "INSERT INTO invoice_lines(id,invoice_id,billable_item_id,line_no,description,total_yen,reward_type,hours_text,rate_text,kind,price_mode,discount_enabled,discount_rate,withholding_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            lineIds.get(r.id) || randomUUID(),
            invoiceId,
            r.id,
            i,
            r.description,
            r.amount,
            isNonFeeType(r.rewardType) ? "per_item" : r.rewardType,
            r.hours,
            r.rate,
            isNonFeeType(r.rewardType) ? r.rewardType : "fee",
            r.priceMode,
            +r.discountEnabled,
            r.discountRate,
            +r.withholdingEnabled,
          );
        });
      }
      db.exec("COMMIT");
      return load(y, m);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.addHook("onRequest", async (req, reply) => {
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowed.has(req.headers.host))
      return reply
        .code(403)
        .send({ message: "この端末のURLから開いてください。" });
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      (![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
        req.headers.origin,
      ) ||
        req.headers["x-invoice-request"] !== "1")
    )
      return reply.code(403).send({ message: "送信元を確認できません。" });
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((e, req, reply) =>
    reply.code(e.statusCode || 500).send({
      message: e.statusCode
        ? e.message
        : "保存・読取に失敗しました。入力を残したまま再試行してください。",
    }),
  );
  app.get("/api/month/:year/:month", async (req) =>
    load(...period(req.params.year, req.params.month)),
  );
  app.get("/api/annual/:year", async (req) => {
    const [year] = period(req.params.year, 1);
    db.exec("BEGIN");
    try {
      const registrations = db
        .prepare(
          "SELECT client_id,target_month FROM invoices WHERE target_year=?",
        )
        .all(year);
      const months = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        data: load(year, index + 1),
        registeredIds: registrations
          .filter((r) => r.target_month === index + 1)
          .map((r) => r.client_id),
      }));
      const result = annualSummary(year, months);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  app.put("/api/month/:year/:month", async (req) =>
    save(...period(req.params.year, req.params.month), req.body),
  );
  if (existsSync(staticRoot)) {
    const assets = new Map();
    function scan(dir, prefix = "") {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) scan(join(dir, f.name), prefix + f.name + "/");
        else if (f.isFile())
          assets.set("/" + prefix + f.name, readFileSync(join(dir, f.name)));
      }
    }
    scan(staticRoot);
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0],
        key = path === "/" ? "/index.html" : path;
      const body = assets.get(key);
      if (!body) return reply.code(404).send({ message: "見つかりません。" });
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
      };
      return reply
        .type(mime[extname(key)] || "application/octet-stream")
        .send(body);
    });
  }
  app.addHook("onClose", async () => db.close());
  app.decorate("store", {
    migrationBackup,
    counts: () =>
      Object.fromEntries(
        [
          "clients",
          "billable_items",
          "invoices",
          "invoice_lines",
          "client_month_visibility",
        ].map((t) => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n]),
      ),
  });
  return app;
}
