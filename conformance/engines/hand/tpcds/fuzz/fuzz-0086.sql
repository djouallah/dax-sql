-- m0: the item is not filtered, so it has one color only if the table has one; the blank store (store sales
-- with no store) is a name too
WITH ytd AS (
  SELECT st.s_store_name AS n, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = (SELECT MAX(d_year) FROM date_dim)
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY 1
), mx AS (
  SELECT st.s_store_name AS n, MAX(ss.ss_net_profit) AS v
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY 1
)
SELECT g.n,
  CASE WHEN (SELECT COUNT(DISTINCT i_color) + MAX(CASE WHEN i_color IS NULL THEN 1 ELSE 0 END) FROM item) = 1 THEN mx.v END,
  ytd.v
FROM (SELECT s_store_name AS n FROM store UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) g
LEFT JOIN ytd ON ytd.n IS NOT DISTINCT FROM g.n
LEFT JOIN mx ON mx.n IS NOT DISTINCT FROM g.n
