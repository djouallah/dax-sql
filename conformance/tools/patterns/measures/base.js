// The model's core measures: [table, name, expression]. The corpus families add theirs in
// files of their own.
export default [
  ['Sales', 'Sales Amount', 'SUMX(Sales, Sales[Quantity] * Sales[Net Price])'],
  ['Sales', 'Total Cost', 'SUMX(Sales, Sales[Quantity] * Sales[Unit Cost])'],
  ['Sales', 'Margin', '[Sales Amount] - [Total Cost]'],
  ['Sales', 'Margin %', 'DIVIDE([Margin], [Sales Amount])'],
  ['Sales', 'Total Quantity', 'SUM(Sales[Quantity])'],
  ['Sales', 'Order Lines', 'COUNTROWS(Sales)'],
  ['Sales', 'Orders', 'DISTINCTCOUNT(Sales[Order Number])'],
  ['Sales', 'Customers', 'DISTINCTCOUNT(Sales[CustomerKey])'],
  ['Sales', 'Avg Order Value', 'DIVIDE([Sales Amount], [Orders])'],
  ['Sales', 'Sales USD', "SUMX(SUMMARIZE(Sales, 'Date'[Date], Currency[CurrencyCode]), [Sales Amount] * [Exchange Rate])"],
  ['ExchangeRate', 'Exchange Rate', "VAR d = MAX('Date'[Date]) RETURN CALCULATE(AVERAGE(ExchangeRate[Rate]), LASTNONBLANK(FILTER(ALL('Date'[Date]), 'Date'[Date] <= d), CALCULATE(COUNTROWS(ExchangeRate))))"],
  ['Budget', 'Budget Amount', 'SUM(Budget[Budget])'],
  ['Inventory', 'Stock On Hand', "CALCULATE(SUM(Inventory[On Hand]), LASTNONBLANK('Date'[Date], CALCULATE(COUNTROWS(Inventory))))"],
  ['Inventory', 'Snapshots', 'COUNTROWS(Inventory)'],
];
