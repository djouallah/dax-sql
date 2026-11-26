-- store name "able" (and not "anti"); per promotion name (sales with no promotion: blank):
--   m0: the average catalog sales price over the year to the last date > 100: store distinct
--       customers; else the "able" stores plus their store sales rows < 100: ISINSCOPE(i_color) is
--       false, the largest catalog sales price; else store profit
--   m1: catalog YoY, all sales against every date a year back (store filters no catalog sale)
WITH ytd AS (
  SELECT d_date AS dt FROM date_dim WHERE d_date BETWEEN (SELECT date_trunc('year', max(d_date)) FROM date_dim) AND (SELECT max(d_date) FROM date_dim)
), ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT p.p_promo_name,
         round(AVG(cs.cs_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT dt FROM ytd)), 4) AS avg_ytd,
         MAX(cs.cs_ext_sales_price) AS price_max,
         SUM(cs.cs_quantity) AS qty, SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qty_ly
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), s AS (
  SELECT p.p_promo_name, COUNT(*) AS n, SUM(ss.ss_net_profit) AS np,
         COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS customers
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk AND st.s_store_name = 'able'
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY ALL
), stores AS (
  SELECT COUNT(*) AS n FROM store WHERE s_store_name = 'able'
), g AS (
  SELECT n.p_promo_name,
         CASE WHEN c.avg_ytd > 100 THEN s.customers
              WHEN COALESCE(NULLIF(stores.n, 0), 0) + COALESCE(s.n, 0) < 100 THEN c.price_max
              ELSE s.np END AS m0,
         (COALESCE(c.qty, 0) - c.qty_ly) / NULLIF(c.qty_ly, 0) AS m1
  FROM (SELECT DISTINCT p_promo_name FROM promotion UNION SELECT NULL) n CROSS JOIN stores
  LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
  LEFT JOIN s ON s.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
)
SELECT * FROM g WHERE m0 IS NOT NULL OR m1 IS NOT NULL
