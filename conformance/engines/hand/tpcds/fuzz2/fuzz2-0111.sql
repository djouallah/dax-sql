-- a store filters no catalog sale: every store name gets the catalog's smallest quantity and 2 x revenue + rows
WITH c AS (
  SELECT MIN(cs_quantity) AS mq, SUM(cs_ext_sales_price) AS rev, COUNT(*) AS n FROM catalog_sales
)
SELECT st.s_store_name, c.mq AS m0, CASE WHEN c.rev IS NULL AND c.n = 0 THEN NULL ELSE COALESCE(c.rev, 0) * 2 + c.n END AS m1
FROM (SELECT DISTINCT s_store_name FROM store) st CROSS JOIN c
WHERE m0 IS NOT NULL OR m1 IS NOT NULL
