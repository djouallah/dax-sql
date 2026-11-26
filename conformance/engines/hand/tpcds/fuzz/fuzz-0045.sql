-- items of importcorp #1 and amalgpack #6; every education status by quarter number by the items' classes;
-- MAX(the most catalog profit of the year to date of the quarter number's last date, the store profit over the
-- archive files (a fixed decimal by a whole number: the exact quotient, half away from zero, to 4 places));
-- a blank compares as 0 in a two-argument MAX. A sale with no (or an unknown) date / demographics makes that table's
-- blank row: the blank quarter (no year to date there: its last date is blank) and the blank status
WITH it AS (
  SELECT * FROM item WHERE i_brand IN ('importcorp #1', 'amalgpack #6')
), q AS (
  SELECT d_qoy, MAX(d_date) AS last_dt FROM date_dim GROUP BY d_qoy
  UNION ALL SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
), c AS (
  SELECT q.d_qoy, cd.cd_education_status, it.i_class, MAX(cs.cs_net_profit) AS maxp
  FROM catalog_sales cs JOIN it ON it.i_item_sk = cs.cs_item_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN q ON d.d_date BETWEEN date_trunc('year', q.last_dt)::DATE AND q.last_dt
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), s AS (
  SELECT d.d_qoy, cd.cd_education_status, it.i_class, CAST(SUM(ss.ss_net_profit) * 10000 AS HUGEINT) AS p
  FROM store_sales ss JOIN it ON it.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), files AS (
  SELECT NULLIF(COUNT(*), 0) AS n FROM stg_tpcds_archive_log
), t AS (
  SELECT e.cd_education_status, q.d_qoy, k.i_class, c.maxp AS a,
    sign(s.p) * sign(files.n) * ((2 * abs(s.p) + abs(files.n)) // (2 * abs(files.n))) / 10000 AS b
  FROM (SELECT cd_education_status FROM customer_demographics
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
      OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
        OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))) e CROSS JOIN q
  CROSS JOIN (SELECT DISTINCT i_class FROM it) k CROSS JOIN files
  LEFT JOIN c ON c.d_qoy = q.d_qoy AND c.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND c.i_class IS NOT DISTINCT FROM k.i_class
  LEFT JOIN s ON s.d_qoy IS NOT DISTINCT FROM q.d_qoy AND s.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND s.i_class IS NOT DISTINCT FROM k.i_class
), u AS (
  SELECT cd_education_status, d_qoy, i_class,
    CASE WHEN COALESCE(a, 0) > COALESCE(b, 0) THEN a WHEN COALESCE(b, 0) > COALESCE(a, 0) THEN b ELSE COALESCE(a, b) END AS m0
  FROM t
)
SELECT * FROM u WHERE m0 IS NOT NULL
