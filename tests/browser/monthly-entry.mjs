// npm run build後、Playwrightを利用できる環境でnode --test tests/browser/monthly-entry.mjsを実行する。
// PLAYWRIGHT_MODULEで環境に備わるPlaywrightのモジュールパスを指定できる。
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.mjs";
import { prepareMonth } from "../../src/month.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const port = Number(process.env.INVOICE_BROWSER_TEST_PORT || 18876);
const url = `http://127.0.0.1:${port}`;
let app, browser, page;
const company = "青葉制作（架空）";
const row = (id, description, rewardType = "per_item") => ({
  id,
  description,
  amount: rewardType === "hourly" ? 4502 : 100,
  rewardType,
  hours: rewardType === "hourly" ? "1.5" : "",
  rate: rewardType === "hourly" ? "3001" : "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: false,
});
const fixture = () => ({
  companies: [
    {
      id: "a",
      name: company,
      revision: 0,
      visible: true,
      rows: [row("a1", "取材（架空）", "hourly"), row("a2", "制作（架空）")],
      withholdingAmount: 0,
      invoiced: false,
      paid: false,
    },
  ],
});
const headers = {
  host: `127.0.0.1:${port}`,
  origin: url,
  "x-invoice-request": "1",
};
const loaded = async () =>
  (await app.inject({ url: "/api/month/2027/1", headers })).json();
const open = async () => {
  await page.goto(url + "/?year=2027&month=1");
  await page.getByRole("table", { name: `${company}の報酬明細` }).waitFor();
};
const saved = async () => {
  await page
    .locator("#mm-save-status strong")
    .filter({ hasText: /^保存済み$/ })
    .waitFor({ timeout: 8000 });
};
before(async () => {
  app = createApp({ path: ":memory:", port });
  const seeded = await app.inject({
    method: "PUT",
    url: "/api/month/2027/1",
    headers,
    payload: prepareMonth(fixture(), 2027, 1),
  });
  assert.equal(seeded.statusCode, 200);
  await app.listen({ host: "127.0.0.1", port });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1252, height: 800 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
});
after(async () => {
  await browser?.close();
  await app?.close();
});

test("S35-T08：月次・年間・バックアップの下端はバージョン0.2.0", async () => {
  for (const path of [
    "/?year=2027&month=1",
    "/annual.html?year=2027",
    "/backup.html?year=2027&month=1",
  ]) {
    await page.goto(url + path);
    await page.getByText("バージョン 0.2.0", { exact: true }).waitFor();
    assert.equal(await page.locator(".app-version").count(), 1);
  }
});

test("S38-T01/T02/T04：2タブで未編集は自動反映、編集中は警告と停止、確認後だけ最新を読込む", async () => {
  await open();
  const other = await page.context().newPage();
  try {
    await other.goto(url + "/?year=2027&month=1");
    const label = `${company}の1行目の業務内容`;
    const remoteField = other.getByLabel(label, { exact: true });
    await remoteField.waitFor();
    await page.getByLabel(label, { exact: true }).fill("別タブの保存1（架空）");
    await saved();
    await other.waitForFunction(
      (label) =>
        document.querySelector(`[aria-label="${label}"]`)?.value ===
        "別タブの保存1（架空）",
      label,
    );
    assert.match(await other.locator(".tab-notice").innerText(), /反映/);
    await remoteField.fill("");
    await page.getByLabel(label, { exact: true }).fill("別タブの保存2（架空）");
    await saved();
    await other.locator(".tab-notice.is-warning").waitFor();
    assert.equal(await remoteField.inputValue(), "");
    await other.waitForTimeout(1100);
    assert.equal(
      (await loaded()).companies[0].rows[0].description,
      "別タブの保存2（架空）",
    );
    await other
      .getByRole("button", { name: "最新データを読み込む", exact: true })
      .click();
    await other.getByRole("button", { name: "中止", exact: true }).click();
    assert.equal(await remoteField.inputValue(), "");
    await other
      .getByRole("button", { name: "最新データを読み込む", exact: true })
      .click();
    await other
      .getByRole("button", {
        name: "未保存入力を破棄して読み込む",
        exact: true,
      })
      .click();
    await other.waitForFunction(
      (label) =>
        document.querySelector(`[aria-label="${label}"]`)?.value ===
        "別タブの保存2（架空）",
      label,
    );
    assert.equal(await other.locator(".tab-notice.is-warning").count(), 0);
  } finally {
    await other.close();
  }
});

