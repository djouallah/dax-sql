-- per quarter number: archive files over the catalog YoY of the quarter's dates (a year back date by date);
-- the blank quarter (sales with no date) has no year back (m0 blank) and its own catalog profit
WITH a AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), shift AS (
  SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), cur AS (
  SELECT d.d_qoy, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_net_profit) AS profit
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), ly AS (
  SELECT shift.d_qoy, SUM(a.qty) AS qty FROM shift JOIN a ON a.dt = shift.ly GROUP BY ALL
), files AS (
  SELECT NULLIF(COUNT(*), 0) AS n FROM stg_tpcds_archive_log
), q AS (
  SELECT d_qoy FROM date_dim
  UNION SELECT NULL
  WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
     OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
)
SELECT q.d_qoy, files.n / NULLIF((COALESCE(cur.qty, 0) - ly.qty) / NULLIF(ly.qty, 0), 0) AS m0, cur.profit AS m1
FROM q CROSS JOIN files
LEFT JOIN cur ON cur.d_qoy IS NOT DISTINCT FROM q.d_qoy
LEFT JOIN ly ON ly.d_qoy = q.d_qoy
