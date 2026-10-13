// Measures for the customers family (queries/patterns/customers/): [table, name, expression].
export default [
  // New / returning: a customer is new in a period when the first purchase ever (the date filter
  // removed, every other filter kept) falls in it, returning when it falls before it.
  ['Sales', 'Customers New', `
VAR MinD = MIN('Date'[Date])
RETURN COUNTROWS(
    FILTER(VALUES(Sales[CustomerKey]),
        CALCULATE(MIN(Sales[Order Date]), REMOVEFILTERS('Date')) >= MinD))`],
  ['Sales', 'Customers Returning', `
VAR MinD = MIN('Date'[Date])
RETURN COUNTROWS(
    FILTER(VALUES(Sales[CustomerKey]),
        CALCULATE(MIN(Sales[Order Date]), REMOVEFILTERS('Date')) < MinD))`],
  // The same, as SQLBI writes it: the first-purchase date given the lineage of 'Date'[Date].
  ['Sales', 'Customers New Lineage', `
VAR CustomersWithNewDate =
    CALCULATETABLE(
        ADDCOLUMNS(VALUES(Sales[CustomerKey]), "@NewCustomerDate", CALCULATE(MIN(Sales[Order Date]))),
        REMOVEFILTERS('Date'))
VAR CustomersWithLineage = TREATAS(CustomersWithNewDate, Sales[CustomerKey], 'Date'[Date])
RETURN CALCULATE(DISTINCTCOUNT(Sales[CustomerKey]), KEEPFILTERS(CustomersWithLineage))`],
  // Static: from the Customer[First Order] calculated column, blind to product filters.
  ['Customer', 'Customers New Static', `
CALCULATE(COUNTROWS(Customer), KEEPFILTERS(TREATAS(VALUES('Date'[Date]), Customer[First Order])))`],
  ['Sales', 'Customers New Sales', `
VAR MinD = MIN('Date'[Date])
VAR NewCustomers =
    FILTER(VALUES(Sales[CustomerKey]),
        CALCULATE(MIN(Sales[Order Date]), REMOVEFILTERS('Date')) >= MinD)
RETURN CALCULATE([Sales Amount], NewCustomers)`],
  // Lost: the last purchase up to the period's end is 90 days old somewhere inside the period.
  ['Sales', 'Customers Lost 90d', `
VAR MinD = MIN('Date'[Date])
VAR MaxD = MAX('Date'[Date])
VAR Candidates = CALCULATETABLE(VALUES(Sales[CustomerKey]), REMOVEFILTERS('Date'), 'Date'[Date] <= MaxD)
RETURN COUNTROWS(
    FILTER(Candidates,
        VAR LastOrder = CALCULATE(MAX(Sales[Order Date]), REMOVEFILTERS('Date'), 'Date'[Date] <= MaxD)
        RETURN LastOrder + 90 >= MinD && LastOrder + 90 <= MaxD))`],
  // Recovered: buys in the period after more than 90 days without buying.
  ['Sales', 'Customers Recovered 90d', `
VAR MinD = MIN('Date'[Date])
RETURN COUNTROWS(
    FILTER(VALUES(Sales[CustomerKey]),
        VAR FirstInPeriod = CALCULATE(MIN(Sales[Order Date]))
        VAR PrevOrder = CALCULATE(MAX(Sales[Order Date]), REMOVEFILTERS('Date'), 'Date'[Date] < MinD)
        RETURN NOT ISBLANK(PrevOrder) && DATEDIFF(PrevOrder, FirstInPeriod, DAY) > 90))`],
  ['Sales', 'Customers Repeat', `
COUNTROWS(FILTER(VALUES(Sales[CustomerKey]), CALCULATE(DISTINCTCOUNT(Sales[Order Number])) > 1))`],
  ['Sales', 'Customers To Date', `
VAR MaxD = MAX('Date'[Date])
RETURN CALCULATE([Customers], REMOVEFILTERS('Date'), 'Date'[Date] <= MaxD)`],
  ['Sales', 'Customers Avg Days Between Orders', `
AVERAGEX(
    FILTER(VALUES(Sales[CustomerKey]), CALCULATE(DISTINCTCOUNT(Sales[Order Date])) > 1),
    VAR FirstD = CALCULATE(MIN(Sales[Order Date]))
    VAR LastD = CALCULATE(MAX(Sales[Order Date]))
    VAR N = CALCULATE(DISTINCTCOUNT(Sales[Order Date]))
    RETURN DIVIDE(DATEDIFF(FirstD, LastD, DAY), N - 1))`],
  ['Sales', 'Customers Avg Active Months', `
AVERAGEX(VALUES(Sales[CustomerKey]), CALCULATE(COUNTROWS(SUMMARIZE(Sales, 'Date'[YearMonth]))))`],
  ['Customer', 'Customers Via Expanded Sales', 'CALCULATE(COUNTROWS(Customer), Sales)'],
  ['Sales', 'Customer First Purchase', `CALCULATE(MIN(Sales[Order Date]), REMOVEFILTERS('Date'))`],
  ['Sales', 'Customer Distinct Products', 'DISTINCTCOUNT(Sales[ProductKey])'],
  // Basket: the orders in context that also hold a line of the Bikes category.
  ['Sales', 'Basket Orders With Bikes', `
VAR BikeOrders =
    CALCULATETABLE(VALUES(Sales[Order Number]),
        REMOVEFILTERS(Product), REMOVEFILTERS(Subcategory), REMOVEFILTERS(Category),
        Category[Category] = "Bikes")
RETURN CALCULATE([Orders], KEEPFILTERS(BikeOrders))`],
  ['Sales', 'Basket Bike Attach %', 'DIVIDE([Basket Orders With Bikes], [Orders])'],
];
