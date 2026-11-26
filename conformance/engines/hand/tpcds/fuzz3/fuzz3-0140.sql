-- every year: its distinct customers (a missing customer one more value); the items are not
-- filtered by the dates: every class joined by ","
WITH s AS (
  SELECT d.d_year, COUNT(DISTINCT ss.ss_customer_sk) + MAX((ss.ss_customer_sk IS NULL)::INT) AS dc
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
)
SELECT y.d_year, s.dc AS m0,
  (SELECT SUM(LENGTH(COALESCE(i_class, ''))) + COUNT(*) - 1 FROM (SELECT DISTINCT i_class FROM item)) AS m1
FROM (SELECT DISTINCT d_year FROM date_dim) y
LEFT JOIN s ON s.d_year = y.d_year
