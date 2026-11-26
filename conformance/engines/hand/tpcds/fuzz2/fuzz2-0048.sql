-- customers outside AR (an address with no state kept: blank <> "AR"), per item brand:
-- the lowest catalog quantity / the brand's share of store net profit (every item), made positive
WITH ca AS (
  SELECT ca_address_sk FROM customer_address WHERE ca_state IS DISTINCT FROM 'AR'
), cs AS (
  SELECT i.i_brand, MIN(cs.cs_quantity) AS lo
  FROM catalog_sales cs JOIN ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), ss AS (
  SELECT i.i_brand, GROUPING(i.i_brand) AS allb, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN ca ON ca.ca_address_sk = ss.ss_addr_sk
  JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY GROUPING SETS ((i.i_brand), ())
), v AS (
  SELECT b.i_brand, ABS(cs.lo / NULLIF(ss.np / NULLIF((SELECT np FROM ss WHERE allb = 1), 0), 0)) AS m0
  FROM (SELECT DISTINCT i_brand FROM item) b
  LEFT JOIN cs ON cs.i_brand IS NOT DISTINCT FROM b.i_brand
  LEFT JOIN ss ON ss.allb = 0 AND ss.i_brand IS NOT DISTINCT FROM b.i_brand
)
SELECT * FROM v WHERE m0 IS NOT NULL
