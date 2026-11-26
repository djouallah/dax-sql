-- The brand filter leaves its items' colors. m0 does not depend on the store: the catalog quantity over
-- every date a year back (a month's last day also reaching the shifted month's last); m1: the store revenue
-- of the date table's last year (TOTALYTD with no date filter). Every color by every store, the blank store among
-- them when some store sale has none (m0 shows there too).
WITH it AS (SELECT * FROM item WHERE i_brand IN ('zz-none', 'scholarpack #8')),
ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
c AS (
  SELECT it.i_color, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE d.d_date IN (SELECT dt FROM ly)
  GROUP BY 1),
y AS (SELECT MAX(d_date) AS mx FROM date_dim),
s AS (
  SELECT it.i_color, st.s_store_name, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk, y
  WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx
  GROUP BY 1, 2)
SELECT g.i_color, g.s_store_name, c.q AS m0, s.rev AS m1
FROM (SELECT DISTINCT it.i_color, st.s_store_name FROM it, (
  SELECT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) st) g
LEFT JOIN c ON c.i_color IS NOT DISTINCT FROM g.i_color
LEFT JOIN s ON s.i_color IS NOT DISTINCT FROM g.i_color AND s.s_store_name IS NOT DISTINCT FROM g.s_store_name
WHERE c.q IS NOT NULL OR s.rev IS NOT NULL
