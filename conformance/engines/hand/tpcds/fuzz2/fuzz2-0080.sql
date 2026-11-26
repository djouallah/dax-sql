-- catalog_sales is filtered by category only. m0: the greater of the category's largest catalog quantity and
-- the store revenue of the date table's last year (TOTALYTD with no date filter). m1: twice the store profit
-- plus the catalog revenue (a blank as 0 unless both are). The groups are every category x city, each side
-- with its blank row's: sales of no store; promotions or sales of no item, or sales of no promotion (whose
-- item is blank too).
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
cat AS (
  SELECT DISTINCT i_category FROM item
  UNION
  SELECT NULL WHERE EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item)
                 OR ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item)
                 OR cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))),
city AS (
  SELECT DISTINCT s_city FROM store
  UNION
  SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))),
t AS (
  SELECT g.i_category, h.s_city, GREATEST(c.mq, s.ytd) AS m0,
    CASE WHEN s.p IS NULL AND c.rev IS NULL THEN NULL ELSE COALESCE(s.p * 2, 0) + COALESCE(c.rev, 0) END AS m1
  FROM cat g CROSS JOIN city h
  LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM g.i_category
  LEFT JOIN s ON s.i_category IS NOT DISTINCT FROM g.i_category AND s.s_city IS NOT DISTINCT FROM h.s_city)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
