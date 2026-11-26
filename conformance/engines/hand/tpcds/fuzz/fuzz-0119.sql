-- m0: the date table is not filtered: its months. m1: the state's YTD (the last year) over 1 gives
-- its distinct customers, else SUM with no CALCULATE: the total revenue. A blank state holds the
-- sales with no address too.
WITH s AS (
  SELECT ca.ca_state AS st,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year = (SELECT MAX(d_year) FROM date_dim)) AS ytd,
    COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS dc
  FROM store_sales ss
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1
)
SELECT g.st,
  (SELECT NULLIF(COUNT(DISTINCT d_moy) + MAX(CASE WHEN d_moy IS NULL THEN 1 ELSE 0 END), 0) FROM date_dim),
  CASE WHEN s.ytd > 1 THEN s.dc ELSE (SELECT SUM(ss_ext_sales_price) FROM store_sales) END
FROM (SELECT DISTINCT ca_state AS st FROM customer_address) g
LEFT JOIN s ON s.st IS NOT DISTINCT FROM g.st
