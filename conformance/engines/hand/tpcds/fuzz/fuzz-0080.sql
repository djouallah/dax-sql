-- COUNTROWS sees no brand row (no CALCULATE): the total; one state only (sales of no store add
-- store's blank row, a blank state) gives the archive rows. The brands include item's blank row's
-- (promotions or sales of no item, or sales of no promotion: the blank promotion's item is blank too).
WITH b AS (
  SELECT DISTINCT i_brand FROM item
  UNION
  SELECT NULL WHERE EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
                 OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
                 OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
)
SELECT b.i_brand, (SELECT NULLIF(COUNT(*), 0) FROM catalog_sales),
  CASE WHEN (SELECT COUNT(DISTINCT s_state) + (COUNT(*) > COUNT(s_state) OR EXISTS (SELECT 1 FROM store_sales
        WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))::INT FROM store) = 1
    THEN (SELECT SUM(row_count) FROM stg_tpcds_archive_log) END
FROM b
