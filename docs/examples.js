// The queries the site compiles, live, with the compiler on main. They run over the small
// Contoso-like model in test/fixtures/contoso.js (11 sales, 5 products, 4 customers, 2023-2024).

// The problem: one measure, [Sales Amount] = SUM(Sales[Amount]), asked in five places.
// Each step adds one column to the same query.
const y = "'Date'[Year]";
const cols = [
  ['"Sales", [Sales Amount]'],
  ['"Bikes", CALCULATE([Sales Amount], Category[Category] = "Bikes")'],
  ['"All years", CALCULATE([Sales Amount], ALL(\'Date\'))'],
  ['"Best customer", MAXX(VALUES(Customer[Customer]), [Sales Amount])'],
];
const sc = n => `EVALUATE\nSUMMARIZECOLUMNS(\n  ${[y, ...cols.slice(0, n).map(c => c[0])].join(',\n  ')}\n)\nORDER BY ${y}`;

export const problem = [
  {
    title: 'A total',
    dax: 'EVALUATE ROW("Sales", [Sales Amount])',
    ctx: [],
    say: 'Asked alone, the measure sees every sale. The filter context is empty, and the SQL is one SUM.',
  },
  {
    title: 'By year',
    dax: sc(1),
    ctx: [['bind', "'Date'[Year] = the row's year"], ['path', 'Date filters Sales on OrderDate']],
    say: 'Now each row of the result asks it again, for its own year. Sales has no Year column: the filter reaches Sales only through the relationship on OrderDate, so the SQL needs a join.',
  },
  {
    title: 'A filter two tables away',
    dax: sc(2),
    ctx: [['bind', "'Date'[Year] = the row's year"], ['pred', 'Category[Category] = "Bikes"'], ['path', 'Category → Product → Sales']],
    say: 'CALCULATE adds a filter on Category. Nothing in the query says how Category meets Sales: the model does, through Product. Same measure, another join path.',
  },
  {
    title: 'A filter taken away',
    dax: sc(3),
    ctx: [['removed', "ALL('Date') drops the year"]],
    say: "ALL('Date') removes the row's year, so this column is the grand total on every row. The measure is the same text; its filter context is not.",
  },
  {
    title: 'A row becomes a filter',
    dax: sc(4),
    ctx: [['bind', "'Date'[Year] = the row's year"], ['bind', "Customer[Customer] = MAXX's current row"]],
    say: "MAXX walks the customers, and inside it [Sales Amount] turns each customer's row into a filter: context transition. The SQL has to compute sales per year and customer, then take the max.",
  },
];

// How it works: time intelligence, the case where the rewrites matter most.
export const how = `EVALUATE
SUMMARIZECOLUMNS(
  'Date'[Year], 'Date'[Month],
  "Sales", [Sales Amount],
  "Last year", [Sales PY],
  "YTD", [Sales YTD]
)
ORDER BY 'Date'[Year], 'Date'[Month]`;

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
  ['Sales by year', sc(1)],
  ['Five filter contexts', sc(4)],
  ['Time intelligence', how],
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
