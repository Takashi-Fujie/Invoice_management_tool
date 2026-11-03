const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function screen(url = "http://localhost/annual-summary.html") {
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this.value = "";
      this._text = "";
      this.style = {};
      this.scrollLeft = 0;
    }
    append(...items) {
      this.children.push(...items);
    }
    replaceChildren(...items) {
      this.children = [...items];
      this._text = "";
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
      if (key === "id") this.id = String(value);
    }
    getAttribute(key) {
      return this.attrs[key];
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return (
        this._text +
        this.children
          .map((x) => (typeof x === "string" ? x : x.textContent))
          .join("")
      );
    }
    focus() {
      document.activeElement = this;
    }
  }
  const html = fs.readFileSync(__dirname + "/annual-summary.html", "utf8");
  const app = new Element();
  app.id = "app";
  const nodes = () => {
    const all = [];
    function walk(n) {
      if (typeof n === "string") return;
      all.push(n);
      n.children.forEach(walk);
    }
    walk(app);
    return all;
  };
  const document = {
    getElementById: (id) => nodes().find((n) => n.id === id),
    createElement: (tag) => new Element(tag),
  };
  const location = { href: url };
  const entries = [url];
  let index = 0;
  const listeners = {};
  const history = {
    pushState(s, t, u) {
      location.href = new URL(u, location.href).href;
      entries.splice(index + 1);
      entries.push(location.href);
      index++;
    },
    replaceState(s, t, u) {
      location.href = new URL(u, location.href).href;
      entries[index] = location.href;
    },
  };
  const window = {
    location,
    history,
    addEventListener: (key, fn) => (listeners[key] = fn),
    scrollTo() {},
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document,
    window,
    URL,
    URLSearchParams,
    Set,
    Intl,
    console,
  });
  const find = (label) => nodes().find((n) => n.attrs["aria-label"] === label);
  const click = (label) => {
    const n = find(label);
    assert.ok(n, label);
    n.onclick({ preventDefault() {}, button: 0 });
  };
  return {
    app,
    find,
    nodes,
    click,
    location,
    changeYear(value) {
      const n = find("対象年");
      n.value = String(value);
      n.onchange();
    },
    back() {
      assert.ok(index > 0);
      location.href = entries[--index];
      listeners.popstate();
    },
  };
}
const blue = "青葉デザイン（架空）";
const detailTitles = [
  "報酬額",
  "交通費",
  "立替経費",
  "税抜合計",
  "消費税（10%）",
  "値引き",
  "調整額",
  "源泉徴収",
  "小計",
];
test("S16-T01：初期は1社1行の請求額で、内訳は閉じ、12か月と年合計を表示する", () => {
  const s = screen();
  assert.equal(s.find(blue + "の金額内訳").attrs["aria-expanded"], "false");
  assert.ok(s.find(blue + " 2026年1月 請求額 91,790円 入金済"));
  assert.equal(s.find(blue + "の報酬額内訳"), undefined);
  for (let m = 1; m <= 12; m++)
    assert.ok(
      s.nodes().some((n) => n.tagName === "th" && n.textContent === m + "月"),
    );
  assert.ok(
    s.nodes().some((n) => n.tagName === "th" && n.textContent === "年合計"),
  );
  assert.ok(s.find("全社合計"));
});
test("S16-T02：会社別に内訳を開閉でき、他社と金額を変えず、展開操作では月次へ移動しない", () => {
  const s = screen();
  const before = s.find(blue + "の年合計").textContent;
  s.click(blue + "の金額内訳");
  assert.equal(s.find(blue + "の金額内訳").attrs["aria-expanded"], "true");
  for (const item of detailTitles)
    assert.ok(s.find(blue + "の" + item + "内訳"));
  assert.equal(s.find("こもれび編集室（架空）の報酬額内訳"), undefined);
  assert.equal(s.find(blue + "の年合計").textContent, before);
  assert.ok(!s.location.href.includes("view=month"));
  s.click(blue + "の金額内訳");
  assert.equal(s.find(blue + "の報酬額内訳"), undefined);
});
test("S16-T03：入金済・請求済・請求前を形とラベルで識別し、未登録月は状態を推測しない", () => {
  const s = screen();
  for (const status of ["入金済", "請求済・未入金", "請求前"])
    assert.ok(s.nodes().some((n) => n.attrs["data-status"] === status));
  const missing = s.find(blue + " 2026年12月 データなし");
  assert.ok(missing);
  assert.equal(missing.tagName, "span");
});
test("S16-T04：月別金額は対象年月を指定した既存の月次入力ページへの通常リンクにする", () => {
  const s = screen();
  s.click(blue + "の金額内訳");
  const link = s.find(blue + " 2026年2月 請求額 110,748円 入金済");
  const u = new URL(link.attrs.href);
  assert.equal(u.origin, "http://127.0.0.1:8802");
  assert.equal(u.pathname, "/");
  assert.equal(u.searchParams.get("year"), "2026");
  assert.equal(u.searchParams.get("month"), "2");
  assert.equal(u.searchParams.get("view"), null);
  assert.equal(u.searchParams.get("company"), null);
  assert.equal(
    link.onclick,
    undefined,
    "通常の画面遷移を専用明細への処理で奪わない",
  );
  assert.equal(s.find("月次明細"), undefined);
  assert.equal(s.find(blue + "の金額内訳").attrs["aria-expanded"], "true");
});
test("S16-T04：展開内訳も同じ既存入力ページへ移動し、年合計はリンクにしない", () => {
  const s = screen();
  s.click(blue + "の金額内訳");
  const u = new URL(s.find(blue + " 2026年1月 交通費 2,000円").attrs.href);
  assert.equal(u.origin, "http://127.0.0.1:8802");
  assert.equal(u.searchParams.get("month"), "1");
  assert.equal(s.find(blue + "の年合計").tagName, "span");
});
test("S16-T05：会社別の12か月合計と全社の月合計・年合計が一致し、開閉・遷移で変わらない", () => {
  const s = screen();
  const sum = (n) => Number(n.attrs["data-amount"]);
  let companyAnnual = 0;
  for (const name of [
    blue,
    "こもれび編集室（架空）",
    "みなと制作（架空）",
    "ひだまり企画（架空）",
  ]) {
    const cells = s
      .nodes()
      .filter(
        (n) =>
          n.attrs["data-company"] === name &&
          n.attrs["data-metric"] === "invoice" &&
          n.attrs["data-month"],
      );
    const annual = sum(s.find(name + "の年合計"));
    assert.equal(
      cells.reduce((v, n) => v + sum(n), 0),
      annual,
    );
    companyAnnual += annual;
  }
  assert.equal(sum(s.find("全社の年合計")), companyAnnual);
  const totalMonths = s.nodes().filter((n) => n.attrs["data-total-month"]);
  assert.equal(
    totalMonths.reduce((v, n) => v + sum(n), 0),
    companyAnnual,
  );
  s.click(blue + "の金額内訳");
  assert.equal(sum(s.find("全社の年合計")), companyAnnual);
});
test("0円の登録済みデータはリンクと状態を保持し、未登録の「—」と区別する", () => {
  const s = screen();
  const link = s.find("みなと制作（架空） 2026年7月 請求額 0円 請求済・未入金");
  assert.equal(link.tagName, "a");
  assert.equal(new URL(link.attrs.href).searchParams.get("month"), "7");
});
test("年切替と直接URLで別年の額・月を混在させず、データなしの年も合計0円を表示する", () => {
  const s = screen();
  s.changeYear(2025);
  assert.ok(s.find(blue + " 2025年1月 請求額 44,895円 入金済"));
  s.changeYear(2027);
  assert.ok(s.find("年間データなし"));
  assert.equal(s.find("全社の年合計").attrs["data-amount"], "0");
  const direct = screen(
    "http://localhost/annual-summary.html?view=month&year=2025&month=1&company=aoba",
  );
  assert.ok(direct.find(blue + " 2025年1月 請求額 44,895円 入金済"));
  assert.equal(direct.find("月次明細"), undefined);
});

