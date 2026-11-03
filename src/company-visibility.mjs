import { defaultDiscountRate } from "./reward.mjs";

export function visibilityBlockReason(company, year, month) {
  const pristine = (row) =>
    row.description === "" &&
    row.amount == null &&
    row.manualAmount == null &&
    !row.hours &&
    !row.rate &&
    (row.rewardType ?? "per_item") === "per_item" &&
    (row.priceMode ?? "exclusive") === "exclusive" &&
    (row.feePriceMode ?? "exclusive") === "exclusive" &&
    (row.travelPriceMode ?? "inclusive") === "inclusive" &&
    !row.discountEnabled &&
    !row.withholdingEnabled &&
    (row.discountRate ?? defaultDiscountRate(year, month)) ===
      defaultDiscountRate(year, month);
  if (company.rows.some((row) => !pristine(row))) return "明細あり";
  if (company.paid) return "入金済";
  if (company.invoiced) return "請求済";
  if ((company.withholdingAmount ?? 0) !== 0) return "源泉額あり";
  return "";
}

export function isCompanyVisible(company, year, month) {
  return (
    company.visible === true || !!visibilityBlockReason(company, year, month)
  );
}

// モーダル内の案だけを返す。反映するまではsessionの入力を変更しない。
export async function copyPreviousVisibility(session, companies) {
  if (session.busy || session.navigating)
    throw Error("処理中です。完了してからコピーしてください。");
  const { year, month, draft } = session;
  if (year === 1 && month === 1)
    throw Error("この対象月には前月がありません。");
  const previous = session.adjacent(-1);
  session.busy = true;
  try {
    let source;
    try {
      source = await session.api.load(previous.year, previous.month);
    } catch {
      throw Error(
        "前月の読取に失敗しました。選択を保持したまま再試行できます。",
      );
    }
    if (
      session.year !== year ||
      session.month !== month ||
      session.draft !== draft
    )
      throw Error(
        "対象の年月・入力が変わりました。コピーをやり直してください。",
      );
    const copied = companies.map((company) => {
      const from = source.companies.find((c) => c.id === company.id);
      return {
        ...company,
        visible:
          !!visibilityBlockReason(company, year, month) ||
          !!(from && isCompanyVisible(from, previous.year, previous.month)),
      };
    });
    return {
      ...previous,
      companies: copied,
      count: copied.filter((c) => c.visible).length,
    };
  } finally {
    session.busy = false;
  }
}
