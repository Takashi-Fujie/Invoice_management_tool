const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("./redesign-2026-model.mjs");

test("S35-M09：税込金額は税抜合計＋消費税で、値引き・調整・源泉を含めず、消費税の直上に表示する", async () => {
  const { createMock, newRow, details } = await load();
  const s = createMock();
  s.draft.companies = [
    {
      id: "mix",
      name: "税込確認（架空）",
      visible: true,
      revision: 0,
      invoiced: false,
      paid: false,
      withholdingAmount: 12,
      rows: [
        {
          ...newRow("exclusive"),
          description: "税抜の報酬",
          amount: 1001,
          discountEnabled: true,
          discountRate: "10",
        },
        {
          ...newRow("inclusive"),
          description: "税込の交通費",
          rewardType: "travel",
          amount: 1101,
          priceMode: "inclusive",
        },
        {
          ...newRow("adjustment"),
          description: "調整",
          rewardType: "adjustment",
          amount: -3,
        },
      ],
    },
  ];
  const row = s.summary.rows[0];
  assert.equal(row.taxIncluded, 2202);
  assert.equal(row.net, 2002);
  assert.equal(row.tax, 200);
  assert.equal(row.gross, 2089);
  assert.equal(row.invoice, 2077);
  assert.equal(s.summary.total.taxIncluded, 2202);
  assert.equal(
    details[details.findIndex(([key]) => key === "tax") - 1][0],
    "taxIncluded",
  );
  s.save();
  const annual = s.annual();
  assert.equal(annual.rows[0].months[10].taxIncluded, 2202);
  assert.equal(annual.rows[0].total.taxIncluded, 2202);
  assert.equal(annual.total.total.taxIncluded, 2202);
});

test("S35-M09：会社別・全社の月別・年合計は会社月の税込金額を合算し、入力不備は確認表示を維持する", async () => {
  const { createMock } = await load();
  const s = createMock();
  const a = s.annual();
  for (const c of a.rows) {
    assert.equal(
      c.total.taxIncluded,
      c.months.reduce((n, m) => n + (m?.taxIncluded ?? 0), 0),
    );
    for (const m of c.months.filter(Boolean))
      assert.equal(m.taxIncluded, m.net + m.tax);
  }
  assert.equal(
    a.total.total.taxIncluded,
    a.rows.reduce((n, c) => n + c.total.taxIncluded, 0),
  );
  assert.equal(
    a.total.total.taxIncluded,
    a.total.months.reduce((n, m) => n + m.taxIncluded, 0),
  );
  s.updateRow("a", s.draft.companies[0].rows[1].id, {
    hours: "999999999",
    rate: "999999999",
  });
  assert.equal(s.summary.rows[0].taxIncluded, null);
  assert.equal(s.summary.total.taxIncluded, null);
});

test("S35-M02/M04：追加会社・会社名の変更も保存後に年間と他月へ反映する", async () => {
  const { createMock, newRow } = await load();
  const s = createMock();
  s.draft.companies[0].name = "新しい会社名（架空）";
  s.draft.companies.push({
    id: "new",
    name: "追加会社（架空）",
    visible: true,
    revision: 0,
    invoiced: false,
    paid: false,
    withholdingAmount: 0,
    rows: [{ ...newRow("new-row"), description: "制作（架空）", amount: 1000 }],
  });
  s.save();
  assert.equal(
    s.annual().rows.find((c) => c.id === "new").months[10].invoice,
    1100,
  );
  assert.equal(
    s.annual().rows.find((c) => c.id === "a").name,
    "新しい会社名（架空）",
  );
  s.move(2026, 12, "monthly");
  assert.equal(
    s.draft.companies.find((c) => c.id === "a").name,
    "新しい会社名（架空）",
  );
});

