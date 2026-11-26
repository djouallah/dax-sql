WITH billed AS (
  SELECT ca.ca_state, SUM(cs.cs_ext_sales_price) AS v
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ca.ca_state),
shipped AS (
  SELECT ca.ca_state, SUM(cs.cs_ext_sales_price) AS v
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_ship_addr_sk
  GROUP BY ca.ca_state)
SELECT COALESCE(b.ca_state, s.ca_state), b.v, s.v
FROM billed b FULL JOIN shipped s ON s.ca_state IS NOT DISTINCT FROM b.ca_state
WHERE b.v IS NOT NULL OR s.v IS NOT NULL
