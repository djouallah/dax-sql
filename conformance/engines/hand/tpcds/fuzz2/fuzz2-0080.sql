-- catalog_sales is filtered by category only. m0: the greater of the category's largest catalog quantity and
-- the store revenue of the date table's last year (TOTALYTD with no date filter). m1: twice the store profit
-- plus the catalog revenue (a blank as 0 unless both are).
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
c AS (
  SELECT i.i_category, MAX(cs.cs_quantity) AS mq, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk GROUP BY 1),
s AS (
  SELECT i.i_category, st.s_city, SUM(ss.ss_net_profit) AS p,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx) AS ytd
  FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, y
  GROUP BY 1, 2),
t AS (
  SELECT g.i_category, g.s_city, GREATEST(c.mq, s.ytd) AS m0,
    CASE WHEN s.p IS NULL AND c.rev IS NULL THEN NULL ELSE COALESCE(s.p * 2, 0) + COALESCE(c.rev, 0) END AS m1
  FROM (SELECT DISTINCT i.i_category, st.s_city FROM item i, store st) g
  LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM g.i_category
  LEFT JOIN s ON s.i_category IS NOT DISTINCT FROM g.i_category AND s.s_city IS NOT DISTINCT FROM g.s_city)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
