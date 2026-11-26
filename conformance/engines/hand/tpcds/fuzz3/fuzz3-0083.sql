-- per state of a store outside Oak Grove and class of the two brands' items: the class's catalog profit (catalog
-- sales know no store) and the store sale rows. ALL(s_city) holds the blank city of the store table's blank row (a sale
-- with no or an unknown store), and BLANK <> "Oak Grove": that row stays, the blank state
WITH st AS (SELECT DISTINCT s_state FROM (
    SELECT s_state, s_city FROM store
    UNION ALL SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))
  WHERE COALESCE(s_city, '') <> 'Oak Grove'),
cl AS (SELECT DISTINCT i_class FROM item WHERE i_brand IN ('amalguniv #7', 'importpack #1')),
c AS (
  SELECT i.i_class, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_brand IN ('amalguniv #7', 'importpack #1')
  GROUP BY ALL
), s AS (
  SELECT s.s_state, i.i_class, COUNT(*) AS n
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_brand IN ('amalguniv #7', 'importpack #1')
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  WHERE COALESCE(s.s_city, '') <> 'Oak Grove'
  GROUP BY ALL
)
SELECT st.s_state, cl.i_class, c.np AS m0, s.n AS m1
FROM st CROSS JOIN cl
LEFT JOIN c ON c.i_class IS NOT DISTINCT FROM cl.i_class
LEFT JOIN s ON s.s_state IS NOT DISTINCT FROM st.s_state AND s.i_class IS NOT DISTINCT FROM cl.i_class
WHERE c.np IS NOT NULL OR s.n IS NOT NULL
