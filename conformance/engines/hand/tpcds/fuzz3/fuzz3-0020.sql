-- per store name (sales with no store: a blank name): distinct customers (a blank one counts)
-- from 2023-07-08 to 2024-07-07 times the ship-mode types (no filter reaches ship_mode); the 4
-- highest (ties kept)
WITH r AS (
  SELECT s.s_store_name,
         (COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END))
           * (SELECT NULLIF(COUNT(DISTINCT sm_type) + MAX(CASE WHEN sm_type IS NULL THEN 1 ELSE 0 END), 0) FROM ship_mode) AS m0
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  WHERE d.d_date > DATE '2024-07-07' - INTERVAL 12 MONTH AND d.d_date <= DATE '2024-07-07'
  GROUP BY ALL
)
SELECT s_store_name, m0 FROM r WHERE m0 IS NOT NULL QUALIFY rank() OVER (ORDER BY m0 DESC) <= 4
