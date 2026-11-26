-- per store state, item class and month: store sales, catalog quantity (the lowest over the education
-- statuses of a sum no status filters), catalog revenue
WITH ss AS (
  SELECT s.s_state, i.i_class, d.d_moy, COUNT(*) AS n
  FROM store_sales ss
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), cs AS (
  SELECT i.i_class, d.d_moy, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
)
SELECT st.s_state, c.i_class, m.d_moy, ss.n AS m0,
  CASE WHEN EXISTS (SELECT 1 FROM customer_demographics) THEN cs.qty END AS m1, cs.rev AS m2
FROM (SELECT DISTINCT s_state FROM store) st
CROSS JOIN (SELECT DISTINCT i_class FROM item) c
CROSS JOIN (SELECT DISTINCT d_moy FROM date_dim) m
LEFT JOIN ss ON ss.s_state IS NOT DISTINCT FROM st.s_state AND ss.i_class IS NOT DISTINCT FROM c.i_class AND ss.d_moy IS NOT DISTINCT FROM m.d_moy
LEFT JOIN cs ON cs.i_class IS NOT DISTINCT FROM c.i_class AND cs.d_moy IS NOT DISTINCT FROM m.d_moy
WHERE ss.n IS NOT NULL OR cs.qty IS NOT NULL OR cs.rev IS NOT NULL
