-- every item price by every quarter number, the blank price / quarter among them when the model has those blank
-- rows (m0, m1: every archive row count, no date or store filter reaches it);
-- m2: store revenue YoY of the year to date of the quarter number's last date (stores not in TN, the blank store
-- in: BLANK <> "TN"; the blank quarter has no year to date), times the
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
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  WHERE COALESCE(st.s_state, '') <> 'TN'
  GROUP BY ALL
), cur AS (
  SELECT a.i_current_price, ytd.d_qoy, SUM(a.rev) AS rev FROM ytd JOIN a USING (dt) GROUP BY ALL
), ly AS (
  SELECT a.i_current_price, shift.d_qoy, SUM(a.rev) AS rev FROM shift JOIN a ON a.dt = shift.ly GROUP BY ALL
), k AS (
  SELECT (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS arch,
    (SELECT sign(s) * ((2 * abs(s) + n) // (2 * n)) / 10000
     FROM (SELECT CAST(SUM(cs_ext_sales_price) * 10000 AS HUGEINT) AS s, NULLIF(COUNT(cs_ext_sales_price), 0) AS n FROM catalog_sales)) AS avgp
), p AS (
  SELECT i_current_price FROM item
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_item_sk IS NULL OR ss_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_item_sk IS NULL OR cs_item_sk NOT IN (SELECT i_item_sk FROM item))
    OR EXISTS (SELECT 1 FROM promotion WHERE p_item_sk IS NULL OR p_item_sk NOT IN (SELECT i_item_sk FROM item))
), g AS (
  SELECT d_qoy FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT p.i_current_price, g.d_qoy, k.arch AS m0, k.arch AS m1,
  ROUND((COALESCE(cur.rev, 0) - ly.rev) / NULLIF(ly.rev, 0) * k.avgp, 4) AS m2
FROM p CROSS JOIN g CROSS JOIN k
LEFT JOIN cur ON cur.i_current_price IS NOT DISTINCT FROM p.i_current_price AND cur.d_qoy = g.d_qoy
LEFT JOIN ly ON ly.i_current_price IS NOT DISTINCT FROM p.i_current_price AND ly.d_qoy = g.d_qoy
