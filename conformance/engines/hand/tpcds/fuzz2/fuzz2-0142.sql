-- per quarter number (a blank one for the sales without a date), colour and brand (brand not "zz-none": every brand, a blank one kept). m0: average catalog sale;
-- m1: store revenue over the archive's rows (unrelated to dates); m2: catalog profit x store revenue YoY (a fixed
-- decimal, 4 places; last year =
-- each date of the quarter number a year back, a month's last day also its month's) - the item's share of the
-- quarter number's store profit (all items) / the archive's file count
WITH lyq AS (
  SELECT DISTINCT x.d_qoy, d.d_date_sk_1 AS sk
  FROM (SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), s AS (
  SELECT d.d_qoy, i.i_color, i.i_brand, SUM(ss.ss_ext_sales_price) AS rev, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), sq AS (
  SELECT d_qoy, SUM(np) AS np FROM s GROUP BY ALL
), sly AS (
  SELECT l.d_qoy, i.i_color, i.i_brand, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN lyq l ON l.sk = ss.ss_sold_date_sk JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), c AS (
  SELECT d.d_qoy, i.i_color, i.i_brand, SUM(cs.cs_net_profit) AS np,
    -- the average as a fixed decimal, rounded half away from zero exactly
    SIGN(SUM(cs.cs_ext_sales_price)) * ((2 * ABS(SUM(cs.cs_ext_sales_price) * 10000)::BIGINT + COUNT(cs.cs_ext_sales_price))
      // (2 * COUNT(cs.cs_ext_sales_price))) / 10000 AS av
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), t AS (
  SELECT q.d_qoy, k.i_color, k.i_brand, c.av AS m0,
    ROUND(s.rev / NULLIF((SELECT SUM(row_count) FROM stg_tpcds_archive_log), 0), 4) AS m1,
    ROUND(c.np * ((COALESCE(s.rev, 0) - sly.rev) / NULLIF(sly.rev, 0)), 4) AS a,
    (s.np / NULLIF(sq.np, 0)) / NULLIF((SELECT COUNT(*) FROM stg_tpcds_archive_log), 0) AS b
  FROM (SELECT DISTINCT d_qoy FROM date_dim UNION ALL SELECT NULL) q CROSS JOIN (SELECT DISTINCT i_color, i_brand FROM item) k
  LEFT JOIN s ON s.d_qoy IS NOT DISTINCT FROM q.d_qoy AND s.i_color IS NOT DISTINCT FROM k.i_color AND s.i_brand IS NOT DISTINCT FROM k.i_brand
  LEFT JOIN sq ON sq.d_qoy IS NOT DISTINCT FROM q.d_qoy
  LEFT JOIN sly ON sly.d_qoy = q.d_qoy AND sly.i_color IS NOT DISTINCT FROM k.i_color AND sly.i_brand IS NOT DISTINCT FROM k.i_brand
  LEFT JOIN c ON c.d_qoy IS NOT DISTINCT FROM q.d_qoy AND c.i_color IS NOT DISTINCT FROM k.i_color AND c.i_brand IS NOT DISTINCT FROM k.i_brand
)
SELECT d_qoy, i_color, i_brand, m0, m1, CASE WHEN a IS NULL AND b IS NULL THEN NULL ELSE COALESCE(a, 0) - COALESCE(b, 0) END AS m2
FROM t
WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
