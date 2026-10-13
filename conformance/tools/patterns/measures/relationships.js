// Measures for the relationships family (queries/patterns/relationships/): [table, name, expression].
export default [
  // Role-playing dates: the inactive Delivery Date relationship, and its virtual twin.
  ['Sales', 'Sales Delivered via Relationship', "CALCULATE([Sales Amount], USERELATIONSHIP(Sales[Delivery Date], 'Date'[Date]))"],
  ['Sales', 'Sales Delivered via Treatas', "CALCULATE([Sales Amount], REMOVEFILTERS('Date'), TREATAS(VALUES('Date'[Date]), Sales[Delivery Date]))"],
  ['Sales', 'Sales Ordered and Delivered in Period', "CALCULATE([Sales Amount], TREATAS(VALUES('Date'[Date]), Sales[Delivery Date]))"],
  ['Sales', 'Orders in Transit Relationship', "VAR d = MAX('Date'[Date]) RETURN CALCULATE(DISTINCTCOUNT(Sales[Order Number]), REMOVEFILTERS('Date'), Sales[Order Date] <= d, Sales[Delivery Date] > d)"],
  ['Sales', 'Sales Ignoring Date Relationship', "CALCULATE([Sales Amount], CROSSFILTER(Sales[Order Date], 'Date'[Date], NONE))"],

  // Currency conversion through ExchangeRate.
  ['Sales', 'Sales USD Delivered Relationship', "CALCULATE([Sales USD], USERELATIONSHIP(Sales[Delivery Date], 'Date'[Date]))"],
  ['ExchangeRate', 'Avg Daily Rate Relationship', "AVERAGEX(VALUES('Date'[Date]), [Exchange Rate])"],

  // Budget at category x month, read at other grains.
  ['Budget', 'Budget Allocated by Day', "SUMX(VALUES('Date'[YearMonth]), VAR ym = 'Date'[YearMonth] VAR daysSelected = CALCULATE(COUNTROWS('Date')) VAR daysInMonth = CALCULATE(COUNTROWS('Date'), REMOVEFILTERS('Date'), 'Date'[YearMonth] = ym) RETURN DIVIDE(CALCULATE([Budget Amount]) * daysSelected, daysInMonth))"],
  ['Budget', 'Budget at Valid Grain', "VAR daysSelected = COUNTROWS('Date') VAR daysInMonths = CALCULATE(COUNTROWS('Date'), REMOVEFILTERS('Date'), VALUES('Date'[YearMonth])) RETURN IF(NOT ISFILTERED(Product) && NOT ISFILTERED(Subcategory) && daysSelected = daysInMonths, [Budget Amount])"],
  ['Budget', 'Budget via Product Category', 'CALCULATE([Budget Amount], TREATAS(VALUES(Product[Category]), Category[Category]))'],
  ['Budget', 'Budget Allocated to Product', 'SUMX(VALUES(Product[Category]), VAR c = Product[Category] VAR share = DIVIDE([Sales Amount], CALCULATE([Sales Amount], REMOVEFILTERS(Product), Product[Category] = c)) RETURN share * CALCULATE([Budget Amount], TREATAS({ c }, Category[Category])))'],

  // The Account <-> Customer bridge.
  ['Account', 'Accounts Held Bridge', 'CALCULATE(COUNTROWS(Account), CROSSFILTER(AccountCustomer[AccountKey], Account[AccountKey], BOTH))'],
  ['Account', 'Accounts with Sales Bridge', 'CALCULATE(COUNTROWS(Account), CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH), CROSSFILTER(AccountCustomer[AccountKey], Account[AccountKey], BOTH))'],
  ['Sales', 'Sales via Account Iteration', 'SUMX(Account, [Sales Amount])'],
  ['Sales', 'Sales without Account Bridge', 'CALCULATE([Sales Amount], FILTER(Customer, ISEMPTY(RELATEDTABLE(AccountCustomer))))'],
  ['Customer', 'Customers with Sales Relationship', 'CALCULATE(COUNTROWS(Customer), CROSSFILTER(Sales[CustomerKey], Customer[CustomerKey], BOTH))'],

  // RELATED from the fact.
  ['Sales', 'List Price Amount Related', 'SUMX(Sales, Sales[Quantity] * RELATED(Product[Unit Price]))'],
];
