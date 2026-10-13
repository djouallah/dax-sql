// Measures for the segmentation family (queries/patterns/segmentation/): [table, name, expression].
export default [
  // Dynamic segmentation: customers or products classified against the disconnected Segments
  // table (Min Sales inclusive, Max Sales exclusive).
  ['Sales', 'Segment Customer Count', 'COUNTROWS(FILTER(VALUES(Customer[CustomerKey]), VAR s = [Sales Amount] RETURN NOT ISBLANK(s) && NOT ISEMPTY(FILTER(Segments, s >= Segments[Min Sales] && s < Segments[Max Sales]))))'],
  ['Sales', 'Segment Customer Sales', 'CALCULATE([Sales Amount], FILTER(VALUES(Customer[CustomerKey]), VAR s = [Sales Amount] RETURN NOT ISEMPTY(FILTER(Segments, s >= Segments[Min Sales] && s < Segments[Max Sales]))))'],
  ['Sales', 'Segment Customer Count Fixed', "COUNTROWS(FILTER(VALUES(Customer[CustomerKey]), VAR s = CALCULATE([Sales Amount], REMOVEFILTERS('Date')) RETURN NOT ISBLANK([Sales Amount]) && NOT ISEMPTY(FILTER(Segments, s >= Segments[Min Sales] && s < Segments[Max Sales]))))"],
  ['Sales', 'Segment Customer Sales Fixed', "CALCULATE([Sales Amount], FILTER(VALUES(Customer[CustomerKey]), VAR s = CALCULATE([Sales Amount], REMOVEFILTERS('Date')) RETURN NOT ISBLANK(s) && NOT ISEMPTY(FILTER(Segments, s >= Segments[Min Sales] && s < Segments[Max Sales]))))"],
  ['Sales', 'Segment Customer Count AOV', 'COUNTROWS(FILTER(VALUES(Customer[CustomerKey]), VAR v = [Avg Order Value] RETURN NOT ISBLANK(v) && NOT ISEMPTY(FILTER(Segments, v >= Segments[Min Sales] && v < Segments[Max Sales]))))'],
  ['Sales', 'Segment Product Count', 'COUNTROWS(FILTER(VALUES(Product[ProductKey]), VAR s = [Sales Amount] RETURN NOT ISBLANK(s) && NOT ISEMPTY(FILTER(Segments, s >= Segments[Min Sales] && s < Segments[Max Sales]))))'],
  ['Sales', 'Customer Sales Band', 'VAR s = [Sales Amount] RETURN IF(NOT ISBLANK(s), MAXX(FILTER(ALL(Segments), s >= Segments[Min Sales] && s < Segments[Max Sales]), Segments[Segment]))'],

  // ABC / Pareto.
  ['Sales', 'ABC Product Cumulative %', 'VAR cur = [Sales Amount] VAR items = ADDCOLUMNS(ALLSELECTED(Product[Product]), "@s", [Sales Amount]) VAR cum = SUMX(FILTER(items, [@s] >= cur), [@s]) RETURN IF(HASONEVALUE(Product[Product]) && NOT ISBLANK(cur), DIVIDE(cum, SUMX(items, [@s])))'],
  ['Sales', 'ABC Product Class', 'VAR p = [ABC Product Cumulative %] RETURN IF(NOT ISBLANK(p), SWITCH(TRUE(), p <= 0.7, "A", p <= 0.9, "B", "C"))'],
  ['Sales', 'Pareto Customer Cumulative Sales', 'VAR cur = [Sales Amount] VAR items = ADDCOLUMNS(ALLSELECTED(Customer[Customer]), "@s", [Sales Amount]) RETURN IF(HASONEVALUE(Customer[Customer]) && NOT ISBLANK(cur), SUMX(FILTER(items, [@s] >= cur), [@s]))'],
  ['Sales', 'Pareto 80 Customer Count', 'VAR items = ADDCOLUMNS(VALUES(Customer[Customer]), "@s", [Sales Amount]) VAR tot = SUMX(items, [@s]) VAR withCum = ADDCOLUMNS(FILTER(items, NOT ISBLANK([@s])), "@cum", VAR s = [@s] RETURN SUMX(FILTER(items, [@s] >= s), [@s])) RETURN COUNTROWS(FILTER(withCum, [@cum] <= 0.8 * tot))'],

  // Ranking.
  ['Sales', 'Product Sales Rank Skip', 'IF(HASONEVALUE(Product[Product]), RANKX(ALLSELECTED(Product[Product]), [Sales Amount], , DESC, SKIP))'],
  ['Sales', 'Customer Sales Rank Skip', 'IF(HASONEVALUE(Customer[Customer]) && NOT ISBLANK([Sales Amount]), RANKX(ALLSELECTED(Customer[Customer]), [Sales Amount], , DESC, SKIP))'],
  ['Sales', 'Subcategory Rank In Scope', 'SWITCH(TRUE(), ISINSCOPE(Subcategory[Subcategory]), RANKX(ALLSELECTED(Subcategory[Subcategory]), [Sales Amount], , DESC, SKIP), ISINSCOPE(Category[Category]), RANKX(ALLSELECTED(Category[Category]), [Sales Amount], , DESC, SKIP))'],
  ['Sales', 'Category Rank By Metric', 'VAR m = SELECTEDVALUE(Metric[Metric]) RETURN IF(HASONEVALUE(Category[Category]) && NOT ISBLANK(m), RANKX(ALLSELECTED(Category[Category]), SWITCH(m, "Sales", [Sales Amount], "Margin", [Margin], "Quantity", CALCULATE(SUM(Sales[Quantity]))), , DESC, DENSE))'],

  // Cumulative totals.
  ['Sales', 'Cumulative Sales All Dates', "CALCULATE([Sales Amount], FILTER(ALL('Date'), 'Date'[Date] <= MAX('Date'[Date])))"],
  ['Sales', 'Cumulative Sales In Selection', "VAR d = MAX('Date'[Date]) RETURN CALCULATE([Sales Amount], 'Date'[Date] <= d, ALLSELECTED('Date'))"],
  ['Sales', 'Cumulative Sales Window', "CALCULATE([Sales Amount], WINDOW(1, ABS, 0, REL, ALLSELECTED('Date'[Year Month]), ORDERBY('Date'[Year Month], ASC)))"],
  ['Sales', 'Cumulative Customers Distinct', "VAR d = MAX('Date'[Date]) RETURN CALCULATE([Customers], 'Date'[Date] <= d, REMOVEFILTERS('Date'))"],
  ['Sales', 'Cumulative Sales Delivered', "VAR d = MAX('Date'[Date]) RETURN CALCULATE([Sales Amount], USERELATIONSHIP(Sales[Delivery Date], 'Date'[Date]), 'Date'[Date] <= d, REMOVEFILTERS('Date'))"],
];
