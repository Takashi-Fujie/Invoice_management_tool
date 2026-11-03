export function amountText(raw, editing) {
  return !editing && /^-?[0-9]+$/.test(raw)
    ? Number(raw).toLocaleString("ja-JP")
    : raw;
}
