-- store revenue per store name (sales with no store: a blank name); the 2 highest (ties kept)
WITH r AS (
  SELECT s.s_store_name, SUM(ss.ss_ext_sales_price) AS m0
  FROM store_sales ss LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
  HAVING SUM(ss.ss_ext_sales_price) IS NOT NULL
)
SELECT s_store_name, m0 FROM r QUALIFY rank() OVER (ORDER BY m0 DESC) <= 2
