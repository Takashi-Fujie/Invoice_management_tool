export const isExpenseType = (type) => type === "travel" || type === "expense";
export const isNonFeeType = (type) =>
  isExpenseType(type) || type === "adjustment";
export function validRowAmount(amount, type) {
  return (
    Number.isSafeInteger(amount) &&
    Math.abs(amount) <= MAX_AMOUNT &&
    (type === "adjustment" || amount >= 0)
  );
}
export const MAX_AMOUNT = 999999999;
const decimalPattern = /^[0-9]+(?:\.[0-9]*)?$/;
export function validDecimal(value, empty = true) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    ((empty && value === "") || decimalPattern.test(value))
  );
}
export function acceptDecimal(previous, next) {
  return validDecimal(next) ? next : previous;
}
export function hourlyAmount(hours, rate) {
  if (!validDecimal(hours, false) || !validDecimal(rate, false)) return null;
  const parts = (text) => {
    const [whole, fraction = ""] = text.split(".");
    return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
  };
  const [h, hd] = parts(hours),
    [r, rd] = parts(rate),
    denominator = hd * rd;
  const yen = (h * r + denominator - 1n) / denominator;
  return yen <= BigInt(MAX_AMOUNT) ? Number(yen) : null;
}
export function defaultDiscountRate(year = 2026, month = 10) {
  return year < 2026 || (year === 2026 && month < 10) ? "1.3" : "2";
}
function parseDiscountRate(value) {
  if (!validDecimal(value, false)) return null;
  const [whole, fraction = ""] = value.split("."),
    n = BigInt(whole + fraction),
    d = 10n ** BigInt(fraction.length);
  if (n > 100n * d) return null;
  const tail = fraction.replace(/0+$/, "");
  return { n, d, key: String(BigInt(whole)) + (tail ? "." + tail : "") };
}
export function acceptDiscountRate(previous, next) {
  return next === "" || parseDiscountRate(next) ? next : previous;
}
export function discountConditions(row, year, month) {
  return {
    discountEnabled:
      row.discountEnabled === undefined ? false : row.discountEnabled,
    discountRate:
      row.discountRate === undefined
        ? defaultDiscountRate(year, month)
        : row.discountRate,
  };
}
export function taxConditions(row) {
  const priceMode = row.priceMode === undefined ? "inclusive" : row.priceMode;
  return {
    priceMode,
    feePriceMode:
      row.feePriceMode === undefined
        ? isExpenseType(row.rewardType)
          ? "exclusive"
          : priceMode
        : row.feePriceMode,
    travelPriceMode:
      row.travelPriceMode === undefined
        ? isExpenseType(row.rewardType)
          ? priceMode
          : "inclusive"
        : row.travelPriceMode,
  };
}
export function normalizeWithholdingAmount(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT)
    throw Error("源泉徴収額は0〜999,999,999円の整数で入力してください。");
  return value;
}
export function changeReward(row, patch) {
  const next = {
    rewardType: "per_item",
    hours: "",
    rate: "",
    manualAmount: null,
    withholdingEnabled: false,
    ...row,
    ...taxConditions(row),
    ...discountConditions(row),
    ...patch,
  };
  const oldTax = taxConditions(row);
  if (patch.rewardType && patch.rewardType !== row.rewardType) {
    next[isExpenseType(row.rewardType) ? "travelPriceMode" : "feePriceMode"] =
      oldTax.priceMode;
    next.priceMode =
      next[
        isExpenseType(patch.rewardType) ? "travelPriceMode" : "feePriceMode"
      ];
    if ((row.rewardType || "per_item") !== "hourly")
      next.manualAmount = row.amount;
    if (patch.rewardType !== "hourly") next.amount = next.manualAmount ?? null;
  }
  if (patch.priceMode !== undefined) {
    next.priceMode = patch.priceMode;
    next[isExpenseType(next.rewardType) ? "travelPriceMode" : "feePriceMode"] =
      patch.priceMode;
  }
  if (next.rewardType === "hourly")
    next.amount = hourlyAmount(next.hours, next.rate);
  return next;
}
export function blankRow(row) {
  return (
    row.description === "" &&
    row.amount === null &&
    !(row.hours || row.rate) &&
    row.manualAmount == null
  );
}
export function normalizeRow(row, year, month) {
  const {
    rewardType = "per_item",
    hours = "",
    rate = "",
    manualAmount = null,
  } = row;
  const tax = taxConditions(row),
    discount = discountConditions(row, year, month),
    withholdingEnabled =
      row.withholdingEnabled === undefined ? false : row.withholdingEnabled;
  if (
    typeof withholdingEnabled !== "boolean" ||
    typeof discount.discountEnabled !== "boolean" ||
    !validDecimal(discount.discountRate) ||
    (discount.discountRate !== "" &&
      !parseDiscountRate(discount.discountRate)) ||
    (discount.discountEnabled &&
      !isNonFeeType(rewardType) &&
      !parseDiscountRate(discount.discountRate)) ||
    Object.values(tax).some((v) => !["inclusive", "exclusive"].includes(v)) ||
    tax.priceMode !==
      tax[isExpenseType(rewardType) ? "travelPriceMode" : "feePriceMode"] ||
    !["per_item", "hourly", "travel", "expense", "adjustment"].includes(
      rewardType,
    ) ||
    !validDecimal(hours) ||
    !validDecimal(rate) ||
    (manualAmount !== null && !validRowAmount(manualAmount, "adjustment")) ||
    !validRowAmount(row.amount, rewardType) ||
    (rewardType === "hourly" && hourlyAmount(hours, rate) !== row.amount)
  ) {
    throw Error(
      "報酬タイプ・時間・単価・金額・税込／税抜・値引きを確認してください。",
    );
  }
  return {
    id: row.id,
    description: row.description,
    amount: row.amount,
    rewardType,
    hours,
    rate,
    manualAmount,
    ...tax,
    ...discount,
    withholdingEnabled,
  };
}

