-- items not blue (an item with no color kept: blank <> "blue"), stores in Oak Grove or Fairview, per item category:
-- m0: the lowest catalog quantity
-- m1: of the classes other than classical, the items / the larger of catalog quantity and the lowest store sales price
-- m2: catalog net profit
WITH it AS (
  SELECT * FROM item WHERE COALESCE(i_color, '') <> 'blue'
), cs AS (
  SELECT i.i_category, MIN(cs.cs_quantity) AS lo, SUM(cs.cs_net_profit) AS np,
    SUM(cs.cs_quantity) FILTER (WHERE COALESCE(i.i_class, '') <> 'classical') AS qty
  FROM catalog_sales cs JOIN it i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), ss AS (
  SELECT i.i_category, MIN(ss.ss_ext_sales_price) AS lo
  FROM store_sales ss JOIN it i ON i.i_item_sk = ss.ss_item_sk AND COALESCE(i.i_class, '') <> 'classical'
  JOIN store s ON s.s_store_sk = ss.ss_store_sk AND s.s_city IN ('Oak Grove', 'Fairview')
  GROUP BY ALL
), n AS (
  SELECT i_category, COUNT(*) AS n FROM it WHERE COALESCE(i_class, '') <> 'classical' GROUP BY ALL
), v AS (
  SELECT c.i_category, cs.lo AS m0, n.n / NULLIF(GREATEST(cs.qty, ss.lo), 0) AS m1, cs.np AS m2
  FROM (SELECT DISTINCT i_category FROM it) c
  LEFT JOIN cs ON cs.i_category IS NOT DISTINCT FROM c.i_category
  LEFT JOIN ss ON ss.i_category IS NOT DISTINCT FROM c.i_category
  LEFT JOIN n ON n.i_category IS NOT DISTINCT FROM c.i_category
)
SELECT * FROM v WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
