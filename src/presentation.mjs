// 表示だけの定義。請求・税・値引きの計算値や保存データは変更しない。
export const summaryDetails = [
  ["withheld", "源泉徴収"],
  ["gross", "小計"],
  ["adjustment", "調整額"],
  ["discount", "値引き"],
  ["taxIncluded", "税込金額"],
  ["tax", "消費税（10%）"],
  ["net", "税抜合計"],
  ["expense", "立替経費"],
  ["travel", "交通費"],
  ["fee", "報酬額"],
];
export function amountValue(record, key) {
  if (key !== "taxIncluded") return record[key];
  return record.net == null || record.tax == null
    ? null
    : record.net + record.tax;
}
export function detailMoney(key, value, currency = false) {
  if (value == null) return "入力を確認";
  const amount = key === "discount" && value > 0 ? -value : value;
  return `${amount < 0 ? "-" : ""}${currency ? "¥" : ""}${Math.abs(amount).toLocaleString("ja-JP")}`;
}
export function yearChoices(year) {
  const start = Math.max(1, year - 5);
  return Array.from(
    { length: Math.min(9999, year + 5) - start + 1 },
    (_, i) => start + i,
  );
}
