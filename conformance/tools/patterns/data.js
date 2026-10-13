// The patterns model's data: a seeded generator, so that every run (the tests on DuckDB, the
// copy deployed to Power BI) holds the same rows. Big enough for the SQLBI patterns to mean
// something (three years of sales, cohorts of customers, monthly snapshots, a hierarchy),
// small enough to be shipped inside the model as M literals.
//
// Each table: { columns: [[name, type]], rows: [[...]] }, with types as TMSL names them
// (int64, double, decimal, string, dateTime, boolean) and dates as 'YYYY-MM-DD' text.

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const ms = d => Date.parse(`${d}T00:00:00Z`);
const round2 = x => Math.round(x * 100) / 100;

export const FIRST = '2022-01-01';
export const LAST = '2024-12-31';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isoWeek(t) {
  const d = new Date(t);
  const wd = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(t + (3 - wd) * DAY);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7);
  return [year, week];
}

export function generate() {
  const rnd = mulberry32(20261013);
  const pick = xs => xs[Math.floor(rnd() * xs.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  // --- Date ---
  const dates = [];
  for (let t = ms(FIRST); t <= ms(LAST); t += DAY) {
    const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, wd = d.getUTCDay() + 1;
    const [isoY, isoW] = isoWeek(t);
    const fy = m >= 7 ? y + 1 : y, fm = ((m + 5) % 12) + 1;
    dates.push([iso(t), y, Math.ceil(m / 3), m, MONTHS[m - 1], y * 100 + m, `${y}-${String(m).padStart(2, '0')}`,
      fy, Math.ceil(fm / 3), fm, wd, DAYS[wd - 1], wd !== 1 && wd !== 7, isoY, isoW, d.getUTCDate()]);
  }

  // --- products ---
  const categories = [[1, 'Bikes'], [2, 'Clothing'], [3, 'Accessories'], [4, 'Components']];
  const subcategories = [
    [1, 'Road Bikes', 1], [2, 'Mountain Bikes', 1], [3, 'Touring Bikes', 1],
    [4, 'Jerseys', 2], [5, 'Shorts', 2], [6, 'Gloves', 2],
    [7, 'Helmets', 3], [8, 'Lights', 3], [9, 'Bottles', 3],
    [10, 'Wheels', 4], [11, 'Brakes', 4], [12, 'Chains', 4],
  ];
  const priceRange = { 1: [600, 3200], 2: [25, 120], 3: [8, 150], 4: [20, 600] };
  const colors = ['Red', 'Black', 'Blue', 'Silver', 'White', 'Yellow'];
  const brands = ['Contoso', 'Fabrikam', 'Litware', 'Northwind'];
  const products = [];
  let pk = 0;
  for (const [sk, sub, ck] of subcategories) {
    const n = sk % 3 === 0 ? 3 : 4;
    for (let i = 0; i < n; i++) {
      pk++;
      const [lo, hi] = priceRange[ck];
      const price = round2(lo + rnd() * (hi - lo));
      products.push([pk, `${sub.replace(/s$/, '')} ${String.fromCharCode(65 + i)}`, pick(colors), pick(brands), sk, price, round2(price * (0.45 + rnd() * 0.25))]);
    }
  }
  products.push([pk + 1, 'Unsold Widget', 'Black', 'Litware', 12, 9.99, 4.5]);

  // --- customers, employees, accounts ---
  const geo = { France: ['Paris', 'Lyon', 'Marseille'], Germany: ['Berlin', 'Munich'], 'United States': ['Seattle', 'Boston', 'Austin'], Australia: ['Sydney', 'Melbourne'] };
  const currencyOf = { France: 'EUR', Germany: 'EUR', 'United States': 'USD', Australia: 'AUD' };
  const customers = [];
  for (let c = 1; c <= 120; c++) {
    const country = pick(Object.keys(geo));
    customers.push([c, `Customer ${String(c).padStart(3, '0')}`, pick(geo[country]), country, rnd() < 0.5 ? 'F' : 'M', int(1950, 2002)]);
  }
  const employees = [
    [1, 'Ava Chen', null, 'CEO'],
    [2, 'Ben Ortiz', 1, 'VP Sales'], [3, 'Cara Diaz', 1, 'VP Online'],
    [4, 'Dev Patel', 2, 'Director'], [5, 'Eli Novak', 2, 'Director'], [6, 'Fay Grant', 3, 'Director'],
    [7, 'Gus Reyes', 4, 'Rep'], [8, 'Hana Ito', 4, 'Rep'], [9, 'Ivan Kral', 5, 'Rep'],
    [10, 'Jade Moss', 5, 'Rep'], [11, 'Kai Lund', 6, 'Rep'], [12, 'Lea Roux', 6, 'Rep'],
    [13, 'Max Weber', 7, 'Associate'], [14, 'Nia Okafor', 9, 'Associate'], [15, 'Oto Sato', 11, 'Associate'],
  ];
  const sellers = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const accounts = [];
  const accountCustomer = [];
  for (let a = 1; a <= 30; a++) {
    accounts.push([a, `Account ${String(a).padStart(2, '0')}`, a <= 10 ? 'Joint' : 'Single']);
    const holders = a <= 10 ? 2 + (a % 2) : 1;
    const seen = new Set();
    for (let h = 0; h < holders; h++) {
      const c = int(1, 100);
      if (!seen.has(c)) { seen.add(c); accountCustomer.push([a, c]); }
    }
  }

  // --- currencies and their daily rates (weekdays only: the rate of a weekend is the last one) ---
  const currencies = [['EUR', 'Euro'], ['USD', 'US Dollar'], ['AUD', 'Australian Dollar']];
  const rates = [];
  const rateOn = new Map();
  let eur = 1.12, aud = 0.71;
  for (const d of dates) {
    eur = Math.max(0.95, Math.min(1.25, eur + (rnd() - 0.5) * 0.01));
    aud = Math.max(0.6, Math.min(0.8, aud + (rnd() - 0.5) * 0.008));
    const wd = d[10];
    if (wd === 1 || wd === 7) continue;
    for (const [code, r] of [['EUR', eur], ['USD', 1], ['AUD', aud]]) {
      const rate = Math.round(r * 10000) / 10000;
      rates.push([d[0], code, rate]);
      rateOn.set(`${d[0]}|${code}`, rate);
    }
  }
  const lastRate = (date, code) => {
    for (let t = ms(date); t >= ms(FIRST); t -= DAY) {
      const r = rateOn.get(`${iso(t)}|${code}`);
      if (r) return r;
    }
    return code === 'EUR' ? 1.12 : code === 'AUD' ? 0.71 : 1;
  };

  // --- sales: orders of 1 to 5 lines; customers start buying on a date of their own ---
  const start = new Map(customers.map(c => [c[0], ms(FIRST) + Math.floor(rnd() * rnd() * 900) * DAY]));
  const span = (ms(LAST) - ms(FIRST)) / DAY;
  const sales = [];
  for (let o = 1; o <= 1250; o++) {
    const c = customers[int(0, customers.length - 1)];
    const s = start.get(c[0]);
    // Later dates are likelier (growth), December busier (seasonality).
    let t;
    do t = s + Math.floor(Math.sqrt(rnd()) * span) * DAY; while (t > ms(LAST) || (new Date(t).getUTCMonth() !== 11 && rnd() < 0.15));
    const order = iso(t);
    const delivery = iso(Math.min(ms(LAST), t + int(1, 12) * DAY));
    const emp = rnd() < 0.08 ? 1 : pick(sellers);
    const code = currencyOf[c[3]];
    const lines = int(1, 5);
    const used = new Set();
    for (let l = 1; l <= lines; l++) {
      let p;
      do p = products[int(0, products.length - 2)]; while (used.has(p[0]));
      used.add(p[0]);
      const qty = p[4] <= 3 ? 1 : int(1, 6);
      const discount = rnd() < 0.3 ? pick([0.05, 0.1, 0.15]) : 0;
      const rate = lastRate(order, code);
      const netPrice = round2((p[5] * (1 - discount)) / rate);
      const cost = round2(p[6] / rate);
      sales.push([o, l, order, delivery, p[0], c[0], emp, code, qty, netPrice, cost]);
    }
  }
  // Rows whose product or customer the dimensions lack: the blank row's business.
  sales.push([1251, 1, '2023-05-17', '2023-05-20', 999, 5, 7, 'USD', 2, 45.5, 20]);
  sales.push([1251, 2, '2023-05-17', '2023-05-20', 3, 5, 7, 'USD', 1, 1500, 800]);
  sales.push([1252, 1, '2024-08-09', '2024-08-15', 999, 0, 8, 'EUR', 1, 99, 40]);
  sales.push([1253, 1, '2024-11-30', '2024-12-02', 20, 0, 9, 'AUD', 3, 30, 12]);

  // --- budget by category and month, for 2023 and 2024 ---
  const budget = [];
  for (const y of [2023, 2024]) for (let m = 1; m <= 12; m++) for (const [ck] of categories) {
    const base = { 1: 90000, 2: 6000, 3: 5000, 4: 15000 }[ck];
    budget.push([ck, y * 100 + m, Math.round(base * (0.8 + rnd() * 0.5) * (y === 2024 ? 1.15 : 1)) ]);
  }

  // --- inventory: a snapshot at each month's end, some products missing some months ---
  const inventory = [];
  const monthEnds = dates.filter((d, i) => i === dates.length - 1 || dates[i + 1][3] !== d[3]).map(d => d[0]);
  for (const p of products.slice(0, -1)) {
    let onHand = int(5, 80);
    for (const d of monthEnds) {
      onHand = Math.max(0, onHand + int(-15, 18));
      if (rnd() < 0.1) continue;
      inventory.push([d, p[0], onHand]);
    }
  }

  // --- segments for dynamic segmentation (disconnected) ---
  const segments = [['Low', 0, 1000, 1], ['Medium', 1000, 5000, 2], ['High', 5000, 20000, 3], ['Top', 20000, 1e9, 4]];

  return {
    Date: {
      columns: [['Date', 'dateTime'], ['Year', 'int64'], ['Quarter', 'int64'], ['Month', 'int64'], ['Month Name', 'string'],
        ['YearMonth', 'int64'], ['Year Month', 'string'], ['Fiscal Year', 'int64'], ['Fiscal Quarter', 'int64'], ['Fiscal Month', 'int64'],
        ['Weekday', 'int64'], ['Day Name', 'string'], ['Working Day', 'boolean'], ['ISO Year', 'int64'], ['ISO Week', 'int64'], ['Day', 'int64']],
      rows: dates,
    },
    Category: { columns: [['CategoryKey', 'int64'], ['Category', 'string']], rows: categories },
    Subcategory: { columns: [['SubcategoryKey', 'int64'], ['Subcategory', 'string'], ['CategoryKey', 'int64']], rows: subcategories },
    Product: {
      columns: [['ProductKey', 'int64'], ['Product', 'string'], ['Color', 'string'], ['Brand', 'string'], ['SubcategoryKey', 'int64'],
        ['Unit Price', 'double'], ['Unit Cost', 'double']],
      rows: products,
    },
    Customer: {
      columns: [['CustomerKey', 'int64'], ['Customer', 'string'], ['City', 'string'], ['Country', 'string'], ['Gender', 'string'], ['Birth Year', 'int64']],
      rows: customers,
    },
    Employee: { columns: [['EmployeeKey', 'int64'], ['Employee', 'string'], ['ParentEmployeeKey', 'int64'], ['Title', 'string']], rows: employees },
    Account: { columns: [['AccountKey', 'int64'], ['Account', 'string'], ['Account Type', 'string']], rows: accounts },
    AccountCustomer: { columns: [['AccountKey', 'int64'], ['CustomerKey', 'int64']], rows: accountCustomer },
    Currency: { columns: [['CurrencyCode', 'string'], ['Currency', 'string']], rows: currencies },
    ExchangeRate: { columns: [['Date', 'dateTime'], ['CurrencyCode', 'string'], ['Rate', 'double']], rows: rates },
    Sales: {
      columns: [['Order Number', 'int64'], ['Line Number', 'int64'], ['Order Date', 'dateTime'], ['Delivery Date', 'dateTime'],
        ['ProductKey', 'int64'], ['CustomerKey', 'int64'], ['EmployeeKey', 'int64'], ['CurrencyCode', 'string'],
        ['Quantity', 'int64'], ['Net Price', 'double'], ['Unit Cost', 'double']],
      rows: sales,
    },
    Budget: { columns: [['CategoryKey', 'int64'], ['YearMonth', 'int64'], ['Budget', 'decimal']], rows: budget },
    Inventory: { columns: [['Date', 'dateTime'], ['ProductKey', 'int64'], ['On Hand', 'int64']], rows: inventory },
    Segments: { columns: [['Segment', 'string'], ['Min Sales', 'double'], ['Max Sales', 'double'], ['Segment Order', 'int64']], rows: segments },
  };
}
