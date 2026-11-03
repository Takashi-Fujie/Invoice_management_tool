import { validChecks } from "./checks.mjs";
import {
  visibilityBlockReason,
  isCompanyVisible,
} from "./company-visibility.mjs";
import {
  companyTotals,
  validRowAmount,
  blankRow,
  normalizeRow,
  normalizeWithholdingAmount,
} from "./reward.mjs";
export function acceptAmount(previous, next, signed = false) {
  return (signed ? /^-?[0-9]*$/ : /^[0-9]*$/).test(next) &&
    next.replace("-", "").length <= 9
    ? next
    : previous;
}
export function prepareMonth(data, year, month) {
  if (!Array.isArray(data.companies) || !data.companies.length)
    throw Error("会社を追加してください。");
  return {
    companies: data.companies.map((c) => {
      if (c.visible !== undefined && typeof c.visible !== "boolean")
        throw Error("会社の表示・非表示を確認してください。");
      if (c.visible === false && visibilityBlockReason(c, year, month))
        throw Error("入力のある会社は非表示にできません。");
      if (
        !c.name.trim() ||
        c.name.length > 80 ||
        !validChecks(c.invoiced, c.paid)
      )
        throw Error("会社名と請求済・入金済の状態を確認してください。");
      const rows = c.rows
        .filter((r) => !blankRow(r))
        .map((r) => normalizeRow(r, year, month));
      if (
        rows.some(
          (r) =>
            !r.description.trim() ||
            r.description.length > 160 ||
            !validRowAmount(r.amount, r.rewardType),
        )
      )
        throw Error("各社の業務内容と整数の報酬額を入力してください。");
      if (companyTotals(rows).invoice < 0)
        throw Error("調整後の小計は0円以上にしてください。");
      return {
        ...c,
        rows,
        withholdingAmount: normalizeWithholdingAmount(c.withholdingAmount ?? 0),
        visible: isCompanyVisible(c, year, month),
      };
    }),
  };
}
