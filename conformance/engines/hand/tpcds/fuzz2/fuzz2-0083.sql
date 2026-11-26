-- Per month (of every year), its dates a year back (a month's last day also reaching the shifted month's last)
WITH q AS (SELECT d_moy, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim),
qly AS (SELECT d_moy, ly FROM q UNION SELECT d_moy, last_day(ly) FROM q WHERE dt = last_day(dt)),
a AS (
  SELECT d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY 1),
l AS (SELECT qly.d_moy, SUM(a.rev) AS rev FROM qly JOIN a ON a.dt = qly.ly GROUP BY 1)
SELECT m.d_moy, ROUND(COALESCE(l.rev, 0), 2) AS m0
FROM (SELECT DISTINCT d_moy FROM date_dim) m LEFT JOIN l ON l.d_moy IS NOT DISTINCT FROM m.d_moy
