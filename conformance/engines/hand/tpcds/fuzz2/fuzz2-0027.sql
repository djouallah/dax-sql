-- per store name (the blank one too: a sale with no or an unknown store): the average catalog sales price
-- (a fixed decimal), which no store filter reaches; the 4 lowest, so every name ties
SELECT s_store_name, (SELECT ROUND(AVG(cs_ext_sales_price), 4) FROM catalog_sales) AS m0
FROM (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
)
WHERE (SELECT COUNT(cs_ext_sales_price) FROM catalog_sales) > 0
