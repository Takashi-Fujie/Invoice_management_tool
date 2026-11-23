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

export function reorderMonthRow(session, companyId, rowId, targetIndex) {
  if (session.busy || session.navigating)
    throw Error("処理中です。完了してから並び替えてください。");
  const company = session.draft.companies.find((c) => c.id === companyId);
  const index = company?.rows.findIndex((r) => r.id === rowId) ?? -1;
  if (
    index < 0 ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= company.rows.length
  )
    throw Error("並び替える会社・明細・移動先を確認してください。");
  if (company.invoiced || company.paid)
    throw Error(
      "請求済・入金済の明細は並び替えできません。チェックを解除してください。",
    );
  if (index === targetIndex) return;
  const rows = [...company.rows];
  const [row] = rows.splice(index, 1);
  rows.splice(targetIndex, 0, row);
  session.edit({
    ...session.draft,
    companies: session.draft.companies.map((c) =>
      c.id === companyId ? { ...c, rows } : c,
    ),
  });
}
