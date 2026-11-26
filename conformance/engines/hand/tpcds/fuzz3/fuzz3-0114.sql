-- TOTALYTD under a month of every year: from January of the calendar's last year to that month's
-- last date
WITH mx AS (SELECT d_moy, MAX(d_date) AS hi FROM date_dim GROUP BY d_moy),
t AS (
  SELECT i.i_category, mx.d_moy, SUM(ss.ss_ext_sales_price) AS m0
  FROM mx
  JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', mx.hi)::DATE AND mx.hi
  JOIN store_sales ss ON ss.ss_sold_date_sk = d.d_date_sk_1
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
)
SELECT c.i_category, t.d_moy, t.m0
FROM (SELECT DISTINCT i_category FROM item) c
JOIN t ON t.i_category IS NOT DISTINCT FROM c.i_category
WHERE t.m0 IS NOT NULL
