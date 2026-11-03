import { test, expect } from "vitest";
import { amountText } from "../src/amount.mjs";
test("報酬額は表示時だけ3桁区切り、編集時はカンマなし", () => {
  for (const [raw, display] of [
    ["1000", "1,000"],
    ["1234567", "1,234,567"],
    ["999999999", "999,999,999"],
    ["999", "999"],
    ["0", "0"],
    ["", ""],
  ]) {
    expect(amountText(raw, false)).toBe(display);
    expect(amountText(raw, true)).toBe(raw);
  }
});
test("表示切替が保存値を変更せず、不正な入力を数字へ読み替えない", () => {
  const row = { amount: 1234567 };
  amountText(String(row.amount), false);
  amountText(String(row.amount), true);
  expect(row.amount).toBe(1234567);
  expect(typeof row.amount).toBe("number");
  expect(amountText("1.5", false)).toBe("1.5");
  expect(amountText("abc", false)).toBe("abc");
});
