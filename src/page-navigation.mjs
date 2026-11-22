export function backupPeriod(href, today = new Date()) {
  const params = new URL(href).searchParams;
  const years = params.getAll("year"),
    months = params.getAll("month");
  if (
    years.length === 1 &&
    months.length === 1 &&
    /^[0-9]{1,4}$/.test(years[0]) &&
    /^[0-9]{1,2}$/.test(months[0])
  ) {
    const year = Number(years[0]),
      month = Number(months[0]);
    if (year >= 1 && year <= 9999 && month >= 1 && month <= 12)
      return { year, month };
  }
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}
export function pageUrl(view, year, month = 1) {
  if (view === "annual") return "/annual.html?year=" + year;
  if (view === "backup") return "/backup.html?year=" + year + "&month=" + month;
  return "/?year=" + year + "&month=" + month;
}
export async function openMonthlyPage(session, navigate, view, choice) {
  if (session.busy || session.navigating) return "busy";
  if (choice === "cancel") return "cancelled";
  if (session.dirty && !["save", "discard"].includes(choice)) return "confirm";
  if (choice === "save") await session.save();
  navigate(pageUrl(view, session.year, session.month));
  return "changed";
}
