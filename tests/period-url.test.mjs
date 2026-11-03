import { test, expect, vi } from "vitest";
import { PeriodSession } from "../src/period-url.mjs";
import { createApp } from "../server/app.mjs";
import { prepareMonth } from "../src/month.mjs";

const today = new Date(2026, 10, 2);
const data = (year, month) => ({
  companies: [{ id: "fictional", name: "架空会社", rows: [], year, month }],
});
// History traversal changes the URL asynchronously, then emits popstate.
// pushState/replaceState never emit it. Keep these browser semantics in the fake.
function browser(url = "http://127.0.0.1:8893/", initial = null) {
  let entries = initial?.entries ?? [{ url, state: null }],
    index = initial?.index ?? 0;
  const listeners = new Set();
  const b = {
    location: {
      get href() {
        return entries[index].url;
      },
    },
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    snapshot: () => structuredClone({ entries, index }),
    history: {
      get state() {
        return structuredClone(entries[index].state);
      },
      get length() {
        return entries.length;
      },
      replaceState(state, _, next) {
        entries[index] = {
          state: structuredClone(state),
          url: new URL(next, b.location.href).href,
        };
      },
      pushState(state, _, next) {
        entries = entries.slice(0, index + 1);
        entries.push({
          state: structuredClone(state),
          url: new URL(next, b.location.href).href,
        });
        index++;
      },
      go(delta) {
        queueMicrotask(() => {
          const next = index + delta;
          if (!delta || next < 0 || next >= entries.length) return;
          index = next;
          for (const fn of listeners) fn({ state: b.history.state });
        });
      },
    },
  };
  return b;
}
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function setup(url, patch = {}, existingBrowser) {
  const b = existingBrowser ?? browser(url);
  const loads = [],
    saves = [],
    results = [],
    errors = [];
  const s = new PeriodSession(
    {
      load: async (y, m) => {
        loads.push([y, m]);
        return patch.load ? patch.load(y, m) : data(y, m);
      },
      save: async (d, y, m) => {
        saves.push([y, m, structuredClone(d)]);
        return patch.save ? patch.save(d, y, m) : structuredClone(d);
      },
    },
    b,
    today,
  );
  s.start(async (y, m) => {
    try {
      results.push(await s.switchTo(y, m));
    } catch (e) {
      errors.push(e.message);
    }
  });
  return { s, b, loads, saves, results, errors };
}
const period = (s) => [s.year, s.month];
const query = (b) => new URL(b.location.href).search;

