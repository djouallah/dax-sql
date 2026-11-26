-- no CALCULATE: no category or state row filters anything; SUMX adds the total quantity once a state
-- (the store's blank row, for a sale with no or an unknown store, a state too). An item key that is
-- missing from item (a sale's or a promotion's, or the promotion's blank row's) gives a blank category.
WITH c AS (SELECT SUM(cs_quantity) AS qty, MIN(cs_net_profit) AS mn FROM catalog_sales),
n AS (
  SELECT COUNT(*) AS states FROM (
    SELECT DISTINCT s_state FROM store
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))
),
item_blank AS (
  SELECT EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM store_sales WHERE ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion)) AS b
)
SELECT g.i_category,
  CASE WHEN c.qty IS NULL AND c.mn IS NULL THEN NULL ELSE COALESCE(n.states * c.qty, 0) - COALESCE(c.mn, 0) END
FROM (SELECT DISTINCT i_category FROM item UNION SELECT NULL FROM item_blank WHERE b) g CROSS JOIN c CROSS JOIN n
