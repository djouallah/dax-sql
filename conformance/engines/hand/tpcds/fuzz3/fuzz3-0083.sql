-- per state of a store outside Oak Grove and class of the two brands' items: the class's catalog profit (catalog
-- sales know no store) and the store sale rows
WITH st AS (SELECT DISTINCT s_state FROM store WHERE s_city <> 'Oak Grove'),
cl AS (SELECT DISTINCT i_class FROM item WHERE i_brand IN ('amalguniv #7', 'importpack #1')),
c AS (
  SELECT i.i_class, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand IN ('amalguniv #7', 'importpack #1')
  GROUP BY ALL
), s AS (
  SELECT s.s_state, i.i_class, COUNT(*) AS n
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_brand IN ('amalguniv #7', 'importpack #1')
  JOIN store s ON s.s_store_sk = ss.ss_store_sk AND s.s_city <> 'Oak Grove'
  GROUP BY ALL
)
SELECT st.s_state, cl.i_class, c.np AS m0, s.n AS m1
FROM st CROSS JOIN cl
LEFT JOIN c ON c.i_class IS NOT DISTINCT FROM cl.i_class
LEFT JOIN s ON s.s_state = st.s_state AND s.i_class IS NOT DISTINCT FROM cl.i_class
WHERE c.np IS NOT NULL OR s.n IS NOT NULL