test("S16-T04：別年を含め、全月別リンクは年月だけを指定して既存入力へ移動する", () => {
  const s = screen();
  s.changeYear(2025);
  s.click(blue + "の金額内訳");
  const links = s.nodes().filter((n) => n.tagName === "a");
  assert.ok(links.length > 0);
  for (const link of links) {
    const u = new URL(link.attrs.href);
    assert.equal(u.origin, "http://127.0.0.1:8802");
    assert.equal(u.pathname, "/");
    assert.equal(u.searchParams.get("year"), "2025");
    assert.ok(Number(u.searchParams.get("month")) >= 1);
    assert.equal(u.searchParams.size, 2);
  }
});

test("S16-T06：全社合計は初期は内訳を閉じ、独立して9項目を開閉できる", () => {
  const s = screen();
  const before = s.find("全社の年合計").textContent;
  assert.equal(s.find("全社合計の金額内訳").attrs["aria-expanded"], "false");
  assert.equal(s.find("全社合計の報酬額内訳"), undefined);
  s.click(blue + "の金額内訳");
  s.click("全社合計の金額内訳");
  assert.equal(s.find("全社合計の金額内訳").attrs["aria-expanded"], "true");
  for (const title of detailTitles)
    assert.ok(s.find("全社合計の" + title + "内訳"));
  assert.equal(s.find(blue + "の金額内訳").attrs["aria-expanded"], "true");
  assert.equal(s.find("全社の年合計").textContent, before);
  assert.equal(s.location.href, "http://localhost/annual-summary.html");
  s.click("全社合計の金額内訳");
  assert.equal(s.find("全社合計の報酬額内訳"), undefined);
  assert.ok(s.find(blue + "の報酬額内訳"));
});
test("S16-T06：全社内訳の月・年合計は各会社の内訳の合算に一致する", () => {
  const s = screen();
  s.click("全社合計の金額内訳");
  const names = [
    blue,
    "こもれび編集室（架空）",
    "みなと制作（架空）",
    "ひだまり企画（架空）",
  ];
  for (const name of names) s.click(name + "の金額内訳");
  const value = (cell) =>
    Number(cell.textContent.replaceAll(",", "").replace("—", "0"));
  for (const [title, january] of [
    ["報酬額", 200000],
    ["交通費", 2000],
    ["立替経費", 0],
    ["税抜合計", 183638],
    ["消費税（10%）", 18362],
    ["値引き", 0],
    ["調整額", 0],
    ["源泉徴収", 20215],
    ["小計", 202000],
  ]) {
    const total = s.find("全社合計の" + title + "内訳");
    assert.equal(value(total.children[1]), january);
    for (let column = 1; column <= 13; column++) {
      const companySum = names.reduce(
        (sum, name) =>
          sum + value(s.find(name + "の" + title + "内訳").children[column]),
        0,
      );
      assert.equal(
        value(total.children[column]),
        companySum,
        title + " " + column,
      );
    }
  }
});
test("S16-T06：全社合計と全社内訳は金額リンクや状態アイコンを持たない", () => {
  const s = screen();
  s.click("全社合計の金額内訳");
  const descendants = (node) => [
    node,
    ...node.children.filter((x) => typeof x !== "string").flatMap(descendants),
  ];
  for (const row of [
    s.find("全社合計"),
    ...detailTitles.map((title) => s.find("全社合計の" + title + "内訳")),
  ]) {
    assert.equal(descendants(row).filter((n) => n.tagName === "a").length, 0);
    assert.equal(
      descendants(row).filter((n) => n.attrs["data-status"]).length,
      0,
    );
  }
  assert.ok(
    s
      .find(blue + " 2026年2月 請求額 110,748円 入金済")
      .attrs.href.includes(":8802/"),
  );
});
test("S16-T06：年切替後は全社内訳を閉じ、データのない年でも開くと全項目0円", () => {
  const s = screen();
  s.click("全社合計の金額内訳");
  s.changeYear(2027);
  assert.equal(s.find("全社合計の金額内訳").attrs["aria-expanded"], "false");
  s.click("全社合計の金額内訳");
  for (const title of detailTitles) {
    const row = s.find("全社合計の" + title + "内訳");
    for (const cell of row.children.slice(1))
      assert.equal(cell.textContent, "0");
  }
  assert.equal(s.find("全社の年合計").attrs["data-amount"], "0");
});

