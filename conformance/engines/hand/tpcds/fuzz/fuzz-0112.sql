-- no CALCULATE: the year row filters nothing (MIN is the total); the color is not in scope, and
-- RANKX of a state count no year changes is 1 in every month
SELECT y.d_year, (SELECT ROUND(MIN(ss_quantity), 1) FROM store_sales), 1
FROM (SELECT DISTINCT d_year FROM date_dim) y
