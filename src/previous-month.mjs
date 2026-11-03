import { defaultDiscountRate } from "./reward.mjs";

export function copyBlockReason(company, year, month) {
  if (company.invoiced || company.paid)
    return "請求済・入金済です。コピーするにはチェックを解除してください。";
  const empty = (row) =>
    row.description === "" &&
    row.amount === null &&
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
  if (company.rows.some((row) => !empty(row)))
    return "明細が入力済みです。空の月にコピーできます。";
  if (year === 1 && month === 1) return "この対象月には前月がありません。";
  return "";
}

export async function copyPreviousMonth(
  session,
  companyId,
  createId = () => crypto.randomUUID(),
) {
  if (session.busy || session.navigating)
    throw Error("処理中です。完了してからコピーしてください。");
  const { year, month, draft } = session;
  const company = draft.companies.find((c) => c.id === companyId);
  if (!company) throw Error("コピー先の会社を確認してください。");
  const blocked = copyBlockReason(company, year, month);
  if (blocked) throw Error(blocked);
  const previous = session.adjacent(-1);
  session.busy = true;
  try {
    const source = await session.api.load(previous.year, previous.month);
    if (
      session.year !== year ||
      session.month !== month ||
      session.draft !== draft
    )
      throw Error(
        "対象の年月・入力が変わりました。コピーをやり直してください。",
      );
    const rows = (
      source.companies.find((c) => c.id === companyId)?.rows ?? []
    ).filter((r) => r.rewardType === "per_item" || r.rewardType === "hourly");
    if (rows.length)
      session.draft = {
        ...draft,
        companies: draft.companies.map((c) =>
          c.id === companyId
            ? {
                ...c,
                rows: rows.map((r) => ({
                  ...structuredClone(r),
                  id: createId(),
                })),
              }
            : c,
        ),
      };
    return { ...previous, count: rows.length };
  } finally {
    session.busy = false;
  }
}