test("S36-T05：各画面幅で横スクロールバーと最終行の入力を分離する", async () => {
  await open();
  for (const width of [1512, 1252, 800, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await page.locator(".detail-scroll").evaluate((el) => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      gap:
        el.getBoundingClientRect().top +
        el.clientHeight -
        el.querySelector("tbody tr:last-child").getBoundingClientRect().bottom,
      scrollable: el.scrollWidth > el.clientWidth,
    }));
    assert.ok(
      metrics.width <= metrics.viewport,
      JSON.stringify({ width, ...metrics }),
    );
    assert.ok(metrics.gap >= 23.5, JSON.stringify({ width, ...metrics }));
    if (width <= 800) assert.ok(metrics.scrollable);
    const description = page.getByLabel(`${company}の2行目の業務内容`, {
      exact: true,
    });
    await description.click();
    assert.equal(
      await description.evaluate((el) => el === document.activeElement),
      true,
    );
  }
});

test("S36-T06：単価→時間の列順と4502円の表示・保存値を保持する", async () => {
  await page.setViewportSize({ width: 1252, height: 800 });
  await open();
  const table = page.getByRole("table", { name: `${company}の報酬明細` });
  const headings = await table.locator("thead th").allTextContents();
  assert.deepEqual(headings.slice(3, 5), ["単価（円）", "時間（h）"]);
  const labels = await table
    .locator("tbody tr")
    .first()
    .locator("td input")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  assert.ok(
    labels.indexOf(`${company}の1行目の単価（円）`) <
      labels.indexOf(`${company}の1行目の時間`),
  );
  assert.equal(
    await page
      .getByLabel(`${company}の1行目の単価（円）`, { exact: true })
      .inputValue(),
    "3001",
  );
  assert.equal(
    await page
      .getByLabel(`${company}の1行目の時間`, { exact: true })
      .inputValue(),
    "1.5",
  );
  assert.equal((await loaded()).companies[0].rows[0].amount, 4502);
});

test("S37-T02：日本語変換中は保存せず、変換確定後に自動保存する", async () => {
  await open();
  const field = page.getByLabel(`${company}の1行目の業務内容`, { exact: true });
  const before = (await loaded()).companies[0].rows[0].description;
  await field.dispatchEvent("compositionstart", { data: "" });
  await field.fill("変換確認（架空）");
  await page.waitForTimeout(1100);
  assert.equal((await loaded()).companies[0].rows[0].description, before);
  await field.dispatchEvent("compositionend", { data: "変換確認（架空）" });
  await saved();
  assert.equal(
    (await loaded()).companies[0].rows[0].description,
    "変換確認（架空）",
  );
});

test("S37-T05：年間・バックアップへの移動前に保存し、入力不備の月移動は中止・破棄できる", async () => {
  for (const [name, path] of [
    ["年間集計", "/annual.html"],
    ["バックアップ・復元", "/backup.html"],
  ]) {
    await open();
    await page
      .getByLabel(`${company}の1行目の業務内容`, { exact: true })
      .fill(`${name}へ移動（架空）`);
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForURL((u) => u.pathname === path);
    assert.equal(
      (await loaded()).companies[0].rows[0].description,
      `${name}へ移動（架空）`,
    );
  }
  await open();
  const field = page.getByLabel(`${company}の1行目の業務内容`, { exact: true });
  const before = (await loaded()).companies[0].rows[0].description;
  await field.fill("");
  await page.getByRole("button", { name: "翌月へ", exact: true }).click();
  await page.getByRole("button", { name: "切替を中止", exact: true }).click();
  assert.equal(await field.inputValue(), "");
  assert.equal((await loaded()).companies[0].rows[0].description, before);
  await page.getByRole("button", { name: "翌月へ", exact: true }).click();
  await page.getByRole("button", { name: "破棄して切替", exact: true }).click();
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("month") === "2",
  );
  await open();
  assert.equal(await field.inputValue(), before);
});

