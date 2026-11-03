export function deleteMonthRow(session, companyId, rowId) {
  if (session.busy || session.navigating)
    throw Error("処理中です。完了してから削除してください。");
  const company = session.draft.companies.find((c) => c.id === companyId);
  if (!company || !company.rows.some((r) => r.id === rowId))
    throw Error("削除する会社・明細を確認してください。");
  if (company.invoiced || company.paid)
    throw Error(
      "請求済・入金済の明細は削除できません。チェックを解除してください。",
    );
  session.edit({
    ...session.draft,
    companies: session.draft.companies.map((c) =>
      c.id === companyId
        ? { ...c, rows: c.rows.filter((r) => r.id !== rowId) }
        : c,
    ),
  });
}
