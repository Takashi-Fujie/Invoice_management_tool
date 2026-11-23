import { test, expect, vi, afterEach } from "vitest";
import { Session } from "../src/session.mjs";
import { AutoSave } from "../src/autosave.mjs";
import { prepareMonth } from "../src/month.mjs";

afterEach(() => vi.useRealTimers());

test("S37-T03：保存待ちに複数のflushが来ても送信を直列化する", async () => {
  let finish;
  const { s, auto, api, edit } = await setup(
    (snapshot) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            companies: snapshot.companies.map((c) => ({
              ...c,
              revision: c.revision + 1,
            })),
          });
      }),
  );
  edit(200);
  auto.cancel();
  const first = auto.flush();
  edit(300);
  auto.cancel();
  const second = auto.flush(),
    third = auto.flush();
  finish();
  await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(api.save).toHaveBeenCalledTimes(2);
  finish();
  await Promise.all([first, second, third]);
  expect(s.dirty).toBe(false);
  auto.cancel();
});
const row = {
  id: "a1",
  description: "制作（架空）",
  amount: 100,
  rewardType: "per_item",
  hours: "",
  rate: "",
  manualAmount: null,
  priceMode: "inclusive",
  feePriceMode: "inclusive",
  travelPriceMode: "inclusive",
  discountEnabled: false,
  discountRate: "2",
  withholdingEnabled: false,
};
const data = () => ({
  companies: [
    {
      id: "a",
      name: "青葉制作（架空）",
      revision: 0,
      visible: true,
      rows: [structuredClone(row)],
      withholdingAmount: 0,
      invoiced: false,
      paid: false,
    },
  ],
});
async function setup(save) {
  const api = {
    load: async () => data(),
    save: vi.fn(
      save ||
        (async (draft, y, m) => ({
          companies: prepareMonth(draft, y, m).companies.map((c) => ({
            ...c,
            revision: c.revision + 1,
          })),
        })),
    ),
  };
  const s = new Session(api, new Date(2027, 0, 2));
  await s.open();
  const auto = new AutoSave(s);
  const edit = (amount) => {
    s.edit({
      companies: s.draft.companies.map((c) => ({
        ...c,
        rows: c.rows.map((r) => ({ ...r, amount })),
      })),
    });
    auto.schedule();
  };
  return { s, auto, api, edit };
}

test("S37-T01：読取と変更なしは保存せず、連続入力は最後から600ms後に全社保存", async () => {
  vi.useFakeTimers();
  const { s, auto, api, edit } = await setup();
  auto.schedule();
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).not.toHaveBeenCalled();
  edit(200);
  await vi.advanceTimersByTimeAsync(500);
  edit(300);
  await vi.advanceTimersByTimeAsync(599);
  expect(api.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save.mock.calls[0][0].companies[0].rows[0].amount).toBe(300);
  expect(s.dirty).toBe(false);
  expect(auto.error).toBe("");
  auto.schedule();
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).toHaveBeenCalledTimes(1);
});

test("S37-T02：不完全な入力・変換中・処理中は待ち、有効になれば再開、空行は画面に保持", async () => {
  vi.useFakeTimers();
  const { s, auto, api, edit } = await setup();
  edit(null);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).not.toHaveBeenCalled();
  expect(s.dirty).toBe(true);
  edit(200);
  auto.schedule(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).not.toHaveBeenCalled();
  s.busy = true;
  auto.schedule();
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).not.toHaveBeenCalled();
  s.busy = false;
  s.draft.companies[0].rows.push({
    ...row,
    id: "blank",
    description: "",
    amount: null,
  });
  auto.schedule();
  await vi.advanceTimersByTimeAsync(600);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(s.draft.companies[0].rows).toHaveLength(2);
  expect(s.dirty).toBe(false);
});

test("S37-T03：保存中の編集・新規会社を保持し、応答の更新番号で次を保存する", async () => {
  vi.useFakeTimers();
  let finish;
  const { s, auto, api, edit } = await setup(
    async (snapshot) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            companies: snapshot.companies.map((c) => ({
              ...c,
              revision: c.revision + 1,
            })),
          });
      }),
  );
  edit(200);
  await vi.advanceTimersByTimeAsync(600);
  expect(auto.saving).toBe(true);
  expect(s.busy).toBe(false);
  edit(300);
  s.draft = {
    companies: [
      ...s.draft.companies,
      { ...data().companies[0], id: "new", name: "若葉制作（架空）", rows: [] },
    ],
  };
  auto.schedule();
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).toHaveBeenCalledTimes(1);
  finish();
  await auto.wait();
  expect(s.draft.companies[0].rows[0].amount).toBe(300);
  expect(s.draft.companies[0].revision).toBe(1);
  expect(s.draft.companies[1].id).toBe("new");
  expect(s.dirty).toBe(true);
  await vi.advanceTimersByTimeAsync(600);
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1][0].companies[0].revision).toBe(1);
  finish();
  await auto.wait();
  expect(s.dirty).toBe(false);
});

test.each(["通信失敗", "別の画面で更新されています"])(
  "S37-T04：%sは入力を残して停止し、明示の再試行で再開",
  async (reason) => {
    vi.useFakeTimers();
    let fail = true;
    const { s, auto, api, edit } = await setup(async (snapshot) => {
      if (fail) throw Error(reason);
      return {
        companies: snapshot.companies.map((c) => ({
          ...c,
          revision: c.revision + 1,
        })),
      };
    });
    edit(200);
    const before = structuredClone(s.draft);
    await vi.advanceTimersByTimeAsync(600);
    expect(auto.error).toBe(reason);
    expect(s.draft).toEqual(before);
    expect(s.dirty).toBe(true);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.save).toHaveBeenCalledTimes(1);
    fail = false;
    await auto.flush();
    expect(s.dirty).toBe(false);
    expect(auto.error).toBe("");
  },
);

test("S37-T04：失敗後の入力変更で自動保存を再開する", async () => {
  vi.useFakeTimers();
  const { auto, api, edit, s } = await setup();
  api.save.mockRejectedValueOnce(Error("通信失敗"));
  edit(200);
  await vi.advanceTimersByTimeAsync(600);
  edit(300);
  await vi.advanceTimersByTimeAsync(600);
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(s.dirty).toBe(false);
});

test("S37-T05/T06：移動前のflushは保存中の応答と最新入力を待ち、重複送信しない", async () => {
  vi.useFakeTimers();
  let finish;
  const { auto, api, edit, s } = await setup(
    (snapshot) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            companies: snapshot.companies.map((c) => ({
              ...c,
              revision: c.revision + 1,
            })),
          });
      }),
  );
  edit(200);
  await vi.advanceTimersByTimeAsync(600);
  edit(300);
  auto.schedule(false);
  const moving = auto.flush();
  finish();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
  expect(api.save.mock.calls[1].slice(1)).toEqual([2027, 1]);
  finish();
  await moving;
  expect(s.dirty).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.save).toHaveBeenCalledTimes(2);
});

test("S37-T06：古い応答で切替先の入力・基準を上書きしない", async () => {
  let finish;
  const { s, auto, edit } = await setup(
    (snapshot) =>
      new Promise((resolve) => {
        finish = () => resolve(snapshot);
      }),
  );
  edit(200);
  auto.cancel();
  const saving = auto.flush();
  s.month = 2;
  s.draft = data();
  s.base = structuredClone(s.draft);
  const current = structuredClone(s.draft);
  finish();
  await saving;
  expect(s.draft).toEqual(current);
  expect(s.base).toEqual(current);
  auto.cancel();
});
