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
    title: 'No magic',
    lang: 'sql', write: sql2, sql: sql2, dax: dax2, compare: true,
    say: 'There is no magic in DAX. Every name stands for SQL you could write by hand: the compiled SQL has the joins you wrote. SQL engines do not take these questions only because nobody had done the work of compiling them. dax-sql is one example of that work, and there will be more: Apache Ossie gives semantic models an open format, and AI makes compilers like this cheap to write.',
  },
];

// The playground's time intelligence example.
const timeIntel = `EVALUATE
SUMMARIZECOLUMNS(
  'Date'[Year], 'Date'[Month],
  "Sales", [Sales Amount],
  "Last year", [Sales PY],
  "YTD", [Sales YTD]
)
ORDER BY 'Date'[Year], 'Date'[Month]`;

// The playground's first two examples.
const y = "'Date'[Year]";
const sc = cols => `EVALUATE\nSUMMARIZECOLUMNS(\n  ${[y, ...cols].join(',\n  ')}\n)\nORDER BY ${y}`;

// One plan, two languages: a SELECT over the model, and the DAX it stands for.
export const sql = `SELECT Color, AGG([Sales Amount]) AS sales, MEASURE(Orders) AS orders
FROM contoso
WHERE Customer.City = 'Paris'
GROUP BY ALL
ORDER BY Color`;

// A query nobody wrote a case for.
export const unseen = `EVALUATE
SUMMARIZECOLUMNS(
  Customer[City],
  "Sales", [Sales Amount],
  "Share", DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED(Customer))),
  "Top product", CONCATENATEX(TOPN(1, VALUES(Product[Name]), [Sales Amount]), Product[Name], ", ")
)
ORDER BY [Sales] DESC`;

// The playground's examples.
export const playground = [
  ['Sales by year', sc(['"Sales", [Sales Amount]'])],
  ['Five filter contexts', sc([
    '"Sales", [Sales Amount]',
    '"Bikes", CALCULATE([Sales Amount], Category[Category] = "Bikes")',
    `"All years", CALCULATE([Sales Amount], ALL('Date'))`,
    '"Best customer", MAXX(VALUES(Customer[Customer]), [Sales Amount])',
  ])],
  ['Time intelligence', timeIntel],
  ['Share of category', `EVALUATE
SUMMARIZECOLUMNS(
  Category[Category], Product[Name],
  "Sales", [Sales Amount],
  "Share of category", [Share of Category]
)
ORDER BY Category[Category], Product[Name]`],
  ['Inactive relationship', `EVALUATE
SUMMARIZECOLUMNS(
  'Date'[Year], 'Date'[Month],
  "By order date", [Sales Amount],
  "By ship date", [Sales by Ship Date]
)
ORDER BY 'Date'[Year], 'Date'[Month]`],
  ['Many-to-many', `EVALUATE
SUMMARIZECOLUMNS(
  Customer[City],
  "Sales", [Sales Amount],
  "Target", [Target]
)
ORDER BY Customer[City]`],
  ['Calculation group', `EVALUATE
SUMMARIZECOLUMNS(
  'Date'[Year], 'Time Calc'[Time Calc],
  "Sales", [Sales Amount]
)
ORDER BY 'Date'[Year], 'Time Calc'[Time Calc]`],
  ['Ranking', `EVALUATE
ADDCOLUMNS(
  VALUES(Product[Name]),
  "Sales", [Sales Amount],
  "Rank", RANKX(ALL(Product[Name]), [Sales Amount])
)
ORDER BY [Rank]`],
  ['A query nobody wrote a case for', unseen],
  ['SQL over the model', sql],
];
