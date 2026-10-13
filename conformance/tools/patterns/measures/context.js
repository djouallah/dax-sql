// Measures for the context family (queries/patterns/context/): [table, name, expression].
export default [
  // Two nested iterators: the outer row context (customer) and the inner one (order) both turn
  // into filters when [Sales Amount] is called.
  ['Sales', 'Context Sum Of Largest Orders', 'SUMX(VALUES(Customer[CustomerKey]), MAXX(VALUES(Sales[Order Number]), [Sales Amount]))'],
  // Share of what the visual's filters select.
  ['Sales', 'Context Pct Of Selected', 'DIVIDE([Sales Amount], CALCULATE([Sales Amount], ALLSELECTED()))'],
  // Share of the parent level of a Category > Subcategory matrix.
  ['Sales', 'Context Pct Of Parent', `DIVIDE(
    [Sales Amount],
    SWITCH(TRUE(),
      ISINSCOPE(Subcategory[Subcategory]), CALCULATE([Sales Amount], ALLSELECTED(Subcategory[Subcategory])),
      ISINSCOPE(Category[Category]), CALCULATE([Sales Amount], ALLSELECTED(Category[Category])),
      [Sales Amount]))`],
  ['Sales', 'Context Level', `IF(NOT ISBLANK([Sales Amount]),
    SWITCH(TRUE(), ISINSCOPE(Subcategory[Subcategory]), "Subcategory", ISINSCOPE(Category[Category]), "Category", "Total"))`],
  // ALLSELECTED inside an iterator: the iteration is the shadow filter context it restores.
  ['Sales', 'Context Selected Colors Sales', 'SUMX(VALUES(Product[Color]), CALCULATE([Sales Amount], ALLSELECTED(Product[Color])))'],
  ['Sales', 'Context Brand Rank', 'IF(NOT ISBLANK([Sales Amount]), RANKX(ALLSELECTED(Product[Brand]), [Sales Amount]))'],
  // Customers whose sales in the current filter context pass a threshold.
  ['Sales', 'Context Big Customer Sales', 'CALCULATE([Sales Amount], FILTER(VALUES(Customer[CustomerKey]), [Sales Amount] > 10000))'],
];
