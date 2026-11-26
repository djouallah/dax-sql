-- quantity per date (one pass), summed per quarter over the quarter's dates a year back (SAMEPERIODLASTYEAR by date:
-- a quarter's d_qoy need not follow calendar quarters; a month's last day also reaches the shifted month's last day)
WITH a AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), q AS (
  SELECT d_quarter_name, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
), qly AS (
  SELECT d_quarter_name, ly FROM q UNION SELECT d_quarter_name, last_day(ly) FROM q WHERE dt = last_day(dt)
)
SELECT qly.d_quarter_name, SUM(a.qty) AS ly FROM qly JOIN a ON a.dt = qly.ly GROUP BY ALL
