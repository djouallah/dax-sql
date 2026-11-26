-- per quarter number: archive files over the catalog YoY of the quarter's dates (a year back date by date)
WITH a AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), shift AS (
  SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), cur AS (
  SELECT d.d_qoy, SUM(a.qty) AS qty, SUM(a.profit) AS profit FROM date_dim d JOIN a ON a.dt = d.d_date GROUP BY ALL
), ly AS (
  SELECT shift.d_qoy, SUM(a.qty) AS qty FROM shift JOIN a ON a.dt = shift.ly GROUP BY ALL
), files AS (
  SELECT NULLIF(COUNT(*), 0) AS n FROM stg_tpcds_archive_log
)
SELECT q.d_qoy, files.n / NULLIF((COALESCE(cur.qty, 0) - ly.qty) / NULLIF(ly.qty, 0), 0) AS m0, cur.profit AS m1
FROM (SELECT DISTINCT d_qoy FROM date_dim) q CROSS JOIN files
LEFT JOIN cur ON cur.d_qoy = q.d_qoy
LEFT JOIN ly ON ly.d_qoy = q.d_qoy
