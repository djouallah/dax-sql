// The edges model's measures: [table, name, expression]. Simple ones whose answers the awkward
// data makes hard (blank rows, NULL keys, zeros, ties, extreme magnitudes), and tricky ones.
export default [
  ['Sales', 'Sales Amount', 'SUMX(Sales, Sales[Quantity] * Sales[Unit Price])'],
  ['Sales', 'Total Cost', 'SUMX(Sales, Sales[Quantity] * Sales[Unit Cost])'],
  ['Sales', 'Margin', '[Sales Amount] - [Total Cost]'],
  ['Sales', 'Margin %', 'DIVIDE([Margin], [Sales Amount])'],
  ['Sales', 'Total Quantity', 'SUM(Sales[Quantity])'],
  ['Sales', 'Quantity Or Zero', 'COALESCE([Total Quantity], 0)'],
  ['Sales', 'Lines', 'COUNTROWS(Sales)'],
  ['Sales', 'Customers', 'DISTINCTCOUNT(Sales[CustomerKey])'],
  ['Sales', 'Customers No Blank', 'DISTINCTCOUNTNOBLANK(Sales[CustomerKey])'],
  ['Sales', 'Total Weight', 'SUMX(Sales, Sales[Quantity] * RELATED(Product[Weight]))'],
  ['Sales', 'Unshipped Lines', 'CALCULATE(COUNTROWS(Sales), ISBLANK(Sales[Ship Date]))'],
  ['Sales', 'Shipped Amount', "CALCULATE([Sales Amount], USERELATIONSHIP(Sales[Ship Date], 'Date'[Date]))"],
  ['Sales', 'Sales YTD', "TOTALYTD([Sales Amount], 'Date'[Date])"],
  ['Sales', 'Sales PY', "CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date]))"],
  ['Sales', 'Sales YoY %', 'VAR cur = [Sales Amount] VAR py = [Sales PY] RETURN IF(NOT ISBLANK(py), DIVIDE(cur - py, py))'],
  ['Sales', 'Share In Scope',
    'SWITCH(TRUE(), ISINSCOPE(Product[Product]), DIVIDE([Sales Amount], CALCULATE([Sales Amount], REMOVEFILTERS(Product[Product]))), '
    + 'ISINSCOPE(Product[Brand]), DIVIDE([Sales Amount], CALCULATE([Sales Amount], REMOVEFILTERS(Product[Brand]))), 1)'],
  ['Sales', 'Avg Per Customer', 'AVERAGEX(VALUES(Customer[CustomerKey]), [Sales Amount])'],
  ['Sales', 'Big Customers', 'COUNTROWS(FILTER(Customer, [Sales Amount] > 1000))'],
  ['Target', 'Target Amount', 'SUM(Target[Target])'],
  ['Target', 'Sales vs Target', 'DIVIDE([Sales Amount], [Target Amount])'],
];
