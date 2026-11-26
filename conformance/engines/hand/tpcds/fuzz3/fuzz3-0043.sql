-- over the year to the last date (and those dates a year back): catalog quantity a year back past
-- 1000 gives store YoY, else store revenue a year back; over the length of the first 4
-- characters of the promotion names joined
WITH ytd AS (
  SELECT d_date AS dt FROM date_dim WHERE d_date BETWEEN (SELECT date_trunc('year', max(d_date)) FROM date_dim) AND (SELECT max(d_date) FROM date_dim)
), ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM ytd
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM ytd WHERE dt = last_day(dt)
), s AS (
  SELECT SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT dt FROM ytd)) AS rev,
         SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS rev_ly
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), c AS (
  SELECT SUM(cs.cs_quantity) AS qty_ly
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk WHERE d.d_date IN (SELECT dt FROM ly)
), l AS (
  SELECT length(left(upper(COALESCE(string_agg(COALESCE(p_promo_name, ''), '|' ORDER BY p_promo_name NULLS FIRST), '')), 4)) AS len
  FROM (SELECT DISTINCT p_promo_name FROM promotion)
)
SELECT (CASE WHEN c.qty_ly > 1000 THEN (COALESCE(s.rev, 0) - s.rev_ly) / NULLIF(s.rev_ly, 0) ELSE s.rev_ly END) / NULLIF(l.len, 0) AS m0
FROM s, c, l
