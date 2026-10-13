// The edges model's data: small, fixed where the shape matters and seeded where it does not, so
// every run holds the same rows. Each awkward shape is here on purpose:
//
//   - Sales rows whose product, customer or store the dimension lacks (blank row), and rows whose
//     key is NULL; a store key that is an empty string; a product, customer, store, country and
//     region with no facts.
//   - Two facts at different grains: Sales (order lines, by day) and Target (store x brand x month,
//     on the month's first day), Target with no rows at all for 2023-04, 2024-07 and 2024-08, and
//     Sales with none for 2023-08.
//   - A contiguous Date table over 2023-2024 (2024-02-29 included); Sales[Ship Date] is NULL for
//     unshipped lines and runs past the Date table for one line.
//   - Zeros, negatives, exact ties (Twin A/B, Customer 20/21), doubles such as 0.1 and 0.2, fixed
//     decimals with 4 places, a weight of 2.5e-8 and one of 2.2e11, an int64 past 2^31.
//   - Text: empty strings next to blanks, leading/trailing spaces, accents and other non-ASCII
//     letters, a double quote, values that look like numbers ("0042", "42", "1e3", "-7").
//     Never two values that differ only by case, accents or spaces.
//
// Each table: { columns: [[name, type]], rows: [[...]] }, types as TMSL names them, dates as
// 'YYYY-MM-DD' text.

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const ms = d => Date.parse(`${d}T00:00:00Z`);
const round2 = x => Math.round(x * 100) / 100;
const round4 = x => Math.round(x * 10000) / 10000;

