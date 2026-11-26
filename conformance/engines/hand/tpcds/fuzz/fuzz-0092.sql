-- the ship mode and the promotion are not in scope; the address is not filtered, so it has one
-- state only if the table has one (its blank row, for a sale with no or an unknown address, a value too).
-- m0: the stores of the name; m1: the YTD (the last year), 0 for none. A sale with no or an unknown store
-- makes a blank store name.
WITH ca_blank AS (
  SELECT EXISTS (SELECT 1 FROM store_sales WHERE ss_addr_sk IS NULL OR ss_addr_sk NOT IN (SELECT ca_address_sk FROM customer_address))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_addr_sk IS NULL OR cs_bill_addr_sk NOT IN (SELECT ca_address_sk FROM customer_address)
      OR cs_ship_addr_sk IS NULL OR cs_ship_addr_sk NOT IN (SELECT ca_address_sk FROM customer_address)) AS b
), one_state AS (
  SELECT (SELECT COUNT(*) FROM (SELECT DISTINCT ca_state FROM customer_address UNION SELECT NULL FROM ca_blank WHERE b)) = 1 AS b
), s AS (
  SELECT st.s_store_name AS n, COUNT(*) AS cnt, SUM(ss.ss_net_profit) AS profit,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year = (SELECT MAX(d_year) FROM date_dim)) AS ytd
  FROM store_sales ss
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1
), total AS (SELECT SUM(ss_net_profit) AS v FROM store_sales),
stores AS (SELECT s_store_name AS n, COUNT(*) AS v FROM store GROUP BY 1),
g AS (SELECT DISTINCT s_store_name AS n FROM store UNION SELECT NULL
  WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)))
SELECT g.n, stores.v,
  CASE WHEN (CASE WHEN o.b AND s.cnt IS NOT NULL THEN s.profit / NULLIF(total.v, 0) ELSE 0 END) IS NULL THEN 0 ELSE COALESCE(s.ytd, 0) END
FROM g
CROSS JOIN one_state o CROSS JOIN total
LEFT JOIN s ON s.n IS NOT DISTINCT FROM g.n
LEFT JOIN stores ON stores.n IS NOT DISTINCT FROM g.n
