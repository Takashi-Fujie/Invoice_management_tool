export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export function backupFileName(
  createdAt = new Date(),
  id = crypto.randomUUID(),
) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(createdAt))
      .map((p) => [p.type, p.value]),
  );
  return (
    "請求管理ツール_バックアップ_" +
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second +
    "_" +
    id.slice(0, 8) +
    ".json"
  );
}
