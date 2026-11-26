-- per state (store filters no catalog sale):
--   m0: catalog profit from 2024-12-12 to 2025-01-11, summed over the education statuses of
--       catalog_sales: all of them
--   m1: the quarter numbers whose store revenue in the state is past 10 (a sale without a date in the blank one)
-- States and quarter numbers each hold their blank row when a sale's key misses the table
WITH r AS (
  SELECT s.s_state, d.d_qoy, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), n AS (
  SELECT s_state, COUNT(*) AS n FROM r WHERE rev > 10 GROUP BY ALL
), st AS (
  SELECT DISTINCT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)
)
SELECT st.s_state,
       (SELECT SUM(cs.cs_net_profit) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
        WHERE d.d_date > DATE '2025-01-11' - INTERVAL 1 MONTH AND d.d_date <= DATE '2025-01-11') AS m0,
       n.n AS m1
FROM st LEFT JOIN n ON n.s_state IS NOT DISTINCT FROM st.s_state
