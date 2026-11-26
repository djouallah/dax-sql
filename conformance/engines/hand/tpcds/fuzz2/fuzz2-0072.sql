-- m0: whether some store state has a positive average store profit at price 41.92 for addresses from TX
-- on; if so, the blue items when blue's share of a customer state's store profit is past 10 in more than
-- 10 states, else 0. m1: item holds more than 10 rows: the least catalog price outside quarter 3 (else the
-- least of the cities' distinct customers). m2: the catalog quantity over every date a year back.
WITH a AS (
  SELECT st.s_state, ROUND(AVG(ss.ss_net_profit), 4) AS v
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk
  JOIN item i ON i.i_item_sk = ss.ss_item_sk JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  WHERE i.i_current_price = 41.92 AND ca.ca_state >= 'TX'
  GROUP BY 1),
sa AS (
  SELECT ca.ca_state, SUM(ss.ss_net_profit) AS p, SUM(ss.ss_net_profit) FILTER (WHERE i.i_color = 'blue') AS pb
  FROM store_sales ss LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY 1),
blue AS (
  SELECT COUNT(*) FILTER (WHERE sa.pb / NULLIF(sa.p, 0) > 10) > 10 AS ok
  FROM (SELECT DISTINCT ca_state FROM customer_address) t JOIN sa ON sa.ca_state IS NOT DISTINCT FROM t.ca_state),
ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
cust AS (
  SELECT st.s_city, COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS n
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk GROUP BY 1)
SELECT
  CASE WHEN NOT EXISTS (SELECT 1 FROM a WHERE v > 0) THEN 0
    WHEN (SELECT ok FROM blue) THEN (SELECT NULLIF(COUNT(*), 0) FROM item WHERE i_color = 'blue') END AS m0,
  CASE WHEN (SELECT COUNT(*) FROM item) > 10 THEN
      (SELECT MIN(cs.cs_ext_sales_price) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk WHERE d.d_qoy <> 3)
    ELSE (SELECT MIN(COALESCE(cust.n, 0)) FROM (SELECT DISTINCT s_city FROM store) c LEFT JOIN cust ON cust.s_city IS NOT DISTINCT FROM c.s_city) END AS m1,
  COALESCE((SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
    WHERE d.d_date IN (SELECT dt FROM ly)), 0) AS m2
