import { test, expect, vi } from "vitest";
import { Session } from "../src/session.mjs";
import { AutoSave } from "../src/autosave.mjs";
import { TabSync } from "../src/tab-sync.mjs";

test("S38-T02：復元で更新番号が同じになってもDB世代が違えば古い入力の保存を止める", async () => {
  const { s, tabs, auto, remote } = await setup();
  s.draft.databaseGeneration = "before-restore";
  s.base = structuredClone(s.draft);
  s.edit({
    ...s.draft,
    companies: [{ ...s.draft.companies[0], name: "編集中（架空）" }],
  });
  remote({ ...data(0), databaseGeneration: "after-restore" });
  expect(await tabs.check()).toBe("conflict");
  expect(s.draft.databaseGeneration).toBe("before-restore");
  await expect(auto.flush()).rejects.toThrow(/別タブ/);
  expect(await tabs.check()).toBe("conflict");
});

test("S38-T05：確認通信の失敗後、更新なしを確認できれば保存停止を解除する", async () => {
  const { tabs, auto, api } = await setup();
  api.load.mockRejectedValueOnce(Error("通信失敗"));
  expect(await tabs.check()).toBe("failed");
  expect(auto.blocked).not.toBe("");
  expect(await tabs.check()).toBe("unchanged");
  expect(auto.blocked).toBe("");
});
const data = (revision) => ({
  companies: [
    {
      id: "a",
      name: "青葉制作（架空）",
      revision,
      visible: true,
      rows: [],
      withholdingAmount: 0,
      invoiced: false,
      paid: false,
    },
  ],
});
async function setup() {
  let latest = data(0);
  const api = {
    load: vi.fn(async () => structuredClone(latest)),
    save: vi.fn(async (d) => d),
  };
  const s = new Session(api, new Date(2027, 0, 2));
  await s.open();
  const auto = new AutoSave(s);
  const tabs = new TabSync(s, auto);
  return {
    s,
    auto,
    tabs,
    api,
    remote: (d) => {
      latest = d;
    },
  };
}
test("S38-T01/T05：未編集だけ最新の内容と更新番号へ自動更新し、書込みはしない", async () => {
  const { s, tabs, api, remote } = await setup();
  expect(await tabs.check()).toBe("unchanged");
  const next = data(1);
  next.companies[0].name = "若葉制作（架空）";
  remote(next);
  expect(await tabs.check()).toBe("updated");
  expect(s.draft).toEqual(next);
  expect(s.base).toEqual(next);
  expect(s.dirty).toBe(false);
  expect(tabs.notice).toMatch(/反映/);
  expect(api.save).not.toHaveBeenCalled();
});
test("S38-T02：未保存入力は上書きせず、自動・明示保存を止める", async () => {
  const { s, tabs, auto, remote, api } = await setup();
  s.edit({ companies: [{ ...s.draft.companies[0], name: "編集中（架空）" }] });
  const before = structuredClone(s.draft);
  remote(data(1));
  expect(await tabs.check()).toBe("conflict");
  expect(s.draft).toEqual(before);
  expect(s.base.companies[0].revision).toBe(0);
  expect(auto.blocked).toMatch(/別タブ/);
  await expect(auto.flush()).rejects.toThrow(/別タブ/);
  expect(api.save).not.toHaveBeenCalled();
});
test("S38-T03：処理中・モーダル操作中は確認を保留し、終了後に再確認する", async () => {
  const { s, tabs, remote, api } = await setup();
  remote(data(1));
  s.busy = true;
  expect(await tabs.check()).toBe("deferred");
  expect(tabs.pending).toBe(true);
  s.busy = false;
  tabs.canRefresh = () => false;
  expect(await tabs.check()).toBe("deferred");
  expect(api.load).toHaveBeenCalledTimes(1);
  tabs.canRefresh = () => true;
  expect(await tabs.check()).toBe("updated");
  expect(tabs.pending).toBe(false);
});
test("S38-T03：確認中の月変更では古い応答を適用しない", async () => {
  const { s, tabs, api } = await setup();
  let finish;
  api.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const checking = tabs.check();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  s.month = 2;
  const current = structuredClone(s.draft);
  finish(data(1));
  expect(await checking).toBe("deferred");
  expect(s.draft).toEqual(current);
  expect(tabs.pending).toBe(true);
});
test("S38-T04/T05：確認失敗・再読込失敗で入力を保持し、再読込成功後だけ停止を解除", async () => {
  const { s, tabs, auto, api, remote } = await setup();
  s.edit({ companies: [{ ...s.draft.companies[0], name: "編集中（架空）" }] });
  const before = structuredClone(s.draft);
  api.load.mockRejectedValueOnce(Error("通信失敗"));
  expect(await tabs.check()).toBe("failed");
  expect(s.draft).toEqual(before);
  expect(auto.blocked).toMatch(/確認できません/);
  api.load.mockRejectedValueOnce(Error("通信失敗"));
  await expect(tabs.reload()).rejects.toThrow();
  expect(s.draft).toEqual(before);
  expect(auto.blocked).not.toBe("");
  remote(data(1));
  await tabs.reload();
  expect(s.draft).toEqual(data(1));
  expect(auto.blocked).toBe("");
  expect(s.dirty).toBe(false);
});