test("S23-T01/T04/T06：履歴移動でも元月へ一括保存し、再読込で保存内容を復元、表示だけではDBに書かない", async () => {
  const app = createApp({ path: ":memory:" });
  const headers = {
    host: "127.0.0.1:8787",
    origin: "http://127.0.0.1:8787",
    "x-invoice-request": "1",
  };
  const load = async (y, m) =>
    (await app.inject({ url: `/api/month/${y}/${m}`, headers })).json();
  const save = async (draft, y, m) => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/month/${y}/${m}`,
      headers,
      payload: prepareMonth(draft, y, m),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const { s, b } = setup("http://127.0.0.1:8893/?year=2026&month=10", {
    load,
    save,
  });
  try {
    await s.open();
    s.edit({
      companies: [
        {
          id: "fictional",
          name: "S23の架空会社",
          revision: 0,
          invoiced: false,
          paid: false,
          withholdingAmount: 0,
          rows: [
            {
              id: "fictional-oct",
              description: "10月の架空業務",
              amount: 32000,
            },
          ],
        },
      ],
    });
    await s.save();
    const before = app.store.counts();
    await s.switchTo(2026, 11);
    expect(app.store.counts()).toEqual(before);
    s.edit({
      companies: s.draft.companies.map((c) => ({
        ...c,
        visible: true,
        rows: [
          { id: "fictional-nov", description: "11月の架空業務", amount: 15000 },
        ],
      })),
    });
    b.history.go(-1);
    await settle();
    expect(query(b)).toBe("?year=2026&month=11");
    await s.switchTo(2026, 10, "save");
    expect((await load(2026, 10)).companies[0].rows[0].amount).toBe(32000);
    expect((await load(2026, 11)).companies[0].rows[0].amount).toBe(15000);
    b.history.go(1);
    await vi.waitFor(() => expect(period(s)).toEqual([2026, 11]));
    const saved = structuredClone(s.draft),
      counts = app.store.counts();
    s.stop();
    const reload = setup(
      undefined,
      { load, save },
      browser(undefined, b.snapshot()),
    );
    await reload.s.open();
    expect(period(reload.s)).toEqual([2026, 11]);
    expect(reload.s.draft).toEqual(saved);
    expect(app.store.counts()).toEqual(counts);
    reload.s.stop();
  } finally {
    s.stop();
    await app.close();
  }
});

test("S23-T02/T03：有効なURLを優先し、不正・片方・重複は両方とも端末の当月にする", async () => {
  for (const [search, expected] of [
    ["?year=2024&month=02", [2024, 2]],
    ["?year=0001&month=01", [1, 1]],
    ["?year=9999&month=12", [9999, 12]],
    ["", [2026, 11]],
    ["?year=2024", [2026, 11]],
    ["?month=2", [2026, 11]],
    ...["0", "10000", "-1", "1.5", "2e3", "２０２４", "", "2024x"].map((y) => [
      `?year=${y}&month=2`,
      [2026, 11],
    ]),
    ...["0", "13", "-1", "1.5", "1e1", "", "１２"].map((m) => [
      `?year=2024&month=${m}`,
      [2026, 11],
    ]),
    ["?year=2024&year=2025&month=2", [2026, 11]],
    ["?year=2024&month=2&month=3", [2026, 11]],
  ]) {
    const { s, b, loads, saves } = setup(`http://127.0.0.1:8893/${search}`);
    expect(period(s)).toEqual(expected);
    await s.open();
    expect(loads).toEqual([expected]);
    expect(query(b)).toBe(`?year=${expected[0]}&month=${expected[1]}`);
    expect(saves).toEqual([]);
    expect(b.history.length).toBe(1);
    s.stop();
  }
});

test("S23-T02：先頭0だけ正規化して他のクエリとハッシュ・履歴の既存情報を保持する", async () => {
  const { s, b } = setup(
    "http://127.0.0.1:8893/?view=all&year=0024&month=02#summary",
  );
  b.history.replaceState({ existing: "keep" }, "", b.location.href);
  await s.open();
  expect(b.location.href).toBe(
    "http://127.0.0.1:8893/?view=all&year=24&month=2#summary",
  );
  expect(b.history.state.existing).toBe("keep");
  expect(JSON.stringify(b.history.state)).not.toContain("架空会社");
});

test("S23-T03：初回読取失敗ではURLも履歴も変えず、同じ年月で再試行する", async () => {
  let fail = true;
  const url = "http://127.0.0.1:8893/?year=2024&month=02";
  const { s, b, loads } = setup(url, {
    load: (y, m) => {
      if (fail) throw Error("読取失敗");
      return data(y, m);
    },
  });
  await expect(s.open()).rejects.toThrow("読取失敗");
  expect(b.location.href).toBe(url);
  expect(b.history.state).toBeNull();
  fail = false;
  await s.open();
  expect(loads).toEqual([
    [2024, 2],
    [2024, 2],
  ]);
  expect(query(b)).toBe("?year=2024&month=2");
});

test("S23-T03/T06：再読み込みの初回読取失敗中に戻るを押しても元の履歴位置から再試行できる", async () => {
  const first = setup("http://127.0.0.1:8893/?year=2026&month=10");
  await first.s.open();
  await first.s.switchTo(2026, 11);
  first.s.stop();
  let fail = true;
  const { s, b, loads } = setup(
    undefined,
    {
      load: (y, m) => {
        if (fail) throw Error("初回失敗");
        return data(y, m);
      },
    },
    browser(undefined, first.b.snapshot()),
  );
  await expect(s.open()).rejects.toThrow("初回失敗");
  b.history.go(-1);
  await settle();
  expect(query(b)).toBe("?year=2026&month=11");
  expect(b.snapshot().index).toBe(1);
  expect(loads).toEqual([[2026, 11]]);
  fail = false;
  await s.open();
  b.history.go(-1);
  await settle();
  expect(period(s)).toEqual([2026, 10]);
  expect(query(b)).toBe("?year=2026&month=10");
  expect(b.history.length).toBe(2);
});

