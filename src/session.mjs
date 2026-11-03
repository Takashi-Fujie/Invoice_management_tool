export class Session {
  constructor(api, today = new Date()) {
    this.api = api;
    this.year = today.getFullYear();
    this.month = today.getMonth() + 1;
    this.draft = { companies: [] };
    this.base = structuredClone(this.draft);
    this.busy = false;
  }
  get dirty() {
    return JSON.stringify(this.draft) !== JSON.stringify(this.base);
  }
  edit(value) {
    if (!this.busy) this.draft = value;
  }
  adjacent(step) {
    const n = this.year * 12 + this.month - 1 + step;
    return { year: Math.floor(n / 12), month: (n % 12) + 1 };
  }
  async open() {
    if (this.busy) return;
    this.busy = true;
    try {
      const next = await this.api.load(this.year, this.month);
      this.draft = next;
      this.base = structuredClone(next);
    } finally {
      this.busy = false;
    }
  }
  async save() {
    if (this.busy) return;
    this.busy = true;
    try {
      const next = await this.api.save(this.draft, this.year, this.month);
      this.draft = next;
      this.base = structuredClone(next);
    } finally {
      this.busy = false;
    }
  }
  async switchTo(year, month, choice) {
    if (
      !Number.isInteger(year) ||
      year < 1 ||
      year > 9999 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    )
      throw Error("年・月を確認してください。");
    if (this.busy) return "busy";
    if (this.year === year && this.month === month) return "same";
    if (this.dirty && !choice) return "confirm";
    this.busy = true;
    try {
      if (choice === "save") {
        const saved = await this.api.save(this.draft, this.year, this.month);
        this.draft = saved;
        this.base = structuredClone(saved);
      }
      const next = await this.api.load(year, month);
      this.year = year;
      this.month = month;
      this.draft = next;
      this.base = structuredClone(next);
      return "changed";
    } finally {
      this.busy = false;
    }
  }
}
