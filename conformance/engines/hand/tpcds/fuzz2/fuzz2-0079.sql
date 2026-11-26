-- m0 sets its own city filter (the three cities), so every city has the same value: the greater of the
-- stores in those cities and the catalog quantity of the three classes (catalog_sales is not filtered by store)
WITH v AS (
  SELECT GREATEST(
    (SELECT NULLIF(COUNT(*), 0) FROM store WHERE s_city IN ('Oak Grove', 'Midway', 'Fairview')),
    (SELECT ABS(SUM(cs.cs_quantity)) FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
     WHERE i.i_class IN ('rock', 'pants', 'classical'))) AS m0)
SELECT c.s_city, v.m0 FROM (SELECT DISTINCT s_city FROM store) c, v WHERE v.m0 IS NOT NULL
