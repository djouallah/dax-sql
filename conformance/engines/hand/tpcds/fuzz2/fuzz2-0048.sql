-- customers outside AR (an address with no state kept, and the blank address of a sale with no or an unknown
-- one: blank <> "AR"), per item brand: the lowest catalog quantity / the brand's share of store net profit
-- (every item), made positive. A sale with no or an unknown item is under the blank brand.
WITH cs AS (
  SELECT i.i_brand, MIN(cs.cs_quantity) AS lo
  FROM catalog_sales cs
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  WHERE ca.ca_state IS DISTINCT FROM 'AR'
  GROUP BY ALL
), ss AS (
  SELECT i.i_brand, GROUPING(i.i_brand) AS allb, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  WHERE ca.ca_state IS DISTINCT FROM 'AR'
  GROUP BY GROUPING SETS ((i.i_brand), ())
), b AS (
  -- item's blank row: an item key of a sale or a promotion it lacks, or a promotion's blank row
  SELECT DISTINCT i_brand FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
      OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), v AS (
  SELECT b.i_brand, ABS(cs.lo / NULLIF(ss.np / NULLIF((SELECT np FROM ss WHERE allb = 1), 0), 0)) AS m0
  FROM b
  LEFT JOIN cs ON cs.i_brand IS NOT DISTINCT FROM b.i_brand
  LEFT JOIN ss ON ss.allb = 0 AND ss.i_brand IS NOT DISTINCT FROM b.i_brand
)
SELECT * FROM v WHERE m0 IS NOT NULL
