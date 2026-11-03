import { Session } from "./session.mjs";

const stateKey = "__invoicePeriod";
function readPeriod(href) {
  const params = new URL(href).searchParams;
  const years = params.getAll("year"),
    months = params.getAll("month");
  if (
    years.length !== 1 ||
    months.length !== 1 ||
    !/^[0-9]{1,4}$/.test(years[0]) ||
    !/^[0-9]{1,2}$/.test(months[0])
  )
    return null;
  const year = Number(years[0]),
    month = Number(months[0]);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    ? { year, month }
    : null;
}
function readEntry(state) {
  const entry = state?.[stateKey];
  return entry &&
    typeof entry.id === "string" &&
    Number.isSafeInteger(entry.index) &&
    entry.index >= 0 &&
    Number.isInteger(entry.year) &&
    entry.year >= 1 &&
    entry.year <= 9999 &&
    Number.isInteger(entry.month) &&
    entry.month >= 1 &&
    entry.month <= 12
    ? entry
    : null;
}

export class PeriodSession extends Session {
  constructor(api, browser, today = new Date()) {
    super(api, today);
    this.browser = browser;
    Object.assign(this, readPeriod(browser.location.href));
    const previous = readEntry(browser.history.state);
    this.entry = {
      id: previous?.id ?? crypto.randomUUID(),
      index: previous?.index ?? 0,
      year: this.year,
      month: this.month,
    };
    this.target = null;
    this.travel = null;
    this.confirming = false;
    this.initialized = false;
    this.notify = () => {};
    this.onPop = (event) => this.handlePop(event);
  }
  get navigating() {
    return this.travel !== null;
  }
  start(onNavigate, onChange = () => {}) {
    this.onNavigate = onNavigate;
    this.notify = onChange;
    this.browser.addEventListener("popstate", this.onPop);
  }
  stop() {
    this.browser.removeEventListener("popstate", this.onPop);
  }
  writeEntry(entry, push = false) {
    const { history, location } = this.browser;
    const url = new URL(location.href);
    url.searchParams.delete("year");
    url.searchParams.delete("month");
    url.searchParams.set("year", String(entry.year));
    url.searchParams.set("month", String(entry.month));
    history[push ? "pushState" : "replaceState"](
      { ...history.state, [stateKey]: entry },
      "",
      url.href,
    );
    this.entry = entry;
  }
  async open() {
    if (this.busy || this.navigating) return;
    await super.open();
    if (this.travel) await this.travel.done;
    this.writeEntry({ ...this.entry, year: this.year, month: this.month });
    this.initialized = true;
  }
  edit(value) {
    if (!this.navigating) super.edit(value);
  }
  async save() {
    if (!this.navigating) await super.save();
  }
  cancelSwitch() {
    this.target = null;
    this.confirming = false;
  }
  async switchTo(year, month, choice) {
    if (this.busy || this.navigating) return "busy";
    const target =
      this.target?.year === year && this.target?.month === month
        ? this.target
        : null;
    if (!target) this.target = null;
    try {
      const result = await super.switchTo(year, month, choice);
      if (result === "confirm") {
        this.confirming = true;
        return result;
      }
      // A browser traversal during an API request must finish restoring the
      // source entry before we can push a new entry or commit a traversal.
      if (this.travel) await this.travel.done;
      if (result === "changed" || (result === "same" && target)) {
        if (target) await this.goTo(target);
        else
          this.writeEntry(
            { ...this.entry, index: this.entry.index + 1, year, month },
            true,
          );
      }
      this.cancelSwitch();
      return result;
    } catch (e) {
      if (!this.confirming) this.target = null;
      throw e;
    }
  }
  goTo(entry, requested = null) {
    let resolve;
    const done = new Promise((r) => {
      resolve = r;
    });
    this.travel = { entry, requested, done, resolve };
    const current = readEntry(this.browser.history.state);
    this.browser.history.go(entry.index - current.index);
    this.notify();
    return done;
  }
  handlePop(event) {
    const popped = readEntry(event.state);
    if (!popped || popped.id !== this.entry.id) return;
    if (this.travel) {
      const { entry, requested, resolve } = this.travel;
      if (popped.index !== entry.index) {
        this.browser.history.go(entry.index - popped.index);
        return;
      }
      this.entry = entry;
      this.travel = null;
      resolve();
      this.notify();
      if (requested) {
        this.target = requested;
        this.onNavigate(requested.year, requested.month);
      }
      return;
    }
    if (popped.index === this.entry.index) return;
    // popstate is delivered after the URL changes. Restore the source history
    // position first so cancellation/failure never overwrites another entry.
    const requested =
      !this.initialized || this.busy || this.confirming ? null : popped;
    void this.goTo(this.entry, requested);
  }
}
