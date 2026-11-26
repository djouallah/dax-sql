-- ISINSCOPE of the promotion is false; stores do not reach catalog_sales: the largest catalog
-- quantity in the 12 months to 2024-11-15 for every state (the blank row's too, when some store sale has no
-- store), top 4 by it then by state
WITH c AS (
  SELECT MAX(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE d.d_date > (DATE '2024-11-15' - INTERVAL 12 MONTH) AND d.d_date <= DATE '2024-11-15'
)
SELECT st.s_state, c.q AS m0
FROM (SELECT s_state FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN store ON s_store_sk = ss_store_sk)) st CROSS JOIN c
QUALIFY RANK() OVER (ORDER BY c.q DESC NULLS LAST, st.s_state NULLS FIRST) <= 4
