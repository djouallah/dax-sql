-- a store filters no catalog sale: every store name gets the catalog's smallest quantity and 2 x revenue + rows
-- (and the blank name of the store table's blank row, there when a store sale has no or an unknown store)
WITH c AS (
  SELECT MIN(cs_quantity) AS mq, SUM(cs_ext_sales_price) AS rev, COUNT(*) AS n FROM catalog_sales
)
SELECT st.s_store_name, c.mq AS m0, CASE WHEN c.rev IS NULL AND c.n = 0 THEN NULL ELSE COALESCE(c.rev, 0) * 2 + c.n END AS m1
FROM (SELECT DISTINCT s_store_name FROM store
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) st
CROSS JOIN c
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