export const FIRST = '2023-01-01';
export const LAST = '2024-12-31';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function generate() {
  const rnd = mulberry32(20261013);
  const pick = xs => xs[Math.floor(rnd() * xs.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  // --- Date: contiguous, two years, a leap day ---
  const dates = [];
  for (let t = ms(FIRST); t <= ms(LAST); t += DAY) {
    const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, wd = d.getUTCDay() + 1;
    const doy = 1 + Math.round((t - Date.UTC(y, 0, 1)) / DAY);
    dates.push([iso(t), y, `Q${Math.ceil(m / 3)}`, m, MONTHS[m - 1], y * 100 + m, `${y}-${String(m).padStart(2, '0')}`,
      wd, DAYS[wd - 1], wd === 1 || wd === 7, doy]);
  }

  // --- geography: a 3-level snowflake Store -> Country -> Region ---
  // Africa has a country with no store; Antarctica has no country at all.
  const regions = [[1, 'Europe'], [2, 'Americas'], [3, 'Asia Pacific'], [4, 'Africa'], [5, 'Antarctica']];
  const countries = [[1, 'Netherlands', 1], [2, 'France', 1], [3, 'United States', 2], [4, 'Japan', 3], [5, 'Australia', 3], [6, "Côte d'Ivoire", 4]];
  // Text keys. LYS-01 has neither sales nor targets.
  const stores = [
    ['AMS-01', 'Amsterdam Centraal', 1, 420, '2019-03-01'],
    ['PAR-01', 'Paris Rivoli', 2, 610, '2015-06-15'],
    ['PAR-02', 'Paris Bercy', 2, 380, '2023-09-01'],
    ['NYC-01', 'New York 5th Ave', 3, 900, '2012-11-20'],
    ['SFO-01', 'San Francisco', 3, 0, '2020-02-29'],
    ['TYO-01', 'Tōkyō Ginza', 4, 515, '2018-04-01'],
    ['SYD-01', 'Sydney Harbour ', 5, 300, null],
    ['LYS-01', 'Lyon Part-Dieu', 2, 250, '2024-12-01'],
  ];
  // One-to-one with Store: SYD-01 has no profile, BER-01 has a profile but no store.
  const profiles = [
    ['AMS-01', 'Anouk de Vries', 'Flagship', 2],
    ['PAR-01', 'Hélène Lefèvre', 'Flagship', 3],
    ['PAR-02', 'Théo Martin', 'Outlet', 1],
    ['NYC-01', 'Dana Whitfield', '', 4],
    ['SFO-01', 'Miguel Ángel Ruiz', null, 1],
    ['TYO-01', '佐藤 健', 'Flagship', 0],
    ['LYS-01', 'Inès Moreau', 'Outlet', 1],
    ['BER-01', 'Jürgen Groß', 'Flagship', 2],
  ];

  // --- products: names, codes and brands chosen to be awkward ---
  //   [ProductKey, Product, Code, Brand, Color, Weight (double), List Price (decimal)]
  const products = [
    [1, 'Café Crème Mug', '0042', 'Contoso', 'Red', 0.35, 12.5],
    [2, 'Crème Brûlée Torch', '42', 'Contoso', 'Black', 0.8, 39.99],
    [3, 'Naïve Notebook', '1e3', 'Fabrikam', 'Blue', 0.25, 4.1234],
    [4, ' Spaced Lamp', '-7', 'Fabrikam', '', 2.5, 89.5],
    [5, 'Desk Fan ', '3.10', 'Fabrikam', null, 4.75, 59.9999],
    [6, 'Gadget', '007', 'Contoso', 'Black', 0.1, 25],
    [7, 'Gadget', '7', 'Ünïcorn', 'Silver', 0.1, 25],
    [8, 'Twin A', 'T-1', 'Ünïcorn', 'Blue', 1, 10],
    [9, 'Twin B', 'T-2', 'Ünïcorn', 'Blue', 1, 10],
    [10, '', '00', 'Contoso', 'Black', 0.5, 5],
    [11, null, 'N/A', 'Fabrikam', 'Black', 0.5, 5],
    [12, 'Free Sample', '0', 'Contoso', 'White', 0.000001, 0],
    [13, 'Dust Mote', '1e-6', 'Fabrikam', 'Grey', 2.5e-8, 0.0001],
    [14, 'Container Ship', '1,000,000', 'Ünïcorn', 'Grey', 220000000000, 1234567.8912],
    [15, 'Ångström Gauge', 'Å-15', null, 'Silver', 0.002, 249.9999],
    [16, 'Never Sold', '16', 'Contoso', 'Red', 1.2, 15],
    [17, 'Šunka Slicer', '17', 'Fabrikam', 'Céladon', 3.3, 149],
    [18, 'Zero Price Promo', '18', 'Ünïcorn', 'Green', 0.2, 0],
  ];

  // --- customers ---
  //   [CustomerKey, Customer, Segment, City]
  const customers = [
    [1, 'Zoë Ångström', 'Retail', 'Malmö'],
    [2, 'José Núñez', 'Wholesale', 'Sevilla'],
    [3, 'Łukasz Żółć', 'Retail', 'Kraków'],
    [4, 'Søren Kierkegaard', 'Online', 'København'],
    [5, 'Chloé Dubois', 'Retail', 'Paris'],
    [6, 'Müller GmbH', 'Wholesale', 'München'],
    [7, '  Padded Name  ', 'Online', null],
    [8, '12345', 'Retail', 'Austin'],
    [9, '', 'Wholesale', ''],
    [10, null, 'Retail', 'Lyon'],
    [11, 'Ōsaka Trading', '', 'Ōsaka'],
    [12, 'Nguyễn Văn An', null, 'Hà Nội'],
    [13, 'Dvořák & Sons', 'Wholesale', 'Praha'],
    [14, 'The "Best" Co', 'Retail', 'Boston'],
    [15, 'Never Bought', 'Online', 'Perth'],
  ];
  const segs = ['Retail', 'Wholesale', 'Online'];
  const cities = ['Seattle', 'Utrecht', 'Nice', 'Kyoto', 'Brisbane'];
  for (let c = 16; c <= 24; c++) customers.push([c, `Customer ${c}`, pick(segs), pick(cities)]);

  // --- sales: seeded order lines, none in August 2023 ---
  const sold = products.filter(p => ![8, 9, 14, 16].includes(p[0]));
  const buyers = customers.filter(c => ![15, 20, 21].includes(c[0])).map(c => c[0]);
  const sellingStores = ['AMS-01', 'PAR-01', 'PAR-02', 'NYC-01', 'SFO-01', 'TYO-01', 'SYD-01'];
  const span = (ms(LAST) - ms(FIRST)) / DAY;
  const sales = [];
  const line = (o, l, order, ship, pk, ck, sk, qty, price, cost, discount, promo, points) =>
    sales.push([o, l, order, ship, pk, ck, sk, qty, price, cost, discount, promo, points]);
  for (let o = 1; o <= 330; o++) {
    let t;
    do t = ms(FIRST) + int(0, span) * DAY; while (iso(t).startsWith('2023-08'));
    const order = iso(t);
    const r = rnd();
    const ship = r < 0.08 ? null : iso(t + int(0, 6) * DAY);
    const ck = pick(buyers), sk = pick(sellingStores);
    const lines = int(1, 3);
    const used = new Set();
    for (let l = 1; l <= lines; l++) {
      let p;
      do p = pick(sold); while (used.has(p[0]));
      used.add(p[0]);
      const q = rnd();
      const qty = q < 0.05 ? 0 : q < 0.1 ? -int(1, 2) : int(1, 5);
      const discount = pick([0, 0, 0, 0.1, 0.25]);
      const price = round2(p[6] * (1 - discount));
      const cost = round4(p[6] * (0.4 + rnd() * 0.3));
      const promo = rnd() < 0.1 ? null : discount > 0;
      const points = Math.round(price * Math.max(qty, 0));
      line(o, l, order, ship, p[0], ck, sk, qty, price, cost, discount, promo, points);
    }
  }
  // Fixed lines, each for a shape the seeded ones may not reach.
  // Exact ties: Twin A and Twin B sell the same; Customer 20 and Customer 21 buy the same.
  line(9001, 1, '2023-03-15', '2023-03-16', 8, 20, 'AMS-01', 3, 10, 4.5, 0, false, 30);
  line(9001, 2, '2023-03-15', '2023-03-16', 9, 21, 'AMS-01', 3, 10, 4.5, 0, false, 30);
  line(9002, 1, '2024-06-01', '2024-06-03', 9, 20, 'NYC-01', 2, 10, 4.5, 0, false, 20);
  line(9002, 2, '2024-06-01', '2024-06-03', 8, 21, 'NYC-01', 2, 10, 4.5, 0, false, 20);
  // The leap day, and the days a year apart from it.
  line(9003, 1, '2024-02-29', '2024-03-01', 2, 3, 'PAR-01', 1, 39.99, 17.3333, 0, false, 40);
  line(9004, 1, '2024-02-28', '2024-02-29', 2, 3, 'PAR-01', 2, 39.99, 17.3333, 0, false, 80);
  line(9005, 1, '2023-02-28', '2023-03-01', 2, 3, 'PAR-01', 4, 39.99, 17.3333, 0, false, 160);
  // Keys the dimensions lack, and NULL keys.
  line(9006, 1, '2023-05-17', '2023-05-20', 999, 5, 'PAR-01', 2, 45.5, 20, 0, false, 91);
  line(9006, 2, '2023-05-17', '2023-05-20', null, 5, 'PAR-01', 1, 12, 6.25, 0, null, 12);
  line(9007, 1, '2024-01-09', '2024-01-11', 1, 500, 'NYC-01', 1, 12.5, 5.0001, 0, false, 13);
  line(9007, 2, '2024-01-09', '2024-01-11', 3, null, 'NYC-01', 6, 4.12, 1.9999, 0, false, 25);
  line(9008, 1, '2024-04-22', '2024-04-24', 6, 2, 'XXX-99', 2, 25, 11.1111, 0, false, 50);
  line(9008, 2, '2024-04-22', '2024-04-24', 7, 2, '', 1, 25, 11.1111, 0, false, 25);
  line(9008, 3, '2024-04-22', '2024-04-24', 17, 2, null, 1, 149, 70.0707, 0, false, 149);
  line(9009, 1, '2023-11-11', null, null, null, null, 1, 9.99, 3.3, 0, null, null);
  // Shipped after the Date table ends.
  line(9010, 1, '2024-12-30', '2025-01-03', 17, 6, 'TYO-01', 2, 149, 70.0707, 0, false, 298);
  // Fractional doubles that do not add up exactly in binary, zero and negative quantities.
  line(9011, 1, '2023-07-04', '2023-07-04', 13, 4, 'SFO-01', 1, 0.1, 0.0001, 0, false, 0);
  line(9011, 2, '2023-07-04', '2023-07-04', 13, 4, 'SFO-01', 1, 0.2, 0.0001, 0, false, 0);
  line(9012, 1, '2023-09-30', '2023-10-02', 4, 7, 'TYO-01', 0, 89.5, 40.2525, 0, true, 0);
  line(9013, 1, '2024-10-01', '2024-10-01', 4, 7, 'TYO-01', -1, 89.5, 40.2525, 0, false, -90);
  // A loyalty balance past 2^31.
  line(9014, 1, '2024-03-31', '2024-04-01', 14, 13, 'SYD-01', 1, 1234567.89, 987654.3219, 0, true, 5000000000);

  // --- target: store x brand x month, on the month's first day; whole months missing ---
  const target = [];
  const gaps = new Set(['2023-04', '2024-07', '2024-08']);
  for (const d of dates) {
    if (!d[0].endsWith('-01') || gaps.has(d[0].slice(0, 7))) continue;
    for (const sk of ['AMS-01', 'PAR-01', 'NYC-01', 'TYO-01', 'SYD-01']) {
      for (const brand of ['Contoso', 'Fabrikam', 'Ünïcorn']) {
        if (rnd() < 0.3) continue;
        target.push([d[0], sk, brand, round4(500 + rnd() * 4500)]);
      }
    }
  }
  // A brand Product does not have, a blank brand, a store Store does not have, a zero, a negative.
  target.push(['2023-06-01', 'AMS-01', 'Ghost', 1000]);
  target.push(['2024-02-01', 'PAR-01', null, 750.25]);
  target.push(['2024-05-01', 'ZZZ-00', 'Contoso', 333.3333]);
  target.push(['2023-12-01', 'NYC-01', 'Contoso', 0]);
  target.push(['2024-11-01', 'TYO-01', 'Fabrikam', -250.5]);

  return {
    Date: {
      columns: [['Date', 'dateTime'], ['Year', 'int64'], ['Quarter', 'string'], ['Month', 'int64'], ['Month Name', 'string'],
        ['YearMonth', 'int64'], ['Year Month', 'string'], ['Weekday', 'int64'], ['Day Name', 'string'], ['Weekend', 'boolean'], ['Day Of Year', 'int64']],
      rows: dates,
    },
    Region: { columns: [['RegionKey', 'int64'], ['Region', 'string']], rows: regions },
    Country: { columns: [['CountryKey', 'int64'], ['Country', 'string'], ['RegionKey', 'int64']], rows: countries },
    Store: {
      columns: [['StoreKey', 'string'], ['Store', 'string'], ['CountryKey', 'int64'], ['Square Meters', 'int64'], ['Opened', 'dateTime']],
      rows: stores,
    },
    StoreProfile: { columns: [['StoreKey', 'string'], ['Manager', 'string'], ['Format', 'string'], ['Floors', 'int64']], rows: profiles },
    Product: {
      columns: [['ProductKey', 'int64'], ['Product', 'string'], ['Code', 'string'], ['Brand', 'string'], ['Color', 'string'],
        ['Weight', 'double'], ['List Price', 'decimal']],
      rows: products,
    },
    Customer: { columns: [['CustomerKey', 'int64'], ['Customer', 'string'], ['Segment', 'string'], ['City', 'string']], rows: customers },
    Sales: {
      columns: [['Order Number', 'int64'], ['Line Number', 'int64'], ['Order Date', 'dateTime'], ['Ship Date', 'dateTime'],
        ['ProductKey', 'int64'], ['CustomerKey', 'int64'], ['StoreKey', 'string'], ['Quantity', 'int64'], ['Unit Price', 'double'],
        ['Unit Cost', 'decimal'], ['Discount', 'double'], ['Promo', 'boolean'], ['Loyalty Points', 'int64']],
      rows: sales,
    },
    Target: { columns: [['Date', 'dateTime'], ['StoreKey', 'string'], ['Brand', 'string'], ['Target', 'decimal']], rows: target },
  };
}
