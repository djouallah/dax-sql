-- ADDCOLUMNS' row context filters nothing outside CALCULATE: no color is alone, so the test is blank and every
-- price takes RANKX over colors of an expression without a measure: 1; the first price ascending (blank first)
SELECT i_current_price, 1 AS m0
FROM (SELECT DISTINCT i_current_price FROM item)
QUALIFY RANK() OVER (ORDER BY i_current_price ASC NULLS FIRST) <= 1
