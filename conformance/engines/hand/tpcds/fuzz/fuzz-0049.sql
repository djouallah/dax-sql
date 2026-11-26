-- the stores' city and state pairs (and the blank store's, when some store sale has no store); no filter
-- reaches catalog from store
SELECT s_city, s_state, (SELECT ABS(COALESCE(MIN(cs_quantity), 0)) FROM catalog_sales) AS m0
FROM (SELECT s_city, s_state FROM store UNION SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))