test("S36-T03/S37-T07：上下移動を自動保存し、再読込でID・条件・順序を保持する", async () => {
  await open();
  await page
    .getByRole("button", {
      name: `${company}の2行目をドラッグして並び替え`,
      exact: true,
    })
    .dragTo(page.locator(".detail-table tbody tr").first(), {
      targetPosition: { x: 25, y: 1 },
    });
  await saved();
  assert.deepEqual(
    (await loaded()).companies[0].rows.map((r) => r.id),
    ["a2", "a1"],
  );
  await open();
  assert.equal(
    await page
      .getByLabel(`${company}の2行目の単価（円）`, { exact: true })
      .inputValue(),
    "3001",
  );
  assert.equal(
    await page.getByRole("button", { name: "変更を保存", exact: true }).count(),
    0,
  );
});

test("S36-T02/T07：ドラッグ中は保存を待ち、Esc・左右の範囲外では並び順を変更しない", async () => {
  await open();
  await page
    .locator(".detail-scroll tbody tr")
    .first()
    .locator('input[type="checkbox"]')
    .check();
  await saved();
  const before = (await loaded()).companies[0].rows;
  await page
    .getByLabel(`${company}の1行目の業務内容`, { exact: true })
    .fill("ドラッグ中は待機（架空）");
  const handle = await page.locator(".drag-row").first().boundingBox();
  const last = await page
    .locator(".detail-table tbody tr")
    .last()
    .boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, last.y + last.height - 2, {
    steps: 8,
  });
  await page.locator('tr[data-drop="after"]').waitFor();
  const floating = page.locator(".row-drag-preview");
  await floating.waitFor();
  assert.equal(await floating.getAttribute("aria-hidden"), "true");
  assert.equal(await floating.evaluate((el) => el.inert), true);
  assert.equal(
    await floating
      .locator("input,select,button")
      .evaluateAll((els) => els.every((el) => el.tabIndex === -1)),
    true,
  );
  assert.equal(
    await floating.locator('input[type="text"]').first().inputValue(),
    "ドラッグ中は待機（架空）",
  );
  const originalRow = page.locator(".detail-scroll tbody tr").first();
  const inputValues = (row) =>
    row.locator("input,select").evaluateAll((els) =>
      els.map((el) => ({
        value: el.value,
        checked: el.type === "checkbox" ? el.checked : null,
      })),
    );
  assert.deepEqual(await inputValues(floating), await inputValues(originalRow));
  assert.equal(
    await floating.evaluate((el) => getComputedStyle(el).pointerEvents),
    "none",
  );
  const lifted = await floating.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    last.y + last.height - 10,
    { steps: 3 },
  );
  const moved = await floating.boundingBox();
  assert.ok(Math.abs(moved.y - lifted.y + 8) < 1);
  if (process.env.INVOICE_SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.INVOICE_SCREENSHOT_PATH.replace(/\.png$/, "-held.png"),
    });
  await page.waitForTimeout(900);
  assert.deepEqual((await loaded()).companies[0].rows, before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await floating.count(), 0);
  await saved();
  assert.deepEqual(
    (await loaded()).companies[0].rows.map((r) => r.id),
    before.map((r) => r.id),
  );
  const current = await loaded();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    (await page.locator(".detail-scroll").first().boundingBox()).x - 6,
    last.y + last.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.equal(await floating.count(), 0);
  await page.waitForTimeout(800);
  assert.deepEqual(await loaded(), current);
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, last.y + last.height - 2, {
    steps: 4,
  });
  await floating.waitFor();
  await page
    .locator(".detail-scroll .drag-row")
    .first()
    .dispatchEvent("pointercancel");
  await page.mouse.up();
  assert.equal(await floating.count(), 0);
  assert.deepEqual(await loaded(), current);
});

