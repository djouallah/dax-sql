-- the year does not filter the item table: its rows; USERELATIONSHIP is on catalog_sales
WITH dc AS (
  SELECT d.d_year AS y, COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS n
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1
)
SELECT y, n / NULLIF((SELECT COUNT(*) FROM item), 0) FROM dc
