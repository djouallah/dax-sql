// Measures for the queries family (queries/patterns/queries/): [table, name, expression].
// The measures Power BI visuals lean on: field-parameter switching, shares of the visual's
// selection, scope labels, ranks and window functions over the visual's axis.
export default [
  ['Sales', 'Visual Metric Value', 'SWITCH(SELECTEDVALUE(Metric[Metric Order]), 0, [Sales Amount], 1, [Margin], 2, SUM(Sales[Quantity]))'],
  ['Sales', 'Visual Share of Selected', 'DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED()))'],
  ['Sales', 'Visual Level Label', 'SWITCH(TRUE(), ISINSCOPE(Subcategory[Subcategory]), "Subcategory", ISINSCOPE(Category[Category]), "Category", "Total")'],
  ['Sales', 'Visual Category Rank', 'IF(ISINSCOPE(Category[Category]), RANKX(ALLSELECTED(Category[Category]), [Sales Amount], , DESC, Dense))'],
  ['Sales', 'Visual Prev Month Sales', "CALCULATE([Sales Amount], OFFSET(-1, ALLSELECTED('Date'[YearMonth]), ORDERBY('Date'[YearMonth], ASC)))"],
  ['Sales', 'Visual Running Sales', "CALCULATE([Sales Amount], WINDOW(1, ABS, 0, REL, ALLSELECTED('Date'[YearMonth]), ORDERBY('Date'[YearMonth], ASC)))"],
  ['Sales', 'Visual Moving Avg 3M', "AVERAGEX(WINDOW(-2, REL, 0, REL, ALLSELECTED('Date'[YearMonth]), ORDERBY('Date'[YearMonth], ASC)), [Sales Amount])"],
  ['Sales', 'Visual Best Subcategory', 'MAXX(INDEX(1, VALUES(Subcategory[Subcategory]), ORDERBY([Sales Amount], DESC, Subcategory[Subcategory], ASC)), Subcategory[Subcategory])'],
];
