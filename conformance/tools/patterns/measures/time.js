// Measures for the time family (queries/patterns/time/): [table, name, expression].
export default [
  // Fiscal calendar (the fiscal year ends on June 30).
  ['Sales', 'Sales Fiscal YTD', `CALCULATE([Sales Amount], DATESYTD('Date'[Date], "6/30"))`],
  ['Sales', 'Sales Fiscal YTD Manual', `VAR fy = MAX('Date'[Fiscal Year]) VAR lastDay = MAX('Date'[Date]) RETURN CALCULATE([Sales Amount], FILTER(ALL('Date'), 'Date'[Fiscal Year] = fy && 'Date'[Date] <= lastDay))`],
  ['Sales', 'Sales Fiscal PY Manual', `VAR fy = MAX('Date'[Fiscal Year]) RETURN CALCULATE([Sales Amount], REMOVEFILTERS('Date'), 'Date'[Fiscal Year] = fy - 1, VALUES('Date'[Fiscal Month]))`],
  ['Budget', 'Budget Fiscal YTD', `CALCULATE([Budget Amount], DATESYTD('Date'[Date], "6/30"))`],
  // ISO-week calendar.
  ['Sales', 'Sales ISO YTD', `VAR y = MAX('Date'[ISO Year]) VAR d = MAX('Date'[Date]) RETURN CALCULATE([Sales Amount], REMOVEFILTERS('Date'), 'Date'[ISO Year] = y, 'Date'[Date] <= d)`],
  ['Sales', 'Sales ISO Week PY', `VAR y = MAX('Date'[ISO Year]) RETURN CALCULATE([Sales Amount], REMOVEFILTERS('Date'), 'Date'[ISO Year] = y - 1, VALUES('Date'[ISO Week]))`],
  // Previous periods.
  ['Sales', 'Sales PY SPLY', `CALCULATE([Sales Amount], SAMEPERIODLASTYEAR('Date'[Date]))`],
  ['Sales', 'Sales PY DateAdd', `CALCULATE([Sales Amount], DATEADD('Date'[Date], -1, YEAR))`],
  ['Sales', 'Sales PY Parallel', `CALCULATE([Sales Amount], PARALLELPERIOD('Date'[Date], -1, YEAR))`],
  ['Sales', 'Sales PQ Parallel', `CALCULATE([Sales Amount], PARALLELPERIOD('Date'[Date], -1, QUARTER))`],
  ['Sales', 'Sales PM DateAdd', `CALCULATE([Sales Amount], DATEADD('Date'[Date], -1, MONTH))`],
  ['Sales', 'Sales YoY % DateAdd', `VAR cur = [Sales Amount] VAR py = [Sales PY DateAdd] RETURN IF(NOT ISBLANK(cur) && NOT ISBLANK(py), DIVIDE(cur - py, py))`],
  ['Sales', 'Sales Month To Date', `TOTALMTD([Sales Amount], 'Date'[Date])`],
  ['Sales', 'Sales Prior Month To Date', `CALCULATE([Sales Amount], DATEADD(DATESMTD('Date'[Date]), -1, MONTH))`],
  // Moving windows.
  ['Sales', 'Sales Moving Avg 3M', `VAR period = DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH) RETURN CALCULATE(AVERAGEX(VALUES('Date'[YearMonth]), [Sales Amount]), period)`],
  ['Sales', 'Sales Rolling 30D', `CALCULATE([Sales Amount], DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -30, DAY))`],
  ['Sales', 'Sales Rolling 12M Manual', `VAR d = MAX('Date'[Date]) RETURN CALCULATE([Sales Amount], FILTER(ALL('Date'), 'Date'[Date] > EDATE(d, -12) && 'Date'[Date] <= d))`],
  ['Sales', 'Sales Last Day With Sales', `CALCULATE([Sales Amount], LASTNONBLANK('Date'[Date], [Sales Amount]))`],
  // Events in progress: an order is open from its order date until its delivery date.
  ['Sales', 'Sales By Delivery Date', `CALCULATE([Sales Amount], USERELATIONSHIP(Sales[Delivery Date], 'Date'[Date]))`],
  ['Sales', 'Orders In Transit EOP', `VAR d = MAX('Date'[Date]) RETURN CALCULATE(DISTINCTCOUNT(Sales[Order Number]), REMOVEFILTERS('Date'), Sales[Order Date] <= d, Sales[Delivery Date] > d)`],
  ['Sales', 'Orders Active In Period', `VAR lo = MIN('Date'[Date]) VAR hi = MAX('Date'[Date]) RETURN CALCULATE(DISTINCTCOUNT(Sales[Order Number]), REMOVEFILTERS('Date'), Sales[Order Date] <= hi, Sales[Delivery Date] >= lo)`],
  // Semi-additive inventory balances (snapshots at month ends).
  ['Inventory', 'Inventory Closing Month', `CLOSINGBALANCEMONTH(SUM(Inventory[On Hand]), 'Date'[Date])`],
  ['Inventory', 'Inventory Closing Fiscal Year', `CLOSINGBALANCEYEAR(SUM(Inventory[On Hand]), 'Date'[Date], "6/30")`],
  ['Inventory', 'Inventory Opening Quarter', `OPENINGBALANCEQUARTER(SUM(Inventory[On Hand]), 'Date'[Date])`],
  ['Inventory', 'Inventory Last Date', `CALCULATE(SUM(Inventory[On Hand]), LASTDATE('Date'[Date]))`],
  ['Inventory', 'Inventory Last Per Product', `SUMX(VALUES(Product[ProductKey]), CALCULATE(SUM(Inventory[On Hand]), LASTNONBLANK('Date'[Date], CALCULATE(COUNTROWS(Inventory)))))`],
  ['Inventory', 'Inventory Avg Month End', `AVERAGEX(VALUES('Date'[YearMonth]), CALCULATE(SUM(Inventory[On Hand]), LASTDATE('Date'[Date])))`],
];
