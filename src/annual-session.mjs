export function annualYear(href, today = new Date()) {
  const values = new URL(href).searchParams.getAll("year");
  if (values.length === 1 && /^[0-9]{1,4}$/.test(values[0])) {
    const year = Number(values[0]);
    if (year >= 1 && year <= 9999) return year;
  }
  return today.getFullYear();
}
export class AnnualSession {
  constructor(api, browser) {
    this.api = api;
    this.browser = browser;
    this.year = annualYear(browser.location.href);
    this.data = null;
    this.error = "";
    this.busy = false;
    this.generation = 0;
    this.notify = () => {};
    this.onPop = () => {
      this.year = annualYear(browser.location.href);
      void this.open();
    };
  }
  start(notify) {
    this.notify = notify;
    this.browser.addEventListener("popstate", this.onPop);
  }
  stop() {
    this.generation++;
    this.browser.removeEventListener("popstate", this.onPop);
    this.notify = () => {};
  }
  async open() {
    const generation = ++this.generation;
    this.busy = true;
    this.error = "";
    this.data = null;
    this.notify();
    try {
      const data = await this.api.load(this.year);
      if (generation === this.generation) this.data = data;
    } catch (error) {
      if (generation === this.generation)
        this.error =
          error instanceof Error ? error.message : "読取に失敗しました。";
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.notify();
      }
    }
  }
  changeYear(year) {
    if (!Number.isInteger(year) || year < 1 || year > 9999)
      throw Error("年は1〜9999で入力してください。");
    if (year === this.year) return;
    const url = new URL(this.browser.location.href);
    url.searchParams.set("year", String(year));
    url.searchParams.delete("month");
    this.browser.history.pushState(null, "", url.href);
    this.year = year;
    return this.open();
  }
}
export async function openAnnual(session, navigate, choice) {
  if (session.busy || session.navigating) return "busy";
  if (session.dirty && !choice) return "confirm";
  if (choice === "save") await session.save();
  navigate(`/annual.html?year=${session.year}`);
  return "changed";
}