test("S36-T02/T07：つまみの上下キーと請求済の無効化", async () => {
  await open();
  const before = (await loaded()).companies[0].rows.map((r) => r.id);
  const handle = page.locator(`[data-row-id="${before[1]}"] .drag-row`);
  await handle.focus();
  await handle.press("ArrowUp");
  await saved();
  assert.deepEqual(
    (await loaded()).companies[0].rows.map((r) => r.id),
    [...before].reverse(),
  );
  await handle.press("ArrowDown");
  await saved();
  assert.deepEqual(
    (await loaded()).companies[0].rows.map((r) => r.id),
    before,
  );
  await page.getByLabel(`${company}の請求済`, { exact: true }).check();
  await saved();
  assert.equal(await page.locator(".drag-row:not(:disabled)").count(), 0);
  await page.getByLabel(`${company}の請求済`, { exact: true }).uncheck();
  await saved();
});

test("S36-T07：390pxのタッチ操作でもドラッグ後に順序を保存する", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await context.newPage();
  try {
    await mobile.goto(url + "/?year=2027&month=1");
    const first = mobile.locator(".drag-row").first();
    await first.waitFor();
    const before = (await loaded()).companies[0].rows.map((r) => r.id);
    const source = await first.boundingBox(),
      target = await mobile
        .locator(".detail-table tbody tr")
        .last()
        .boundingBox();
    const cdp = await context.newCDPSession(mobile);
    const x = source.x + source.width / 2,
      startY = source.y + source.height / 2,
      endY = target.y + target.height + 20;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= 8; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: startY + ((endY - startY) * step) / 8 }],
      });
    const floating = mobile.locator(".row-drag-preview");
    await floating.waitFor();
    const bounds = await floating.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.deepEqual(
      await floating
        .locator("input,select")
        .evaluateAll((els) => els.map((el) => el.value)),
      await mobile
        .locator(".detail-scroll tbody tr")
        .first()
        .locator("input,select")
        .evaluateAll((els) => els.map((el) => el.value)),
    );
    if (process.env.INVOICE_SCREENSHOT_PATH)
      await mobile.screenshot({
        path: process.env.INVOICE_SCREENSHOT_PATH.replace(
          /\.png$/,
          "-touch-held.png",
        ),
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(await floating.count(), 0);
    await mobile
      .locator("#mm-save-status strong")
      .filter({ hasText: /^保存済み$/ })
      .waitFor();
    assert.deepEqual(
      (await loaded()).companies[0].rows.map((r) => r.id),
      [...before].reverse(),
    );
  } finally {
    await context.close();
  }
});

test("S37-T02/T04：入力途中・通信失敗で入力を残し、再試行で保存する", async () => {
  await open();
  const field = page.getByLabel(`${company}の1行目の業務内容`, { exact: true });
  const original = (await loaded()).companies[0].rows[0].description;
  await field.fill("");
  await page.waitForTimeout(1100);
  assert.equal((await loaded()).companies[0].rows[0].description, original);
  assert.match(await page.locator("#mm-save-status").innerText(), /入力を確認/);
  await page.route(
    "**/api/month/2027/1",
    async (route) =>
      route.request().method() === "PUT"
        ? route.abort("failed")
        : route.continue(),
    { times: 1 },
  );
  await field.fill("通信失敗確認（架空）");
  await page.getByText("自動保存に失敗しました", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "通信失敗確認（架空）");
  assert.equal((await loaded()).companies[0].rows[0].description, original);
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await saved();
  assert.equal(
    (await loaded()).companies[0].rows[0].description,
    "通信失敗確認（架空）",
  );
});