export function companyTotals(rows) {
  const fee = rows
    .filter((r) => !isNonFeeType(r.rewardType))
    .reduce((n, r) => n + (r.amount ?? 0), 0);
  const travel = rows
    .filter((r) => r.rewardType === "travel")
    .reduce((n, r) => n + (r.amount ?? 0), 0);
  const expense = rows
    .filter((r) => r.rewardType === "expense")
    .reduce((n, r) => n + (r.amount ?? 0), 0);
  const adjustment = rows
    .filter((r) => r.rewardType === "adjustment")
    .reduce((n, r) => n + (r.amount ?? 0), 0);
  let exclusive = 0n,
    inclusive = 0n;
  for (const row of rows) {
    if (row.rewardType === "adjustment") continue;
    if (taxConditions(row).priceMode === "exclusive")
      exclusive += BigInt(row.amount ?? 0);
    else inclusive += BigInt(row.amount ?? 0);
  }
  const addedTax = exclusive / 10n,
    tax = addedTax + inclusive / 11n;
  const beforeDiscount = exclusive + inclusive + addedTax;
  const groups = new Map();
  let invalidDiscount = false;
  for (const row of rows) {
    if (isNonFeeType(row.rewardType) || !row.discountEnabled) continue;
    const rate = parseDiscountRate(row.discountRate);
    if (!rate) {
      invalidDiscount = true;
      continue;
    }
    const group = groups.get(rate.key) ?? { ...rate, grossTenths: 0n };
    group.grossTenths +=
      BigInt(row.amount ?? 0) *
      (taxConditions(row).priceMode === "exclusive" ? 11n : 10n);
    groups.set(rate.key, group);
  }
  const discountGroups = [...groups.values()].map((g) => ({
    rate: g.key,
    amount: Number((g.grossTenths * g.n) / (g.d * 1000n)),
  }));
  const discount = discountGroups.reduce((n, g) => n + g.amount, 0);
  const invoice = beforeDiscount - BigInt(discount) + BigInt(adjustment);
  return {
    invoice: Number(invoice),
    fee,
    travel,
    expense,
    adjustment,
    net: Number(beforeDiscount - tax),
    tax: Number(tax),
    ...(groups.size || invalidDiscount
      ? { discount, discountGroups, invalidDiscount }
      : {}),
  };
}
