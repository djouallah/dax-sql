-- store name "anti", no grouping (store filters no catalog sale, no archive row, no demographic):
--   m0: the first two SWITCH tests can't hold (a length of at most 6 past 100, a rank below 0):
--       the archive's source rows if any (or its files past 1000), else the largest store sales price
--   m1: v * 2 + w:
--       v: (more than 1 store row, or store revenue a year back: all catalog quantity, else the
--          education statuses) past 1000: catalog revenue if store profit is past 1 and there is a
--          catalog profit, else store revenue a year back;
--          else the next test holds (DATESBETWEEN from after to before is empty, no class, a
--          blank average < 10): catalog quantity a year back of the dates of the first month ascending
--       w: the dates' one quarter number is 1: the stores' states (all catalog rows past 100), else
--          catalog revenue of the second year ascending
--       (a sale without a date gives date_dim its blank row, which sorts first: then the first month is the
--       blank one, whose year back holds no date, and the second year the first real one)
--   m2: ISINSCOPE is false: the largest store profit share per year (profit over itself: 1)
WITH ly AS (
  SELECT d_moy, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT d_moy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), dblank AS (
  SELECT EXISTS (FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
      OR EXISTS (FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk) AS b
), moy AS (
  SELECT DISTINCT d_moy FROM date_dim UNION SELECT NULL FROM dblank WHERE b
), yr AS (
  SELECT DISTINCT d_year FROM date_dim UNION SELECT NULL FROM dblank WHERE b
), qoy AS (
  SELECT DISTINCT d_qoy FROM date_dim UNION SELECT NULL FROM dblank WHERE b
), st AS (
  SELECT s_store_sk, s_state FROM store WHERE s_store_name = 'anti'
), s AS (
  SELECT COUNT(*) AS n, SUM(ss.ss_net_profit) AS np, MAX(ss.ss_ext_sales_price) AS price_max,
         SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS rev_ly
  FROM store_sales ss JOIN st ON st.s_store_sk = ss.ss_store_sk LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), sy AS (
  SELECT d.d_year, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN st ON st.s_store_sk = ss.ss_store_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT COUNT(*) AS n, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_ext_sales_price) AS rev, MAX(cs.cs_net_profit) AS np_max,
         SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly WHERE d_moy = (SELECT d_moy FROM moy ORDER BY d_moy NULLS FIRST LIMIT 1))) AS qty_ly_m1,
         SUM(cs.cs_ext_sales_price) FILTER (WHERE d.d_year = (SELECT d_year FROM yr ORDER BY d_year NULLS FIRST LIMIT 1 OFFSET 1)) AS rev_y2
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), a AS (
  SELECT COUNT(*) AS files, SUM(row_count) AS src FROM stg_tpcds_archive_log
), q AS (
  SELECT CASE WHEN COUNT(*) = 1 THEN MIN(d_qoy) END AS qoy FROM qoy
), v AS (
  SELECT CASE WHEN (CASE WHEN s.n > 1 OR s.rev_ly IS NOT NULL THEN c.qty
                         ELSE (SELECT COUNT(DISTINCT cd_education_status) FROM customer_demographics) END) > 1000
              THEN (CASE WHEN s.np > 1 AND c.np_max IS NOT NULL THEN c.rev ELSE s.rev_ly END)
              ELSE c.qty_ly_m1 END AS v,
         CASE WHEN q.qoy = 1 THEN (CASE WHEN c.n > 100 THEN (SELECT NULLIF(COUNT(DISTINCT s_state), 0) FROM st) END)
              ELSE c.rev_y2 END AS w
  FROM s, c, q
)
SELECT abs(CASE WHEN a.files > 1000 OR a.src IS NOT NULL THEN a.src ELSE s.price_max END) AS m0,
       CASE WHEN v.v IS NULL AND v.w IS NULL THEN NULL ELSE COALESCE(2 * v.v, 0) + COALESCE(v.w, 0) END AS m1,
       (SELECT MAX(np / NULLIF(np, 0)) FROM sy) AS m2
FROM s, a, v
