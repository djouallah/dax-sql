-- the stores' city and state pairs; no filter reaches catalog from store
SELECT s_city, s_state, (SELECT ABS(COALESCE(MIN(cs_quantity), 0)) FROM catalog_sales) AS m0
FROM (SELECT DISTINCT s_city, s_state FROM store)
