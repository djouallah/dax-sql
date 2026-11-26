-- per category, quarter number and store state. The DATESBETWEEN is empty (start after end) and filters no item, so
-- the test is whether the category has more than one item price. If so: from 1 January of the quarter number's last
-- date's year to that date, each date a year back (a month's last day also its month's), the smallest over the
-- category's prices of the catalog quantity there (the same for every state). Else: the smallest store profit over
-- the catalog revenue (0, so blank, when the store revenue a year back is blank)
WITH sh AS (
  SELECT d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_date, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), ytd AS (
  SELECT d_qoy, date_trunc('year', MAX(d_date))::DATE AS d0, MAX(d_date) AS d1 FROM date_dim GROUP BY ALL
), lyytd AS (
  SELECT DISTINCT ytd.d_qoy, d.d_date_sk_1 AS sk
  FROM ytd JOIN sh ON sh.dt BETWEEN ytd.d0 AND ytd.d1 JOIN date_dim d ON d.d_date = sh.ly
), lyq AS (
  SELECT DISTINCT q.d_qoy, d.d_date_sk_1 AS sk
  FROM date_dim q JOIN sh ON sh.dt = q.d_date JOIN date_dim d ON d.d_date = sh.ly
), dc AS (
  SELECT i_category, COUNT(DISTINCT i_current_price) + MAX(CASE WHEN i_current_price IS NULL THEN 1 ELSE 0 END) AS n
  FROM item GROUP BY ALL
), a AS (
  -- branch one: per category and quarter number, the smallest over prices of catalog quantity a year back of the YTD
  SELECT i_category, d_qoy, MIN(q) AS v FROM (
    SELECT i.i_category, i.i_current_price, l.d_qoy, SUM(cs.cs_quantity) AS q
    FROM catalog_sales cs JOIN lyytd l ON l.sk = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
    GROUP BY ALL)
  WHERE q IS NOT NULL
  GROUP BY ALL
), s AS (
  SELECT i.i_category, d.d_qoy, st.s_state, MIN(ss.ss_net_profit) AS mnp
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), sly AS (
  SELECT i.i_category, l.d_qoy, st.s_state, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN lyq l ON l.sk = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), c AS (
  SELECT i.i_category, d.d_qoy, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
)
SELECT k.i_category, q.d_qoy, t.s_state,
  CASE WHEN dc.n > 1 THEN a.v
       ELSE s.mnp / NULLIF(CASE WHEN sly.rev IS NULL THEN 0 ELSE c.rev END, 0) END AS m0
FROM (SELECT DISTINCT i_category FROM item) k
CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) q
CROSS JOIN (SELECT DISTINCT s_state FROM store) t
JOIN dc ON dc.i_category IS NOT DISTINCT FROM k.i_category
LEFT JOIN a ON a.i_category IS NOT DISTINCT FROM k.i_category AND a.d_qoy = q.d_qoy
LEFT JOIN s ON s.i_category IS NOT DISTINCT FROM k.i_category AND s.d_qoy = q.d_qoy AND s.s_state IS NOT DISTINCT FROM t.s_state
LEFT JOIN sly ON sly.i_category IS NOT DISTINCT FROM k.i_category AND sly.d_qoy = q.d_qoy AND sly.s_state IS NOT DISTINCT FROM t.s_state
LEFT JOIN c ON c.i_category IS NOT DISTINCT FROM k.i_category AND c.d_qoy = q.d_qoy
WHERE m0 IS NOT NULL