test("S35-M02/M06：架空の2社20明細から開始し、読取と再生成は未保存にならない", async () => {
  const { createMock } = await load();
  const s = createMock();
  assert.equal(s.dirty, false);
  assert.equal(s.visible().length, 2);
  assert.equal(
    s.visible().reduce((sum, c) => sum + c.rows.length, 0),
    20,
  );
  s.draft.companies[0].rows[0].description = "編集中";
  assert.equal(s.dirty, true);
  assert.equal(createMock().dirty, false);
  assert.notEqual(
    createMock().draft.companies[0].rows[0].description,
    "編集中",
  );
});
test("S35-M02：明細編集・保存で共有の月次計算が反映され、別月へ混ざらない", async () => {
  const { createMock } = await load();
  const s = createMock();
  const before = s.summary.total.invoice;
  const row = s.draft.companies[0].rows[0];
  s.updateRow("a", row.id, { amount: row.amount + 1000 });
  assert.equal(s.summary.total.invoice, before + 1100);
  assert.equal(s.dirty, true);
  s.save();
  assert.equal(s.dirty, false);
  s.move(2026, 12, "monthly");
  s.move(2026, 11, "monthly");
  assert.equal(s.summary.total.invoice, before + 1100);
});
test("S35-M02：請求済の明細編集・削除を拒否し、解除後だけ編集できる", async () => {
  const { createMock } = await load();
  const s = createMock();
  const c = s.draft.companies[1];
  assert.throws(() => s.updateRow(c.id, c.rows[0].id, { amount: 9 }), /請求済/);
  assert.throws(() => s.removeRow(c.id, c.rows[0].id), /請求済/);
  s.setCheck(c.id, "invoiced", false);
  s.updateRow(c.id, c.rows[0].id, { amount: 9000 });
  assert.equal(s.draft.companies[1].rows[0].amount, 9000);
});
test("S35-M03：未保存の移動を確認し、中止・破棄・保存の選択を分ける", async () => {
  const { createMock } = await load();
  const s = createMock();
  s.updateRow("a", s.draft.companies[0].rows[0].id, {
    description: "変更（架空）",
  });
  assert.equal(s.move(2026, 12, "monthly"), "confirm");
  assert.equal(s.month, 11);
  assert.equal(s.dirty, true);
  s.move(2026, 12, "monthly", "discard");
  s.move(2026, 11, "monthly");
  assert.notEqual(s.draft.companies[0].rows[0].description, "変更（架空）");
  s.updateRow("a", s.draft.companies[0].rows[0].id, {
    description: "保存（架空）",
  });
  s.move(2026, 11, "annual", "save");
  assert.equal(s.view, "annual");
  s.move(2026, 11, "monthly");
  assert.equal(s.draft.companies[0].rows[0].description, "保存（架空）");
});
test("S35-M03：不正な途中入力では保存・保存して移動を拒否し、入力を保持する", async () => {
  const { createMock } = await load();
  const s = createMock();
  s.updateRow("a", s.draft.companies[0].rows[0].id, { description: "" });
  assert.equal(s.valid, false);
  assert.throws(() => s.move(2026, 12, "monthly", "save"));
  assert.equal(s.month, 11);
  assert.equal(s.view, "monthly");
  assert.equal(s.dirty, true);
});
test("S35-M04：年間は保存済み月次だけを合算し、全社年合計が一致する", async () => {
  const { createMock } = await load();
  const s = createMock();
  const annual = s.annual();
  assert.equal(annual.rows[0].months[10].invoice, s.summary.rows[0].invoice);
  assert.equal(
    annual.total.total.invoice,
    annual.total.months.reduce((n, m) => n + m.invoice, 0),
  );
  assert.equal(
    annual.total.total.invoice,
    annual.rows.reduce((n, c) => n + c.total.invoice, 0),
  );
  const baseline = annual.total.total.invoice;
  s.updateRow("a", s.draft.companies[0].rows[0].id, { amount: 1 });
  assert.equal(s.annual().total.total.invoice, baseline);
  s.save();
  assert.notEqual(s.annual().total.total.invoice, baseline);
});
test("S35-M02/M06：空月の表示・会社の反映はメモリ内に留まり、保存後の月往復で保持する", async () => {
  const { createMock } = await load();
  const s = createMock();
  s.move(2027, 1, "monthly");
  assert.equal(s.visible().length, 0);
  assert.equal(s.dirty, false);
  s.draft.companies[2].visible = true;
  assert.equal(s.dirty, true);
  s.save();
  s.move(2027, 2, "monthly");
  s.move(2027, 1, "monthly");
  assert.equal(s.visible()[0].id, "c");
  assert.equal(
    createMock()
      .getMonth(2027, 1)
      .companies.every((c) => !c.visible),
    true,
  );
});