test("S37-T03/T05：保存中も編集でき、最新の入力を保存してから月移動・履歴復帰する", async () => {
  await open();
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const requestStarted = new Promise((resolve) => {
    started = resolve;
  });
  await page.route(
    "**/api/month/2027/1",
    async (route) => {
      if (route.request().method() === "PUT") {
        started();
        await gate;
      }
      await route.continue();
    },
    { times: 1 },
  );
  const field = page.getByLabel(`${company}の1行目の業務内容`, { exact: true });
  await field.fill("保存開始（架空）");
  await Promise.race([
    requestStarted,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("自動保存リクエスト未発行")), 5000),
    ),
  ]);
  assert.equal(await field.isEnabled(), true);
  await field.fill("保存中の最新入力（架空）");
  release();
  await saved();
  assert.equal(
    (await loaded()).companies[0].rows[0].description,
    "保存中の最新入力（架空）",
  );
  await field.fill("月移動直前（架空）");
  await page.getByRole("button", { name: "翌月へ", exact: true }).click();
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("month") === "2",
  );
  assert.equal(
    (await loaded()).companies[0].rows[0].description,
    "月移動直前（架空）",
  );
  await page.goBack();
  await field.waitFor();
  assert.equal(await field.inputValue(), "月移動直前（架空）");
  if (process.env.INVOICE_SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.INVOICE_SCREENSHOT_PATH,
      fullPage: true,
    });
});

test("S36-T09：上下端から1・24・60pxはみ出しても先頭・末尾へ移動し、別会社へのドロップは中止", async () => {
  await open();
  const table = page.getByRole("table", {
    name: `${company}の報酬明細`,
    exact: true,
  });
  const move = async (source, x, y, marker) => {
    const bounds = await source.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    try {
      await table.locator(`tr[data-drop="${marker}"]`).waitFor();
    } catch (error) {
      const area = await page.locator(".company-card").evaluateAll((cards) =>
        cards.map((card) => {
          const r = card.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
      );
      throw Error(JSON.stringify({ x, y, marker, companyBounds: area }), {
        cause: error,
      });
    }
    await page.mouse.up();
    await saved();
  };
  for (const overshoot of [1, 24, 60]) {
    const before = (await loaded()).companies[0].rows.map((r) => r.id);
    let first = await table.locator("tbody tr").first().boundingBox();
    const lastHandle = table.locator(".drag-row").last();
    const grip = await lastHandle.boundingBox();
    await move(
      lastHandle,
      grip.x + grip.width / 2,
      first.y - overshoot,
      "before",
    );
    assert.deepEqual(
      (await loaded()).companies[0].rows.map((r) => r.id),
      [...before].reverse(),
    );
    const last = await table.locator("tbody tr").last().boundingBox();
    const firstHandle = table.locator(".drag-row").first();
    const start = await firstHandle.boundingBox();
    await move(
      firstHandle,
      start.x + start.width / 2,
      last.y + last.height + overshoot,
      "after",
    );
    assert.deepEqual(
      (await loaded()).companies[0].rows.map((r) => r.id),
      before,
    );
  }
  const initial = await loaded();
  initial.companies.push({
    id: "b",
    name: "若葉制作（架空）",
    revision: 0,
    visible: true,
    rows: [
      row("b1", "別会社の制作1（架空）"),
      row("b2", "別会社の制作2（架空）"),
    ],
    withholdingAmount: 0,
    invoiced: false,
    paid: false,
  });
  const seeded = await app.inject({
    method: "PUT",
    url: "/api/month/2027/1",
    headers,
    payload: prepareMonth(initial, 2027, 1),
  });
  assert.equal(seeded.statusCode, 200);
  await open();
  const before = await loaded();
  const source = await table.locator(".drag-row").first().boundingBox();
  const other = await page
    .getByRole("table", { name: "若葉制作（架空）の報酬明細", exact: true })
    .locator("tbody tr")
    .first()
    .boundingBox();
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2,
    other.y + other.height / 2,
    { steps: 8 },
  );
  assert.equal(await table.locator("tr[data-drop]").count(), 0);
  await page.mouse.up();
  await page.waitForTimeout(800);
  assert.deepEqual(await loaded(), before);
});
