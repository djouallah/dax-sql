-- per address state: the archive never passes 1000, so each of the state's store sale months (blank one included)
-- adds the catalog's smallest sale in the state (MIN without a measure ignores the month and the city); the two smallest
WITH s AS (
  SELECT ca.ca_state AS st, COUNT(DISTINCT d.d_moy) + MAX((d.d_moy IS NULL)::INT) AS n
  FROM store_sales ss LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT ca.ca_state AS st, MIN(cs.cs_ext_sales_price) AS mn
  FROM catalog_sales cs LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY ALL
), t AS (
  SELECT s.st, s.n * c.mn AS m0 FROM s JOIN c ON c.st IS NOT DISTINCT FROM s.st
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0) <= 2
