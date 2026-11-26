-- quantity per date of 2024 and 2025 (one pass), summed per quarter of 2025 and per its dates a year back
WITH a AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year IN (2024, 2025)
  JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk AND ca.ca_state = 'AR'
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_education_status = '2 yr Degree'
  WHERE cs.cache_buster < 2
  GROUP BY ALL
), q AS ( -- 2025's quarters by their dates (a quarter's d_qoy need not follow calendar quarters), each date a year back
  SELECT d_quarter_name, d_year, d_qoy, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim WHERE d_year = 2025
), qly AS ( -- SAMEPERIODLASTYEAR: a month's last day also reaches the shifted month's last day (Feb 28 -> Feb 29)
  SELECT d_quarter_name, ly FROM q UNION SELECT d_quarter_name, last_day(ly) FROM q WHERE dt = last_day(dt)
), t AS (
  SELECT g.d_quarter_name, c.qty, l.qty AS ly, (COALESCE(c.qty, 0) - l.qty) / NULLIF(l.qty, 0) AS yoy
  FROM (SELECT DISTINCT d_quarter_name FROM q) g
  LEFT JOIN (SELECT d_quarter_name, SUM(qty) AS qty FROM q JOIN a USING (dt) GROUP BY ALL) c USING (d_quarter_name)
  LEFT JOIN (SELECT d_quarter_name, SUM(qty) AS qty FROM qly JOIN a ON a.dt = qly.ly GROUP BY ALL) l USING (d_quarter_name)
)
SELECT * FROM t WHERE qty IS NOT NULL OR ly IS NOT NULL OR yoy IS NOT NULL
ORDER BY d_quarter_name DESC NULLS LAST
