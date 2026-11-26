-- The city filter does not reach catalog_sales. Per quarter (of every year): m0 twice the catalog quantity
-- YoY, the quarter's dates against those dates a year back (a quarter's d_qoy need not follow calendar
-- quarters); m1 the revenue of the last year up to the quarter's last date (TOTALYTD).
WITH a AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS q, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY 1),
q AS (SELECT d_qoy, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim),
qly AS (SELECT d_qoy, ly FROM q UNION SELECT d_qoy, last_day(ly) FROM q WHERE dt = last_day(dt)),
c AS (SELECT q.d_qoy, SUM(a.q) AS q FROM q JOIN a USING (dt) GROUP BY 1),
l AS (SELECT qly.d_qoy, SUM(a.q) AS q FROM qly JOIN a ON a.dt = qly.ly GROUP BY 1),
lq AS (SELECT d_qoy, MAX(d_date) AS mx FROM date_dim GROUP BY 1),
ytd AS (SELECT lq.d_qoy, SUM(a.rev) AS rev FROM lq JOIN a ON a.dt BETWEEN date_trunc('year', lq.mx) AND lq.mx GROUP BY 1),
t AS (
  SELECT g.d_qoy, 2 * ((COALESCE(c.q, 0) - l.q)::DOUBLE / NULLIF(l.q, 0)) AS m0, ytd.rev AS m1
  FROM (SELECT DISTINCT d_qoy FROM date_dim) g
  LEFT JOIN c ON c.d_qoy = g.d_qoy LEFT JOIN l ON l.d_qoy = g.d_qoy LEFT JOIN ytd ON ytd.d_qoy = g.d_qoy)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
