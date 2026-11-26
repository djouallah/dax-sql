-- ADDCOLUMNS: only the measures see the city (context transition). m0: the overall average catalog quantity
-- over the city's store revenue of the date table's last year (TOTALYTD with no date filter). m1: the city's
-- store profit per ship type (a fixed decimal by a whole number: four places) positive picks the overall
-- average catalog profit, else the largest store price.
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
s AS (
  SELECT st.s_city, SUM(ss.ss_net_profit) AS p,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx) AS ytd
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, y
  GROUP BY 1),
k AS (SELECT COUNT(DISTINCT sm_type) + (COUNT(*) > COUNT(sm_type))::INT AS n FROM ship_mode),
c AS (SELECT AVG(cs_quantity) AS aq, ROUND(AVG(cs_net_profit), 4) AS ap FROM catalog_sales),
m AS (SELECT COALESCE(MAX(ss_ext_sales_price), 0) AS mx FROM store_sales)
SELECT g.s_city,
  ABS(c.aq) / NULLIF(s.ytd, 0) AS m0,
  CASE WHEN COALESCE(ROUND(s.p / NULLIF(k.n, 0), 4), 0) > 0 THEN c.ap ELSE m.mx END AS m1
FROM (SELECT DISTINCT s_city FROM store) g CROSS JOIN k CROSS JOIN c CROSS JOIN m
LEFT JOIN s ON s.s_city IS NOT DISTINCT FROM g.s_city
