// The queries the site compiles, live, with the compiler on main. They run over the small
// Contoso-like model in test/fixtures/contoso.js (11 sales, 5 products, 4 customers, 2023-2024).

// The problem, in five steps: a question in SQL, the next question, the model written once,
// the question as names, and the SQL it compiles to. The hand-written SQL is labelled as such
// on the page; the rest is compiled in the browser.
const sql1 = `SELECT d."Year", SUM(s."Amount") AS "Sales"
FROM "Sales" AS s
JOIN "Date" AS d ON d."Date" = s."OrderDate"
GROUP BY d."Year"
ORDER BY d."Year"`;

const sql2 = `SELECT d."Year",
  SUM(s."Amount") AS "Sales",
  SUM(CASE WHEN c."Category" = 'Bikes' THEN s."Amount" END) AS "Bikes",
  SUM(CASE WHEN c."Category" = 'Bikes' THEN s."Amount" END) / SUM(s."Amount") AS "Bikes share"
FROM "Sales" AS s
JOIN "Date" AS d ON d."Date" = s."OrderDate"
JOIN "Product" AS p ON p."ProductKey" = s."ProductKey"
JOIN "Category" AS c ON c."CategoryKey" = p."CategoryKey"
GROUP BY d."Year"
ORDER BY d."Year"`;

const dax2 = `EVALUATE
SUMMARIZECOLUMNS(
  'Date'[Year],
  "Sales", [Sales Amount],
  "Bikes", CALCULATE([Sales Amount], Category[Category] = "Bikes"),
  "Bikes share", DIVIDE(CALCULATE([Sales Amount], Category[Category] = "Bikes"), [Sales Amount])
)
ORDER BY 'Date'[Year]`;

const checks2 = [
  'Sales meets Date on OrderDate, not ShipDate',
  'Sales meets Product on ProductKey',
  'Product meets Category on CategoryKey',
  'a join that repeats a sale counts it twice',
  '"Bikes" is the same filter in every column that needs it',
  '"Sales" is SUM(Amount) every time, in every query',
];

export const problem = [
  {
    title: 'A question in SQL',
    lang: 'sql', write: sql1, sql: sql1,
    checks: ['Sales meets Date on OrderDate, not ShipDate', 'group by the year', '"Sales" is SUM(Amount)'],
    say: 'Sales by year. In SQL you write the whole query: the join, the group, the sum. It is exact, and this one is easy.',
  },
  {
    title: 'The next question',
    lang: 'sql', write: sql2, sql: sql2,
    checks: checks2,
    say: 'Now bikes beside all sales, and their share. The whole query again: two more joins, a filter, a division. Still exact, but every question restates how the tables meet and what "sales" means, and each new line is one more place to get it wrong.',
  },
  {
    title: 'A semantic model writes it once',
    lang: 'model',
    rels: ['sales_orderdate', 'sales_product', 'product_category'],
    measures: ['Sales Amount'],
    checks: ['how Sales meets Date', 'how Sales meets Product, and Product Category', 'what "Sales" means'],
    say: 'A semantic model holds the parts every question repeats: how the tables meet (the relationships) and what the numbers mean (the measures). They are written once, next to the data.',
  },
  {
    title: 'Then a question is just names',
    lang: 'dax', write: dax2, dax: dax2,
    checks: checks2,
    say: 'The same question, asked by name: the year, [Sales Amount], and a filter on Category. No joins in it. The model knows how Category reaches Sales, so the query only says what it wants.',
  },
  {
    title: 'Why not let AI write it?',
    lang: 'sql', write: sql2, sql: sql2, who: 'llm',
    writeHead: 'What an LLM might write, at run time',
    rightHead: 'What it must get right, every time it is asked',
    checks: checks2,
    say: 'Modern LLMs can write this SQL at run time, and they are often right. Often is not always, and a wrong query still returns numbers that look fine. From here it is opinion. Some people think that means we no longer need a compiler. My view: turning names into SQL is a deterministic problem, like arithmetic, and AI is the least efficient way to solve a deterministic problem. Nobody asks an LLM to add up a column; they give it a calculator. A compiler is that calculator: let AI pick the names, and let the compiler write the SQL.',
  },
];

// The playground's examples: SQL over the model (a measure is AGG(name); the model knows the
// joins), each shown beside as DAX and, where it has one, as Apache Ossie's wide table JSON
// (Layer 3). The playground takes DAX too.
export const playground = [
  ['Sales by year', `SELECT "Date".Year, AGG("Sales Amount") AS sales
FROM contoso
GROUP BY ALL
ORDER BY Year`],
  ['Filters', `SELECT Category.Category, Product.Color, AGG("Sales Amount") AS sales, AGG(Orders) AS orders
FROM contoso
WHERE Customer.City IN ('Paris', 'Lyon') AND "Date".Year = 2024
GROUP BY ALL
ORDER BY Category, Color`],
  ['Measures that change the filter', `SELECT Category.Category, AGG("Sales Amount") AS sales,
  AGG("All Sales") AS all_sales, AGG("Red Sales") AS red_sales,
  AGG("Best Customer Sales") AS best_customer
FROM contoso
GROUP BY ALL
ORDER BY Category`],
  ['Time intelligence', `SELECT "Date".Year, "Date".Month, AGG("Sales Amount") AS sales,
  AGG("Sales PY") AS last_year, AGG("Sales YTD") AS ytd
FROM contoso
GROUP BY ALL
ORDER BY Year, Month`],
  ['Share of category', `SELECT Category.Category, Product.Name, AGG("Sales Amount") AS sales,
  AGG("Share of Category") AS share
FROM contoso
GROUP BY ALL
ORDER BY Category, Name`],
  ['Inactive relationship', `SELECT "Date".Year, "Date".Month, AGG("Sales Amount") AS by_order_date,
  AGG("Sales by Ship Date") AS by_ship_date
FROM contoso
GROUP BY ALL
ORDER BY Year, Month`],
  ['Many-to-many', `SELECT Customer.City, AGG("Sales Amount") AS sales, AGG(Target) AS target
FROM contoso
GROUP BY ALL
ORDER BY City`],
  ['Calculation group', `SELECT "Date".Year, "Time Calc"."Time Calc", AGG("Sales Amount") AS sales
FROM contoso
GROUP BY ALL
ORDER BY Year, "Time Calc"`],
  ['Top products', `SELECT Product.Name, AGG("Sales Amount") AS sales
FROM contoso
GROUP BY ALL
ORDER BY sales DESC
FETCH FIRST 3 ROWS WITH TIES`],
  ['Subtotals', `SELECT Category.Category, Product.Color, AGG("Sales Amount") AS sales,
  GROUPING(Product.Color) AS is_total
FROM contoso
GROUP BY Category.Category, ROLLUP(Product.Color)
ORDER BY Category, is_total, Color`],
  ['Groups that pass a test', `SELECT Customer.Customer, AGG(Orders) AS orders, AGG("Sales Amount") AS sales
FROM contoso
GROUP BY ALL
HAVING orders > 1
ORDER BY sales DESC`],
  ['Two facts, one dimension', `SELECT Category.Category, AGG("Sales Amount") AS sales, AGG(Returned) AS returned
FROM contoso
WHERE Product.Color <> 'Red'
GROUP BY ALL`],
];
