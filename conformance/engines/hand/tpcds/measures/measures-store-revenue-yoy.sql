-- revenue per date (one pass), summed per quarter and per the quarter's dates a year back (SAMEPERIODLASTYEAR by date:
-- a quarter's d_qoy need not follow calendar quarters; a month's last day also reaches the shifted month's last day)
WITH a AS (
  SELECT d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), q AS (
  SELECT d_quarter_name, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
), qly AS (
  SELECT d_quarter_name, ly FROM q UNION SELECT d_quarter_name, last_day(ly) FROM q WHERE dt = last_day(dt)
), l AS (
  SELECT qly.d_quarter_name, SUM(a.rev) AS rev FROM qly JOIN a ON a.dt = qly.ly GROUP BY ALL
), c AS (
  SELECT q.d_quarter_name, SUM(a.rev) AS rev FROM q JOIN a USING (dt) GROUP BY ALL
)
SELECT l.d_quarter_name, (COALESCE(c.rev, 0) - l.rev) / NULLIF(l.rev, 0) AS yoy
FROM l LEFT JOIN c USING (d_quarter_name)
WHERE yoy IS NOT NULL