test("S23-T01/T05：成功時だけ履歴追加し、戻る・進む・再読み込みで対象月を復元する", async () => {
  const { s, b, saves } = setup("http://127.0.0.1:8893/?year=2026&month=12");
  await s.open();
  expect(await s.switchTo(2026, 12)).toBe("same");
  await s.save();
  expect(b.history.length).toBe(1);
  await s.switchTo(2027, 1);
  await s.switchTo(2027, 2);
  expect(b.history.length).toBe(3);
  b.history.go(-2);
  await settle();
  expect(period(s)).toEqual([2026, 12]);
  expect(query(b)).toBe("?year=2026&month=12");
  b.history.go(1);
  await settle();
  expect(period(s)).toEqual([2027, 1]);
  s.stop();
  const reload = setup(undefined, {}, browser(undefined, b.snapshot()));
  await reload.s.open();
  expect(period(reload.s)).toEqual([2027, 1]);
  reload.b.history.go(1);
  await settle();
  expect(period(reload.s)).toEqual([2027, 2]);
  reload.b.history.go(-2);
  await settle();
  expect(period(reload.s)).toEqual([2026, 12]);
  expect(reload.b.history.length).toBe(3);
  expect(saves).toHaveLength(1);
});

test("S23-T04：画面操作の中止・保存失敗・読取失敗で元のURL・入力を保持する", async () => {
  let readFail = false,
    saveFail = false;
  const { s, b, saves } = setup("http://127.0.0.1:8893/?year=2026&month=10", {
    load: (y, m) => {
      if (readFail) throw Error("読取失敗");
      return data(y, m);
    },
    save: (d) => {
      if (saveFail) throw Error("保存失敗");
      return structuredClone(d);
    },
  });
  await s.open();
  s.edit({ companies: [{ name: "未保存の架空会社" }] });
  const draft = structuredClone(s.draft);
  expect(await s.switchTo(2026, 11)).toBe("confirm");
  s.cancelSwitch();
  expect(query(b)).toBe("?year=2026&month=10");
  expect(s.draft).toEqual(draft);
  saveFail = true;
  await expect(s.switchTo(2026, 11, "save")).rejects.toThrow("保存失敗");
  expect(s.dirty).toBe(true);
  readFail = true;
  await expect(s.switchTo(2026, 11, "discard")).rejects.toThrow("読取失敗");
  expect(s.draft).toEqual(draft);
  saveFail = false;
  await expect(s.switchTo(2026, 11, "save")).rejects.toThrow("読取失敗");
  expect(s.dirty).toBe(false);
  expect(period(s)).toEqual([2026, 10]);
  expect(query(b)).toBe("?year=2026&month=10");
  expect(b.history.length).toBe(1);
  expect(saves.every(([y, m]) => y === 2026 && m === 10)).toBe(true);
});

test("S23-T06：未保存時の戻るを中止しても元の履歴位置を保ち、再操作で破棄・進むが使える", async () => {
  const { s, b, results, loads, saves } = setup(
    "http://127.0.0.1:8893/?year=2026&month=10",
  );
  await s.open();
  await s.switchTo(2026, 11);
  s.edit({ companies: [{ name: "保持する架空会社" }] });
  const draft = structuredClone(s.draft),
    count = loads.length;
  b.history.go(-1);
  await settle();
  expect(results).toEqual(["confirm"]);
  expect(query(b)).toBe("?year=2026&month=11");
  expect(b.snapshot().index).toBe(1);
  expect(loads).toHaveLength(count);
  s.cancelSwitch();
  expect(s.draft).toEqual(draft);
  b.history.go(-1);
  await settle();
  await s.switchTo(2026, 10, "discard");
  expect(b.snapshot().index).toBe(0);
  expect(period(s)).toEqual([2026, 10]);
  b.history.go(1);
  await settle();
  expect(period(s)).toEqual([2026, 11]);
  expect(b.history.length).toBe(2);
  expect(saves).toEqual([]);
});

