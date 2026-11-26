-- catalog revenue per quarter number (sales with no date: a blank quarter); the lowest (ties kept)
WITH r AS (
  SELECT d.d_qoy, SUM(cs.cs_ext_sales_price) AS m0
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
  HAVING SUM(cs.cs_ext_sales_price) IS NOT NULL
)
SELECT d_qoy, m0 FROM r QUALIFY rank() OVER (ORDER BY m0) <= 1