test("S16-T07：月次集計と同じ9項目を表示し、125000円の税抜報酬は税12500円・小計137500円となる", () => {
  const s = screen();
  s.click(blue + "の金額内訳");
  s.click("全社合計の金額内訳");
  const expected = {
    報酬額: 125000,
    交通費: 0,
    立替経費: 0,
    税抜合計: 125000,
    "消費税（10%）": 12500,
    値引き: 0,
    調整額: 0,
    源泉徴収: 11530,
    小計: 137500,
  };
  const value = (cell) => Number(cell.textContent.replaceAll(",", ""));
  for (const title of detailTitles) {
    assert.ok(s.find(blue + "の" + title + "内訳"));
    assert.ok(s.find("全社合計の" + title + "内訳"));
    assert.equal(
      value(s.find(blue + "の" + title + "内訳").children[5]),
      expected[title],
      title,
    );
  }
  assert.equal(s.find(blue + "の案件単価内訳"), undefined);
  assert.equal(s.find(blue + "の時給内訳"), undefined);
});
test("S16-T07：立替経費・値引き・負の調整を分け、税抜＋税−値引き＋調整＝小計を保持する", () => {
  const s = screen();
  s.click(blue + "の金額内訳");
  s.click("全社合計の金額内訳");
  const read = (name, title, month) =>
    Number(
      s
        .find(name + "の" + title + "内訳")
        .children[month].textContent.replaceAll(",", ""),
    );
  assert.equal(read(blue, "立替経費", 6), 3600);
  assert.equal(read(blue, "値引き", 8), 1000);
  assert.equal(read(blue, "調整額", 4), -1);
  for (const name of [blue, "全社合計"])
    for (let month = 1; month <= 11; month++) {
      assert.equal(
        read(name, "税抜合計", month) +
          read(name, "消費税（10%）", month) -
          read(name, "値引き", month) +
          read(name, "調整額", month),
        read(name, "小計", month),
      );
    }
});
