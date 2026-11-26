-- every item price by every quarter number (m0, m1: every archive row count, no date or store filter reaches it);
-- m2: store revenue YoY of the year to date of the quarter number's last date (stores not in TN), times the
-- average catalog price of every sale (REMOVEFILTERS(catalog_sales) removes its dimensions' filters too):
-- a number times a fixed decimal is one (4 places)
WITH q AS (
  SELECT d_qoy, MAX(d_date) AS last_dt FROM date_dim GROUP BY d_qoy
), ytd AS (
  SELECT q.d_qoy, d.d_date AS dt FROM q JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', q.last_dt)::DATE AND q.last_dt
), shift AS (
  SELECT d_qoy, (dt - INTERVAL 1 YEAR)::DATE AS ly FROM ytd
  UNION SELECT d_qoy, last_day((dt - INTERVAL 1 YEAR)::DATE) FROM ytd WHERE dt = last_day(dt)
), a AS (
  SELECT i.i_current_price, d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  JOIN store st ON st.s_store_sk = ss.ss_store_sk AND COALESCE(st.s_state, '') <> 'TN'
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), cur AS (
  SELECT a.i_current_price, ytd.d_qoy, SUM(a.rev) AS rev FROM ytd JOIN a USING (dt) GROUP BY ALL
), ly AS (
  SELECT a.i_current_price, shift.d_qoy, SUM(a.rev) AS rev FROM shift JOIN a ON a.dt = shift.ly GROUP BY ALL
), k AS (
  SELECT (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS arch,
    (SELECT sign(s) * ((2 * abs(s) + n) // (2 * n)) / 10000
     FROM (SELECT CAST(SUM(cs_ext_sales_price) * 10000 AS HUGEINT) AS s, NULLIF(COUNT(cs_ext_sales_price), 0) AS n FROM catalog_sales)) AS avgp
)
SELECT p.i_current_price, g.d_qoy, k.arch AS m0, k.arch AS m1,
  ROUND((COALESCE(cur.rev, 0) - ly.rev) / NULLIF(ly.rev, 0) * k.avgp, 4) AS m2
FROM (SELECT DISTINCT i_current_price FROM item) p CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) g CROSS JOIN k
LEFT JOIN cur ON cur.i_current_price IS NOT DISTINCT FROM p.i_current_price AND cur.d_qoy = g.d_qoy
LEFT JOIN ly ON ly.i_current_price IS NOT DISTINCT FROM p.i_current_price AND ly.d_qoy = g.d_qoy