test("S23-T06：履歴移動の保存は元月へ送り、失敗後も確認から再試行できる", async () => {
  let fail = true;
  const { s, b, saves } = setup("http://127.0.0.1:8893/?year=2026&month=10", {
    save: (d) => {
      if (fail) throw Error("保存失敗");
      return d;
    },
  });
  await s.open();
  await s.switchTo(2026, 11);
  s.edit({ companies: [{ name: "保存する架空会社" }] });
  b.history.go(-1);
  await settle();
  await expect(s.switchTo(2026, 10, "save")).rejects.toThrow("保存失敗");
  expect(query(b)).toBe("?year=2026&month=11");
  expect(s.dirty).toBe(true);
  fail = false;
  await s.switchTo(2026, 10, "save");
  expect(saves.map(([y, m]) => [y, m])).toEqual([
    [2026, 11],
    [2026, 11],
  ]);
  expect(query(b)).toBe("?year=2026&month=10");
  expect(b.snapshot().index).toBe(0);
  expect(b.history.length).toBe(2);
});

test("S23-T06：履歴の読取失敗でも元位置に留まり、再操作で成功できる", async () => {
  let fail = false;
  const { s, b, errors } = setup("http://127.0.0.1:8893/?year=2026&month=10", {
    load: (y, m) => {
      if (fail) throw Error("読取失敗");
      return data(y, m);
    },
  });
  await s.open();
  await s.switchTo(2026, 11);
  const before = structuredClone(s.draft);
  fail = true;
  b.history.go(-1);
  await settle();
  expect(errors).toEqual(["読取失敗"]);
  expect(period(s)).toEqual([2026, 11]);
  expect(query(b)).toBe("?year=2026&month=11");
  expect(s.draft).toEqual(before);
  fail = false;
  b.history.go(-1);
  await settle();
  expect(period(s)).toEqual([2026, 10]);
  expect(b.snapshot().index).toBe(0);
});

test("S23-T06：確認中の追加の履歴操作は抑止し、選択した移動先を変えない", async () => {
  const { s, b, results } = setup("http://127.0.0.1:8893/?year=2026&month=9");
  await s.open();
  await s.switchTo(2026, 10);
  await s.switchTo(2026, 11);
  s.edit({ companies: [{ name: "未保存の架空会社" }] });
  b.history.go(-1);
  await settle();
  b.history.go(-2);
  await settle();
  expect(results).toEqual(["confirm"]);
  expect(b.snapshot().index).toBe(2);
  expect(query(b)).toBe("?year=2026&month=11");
  await s.switchTo(2026, 10, "discard");
  expect(b.snapshot().index).toBe(1);
  expect(period(s)).toEqual([2026, 10]);
});

test("S23-T06：通信中の履歴操作でも途中の月へ誤移動・履歴追加しない", async () => {
  let resolve;
  const { s, b, results } = setup("http://127.0.0.1:8893/?year=2026&month=9", {
    load: (y, m) =>
      m === 11
        ? new Promise((r) => {
            resolve = () => r(data(y, m));
          })
        : data(y, m),
  });
  await s.open();
  await s.switchTo(2026, 10);
  const moving = s.switchTo(2026, 11);
  b.history.go(-1);
  await settle();
  expect(query(b)).toBe("?year=2026&month=10");
  expect(results).toEqual([]);
  resolve();
  await moving;
  expect(query(b)).toBe("?year=2026&month=11");
  expect(b.history.length).toBe(3);
  b.history.go(-1);
  await settle();
  expect(period(s)).toEqual([2026, 10]);
});

test("S23-T05：同じ年月が履歴に複数あっても正しい位置へ移動し、そこからの切替で分岐できる", async () => {
  const { s, b } = setup("http://127.0.0.1:8893/?year=2026&month=10");
  await s.open();
  await s.switchTo(2026, 11);
  await s.switchTo(2026, 10);
  b.history.go(-2);
  await settle();
  expect(b.snapshot().index).toBe(0);
  await s.switchTo(2026, 12);
  expect(b.history.length).toBe(2);
  b.history.go(-1);
  await settle();
  expect(period(s)).toEqual([2026, 10]);
});
