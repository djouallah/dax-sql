-- no CALCULATE: the year row filters nothing (MIN is the total); the color is not in scope, and
-- RANKX of a state count no year changes is 1 in every month. A sale with no or an unknown date
-- makes a blank year.
SELECT y.d_year, (SELECT ROUND(MIN(ss_quantity), 1) FROM store_sales), 1
FROM (
  SELECT DISTINCT d_year FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
) y
