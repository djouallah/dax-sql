-- revenue per category and date of 2024 and 2025 (one pass); per quarter of 2025: its revenue, YoY against its dates a year
-- back, YTD a running sum over 2025's quarters
WITH a AS (
  SELECT i.i_category AS cat, d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year IN (2024, 2025)
  JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk AND ca.ca_state = 'AR'
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_education_status = '2 yr Degree'
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  WHERE ss.cache_buster < 2
  GROUP BY ALL
), q AS ( -- 2025's quarters by their dates (a quarter's d_qoy need not follow calendar quarters), each date a year back
  SELECT d_quarter_name, d_year, d_qoy, d_date AS dt, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim WHERE d_year = 2025
), qly AS ( -- SAMEPERIODLASTYEAR: a month's last day also reaches the shifted month's last day (Feb 28 -> Feb 29)
  SELECT d_quarter_name, ly FROM q UNION SELECT d_quarter_name, last_day(ly) FROM q WHERE dt = last_day(dt)
), cur AS (
  SELECT a.cat, q.d_quarter_name, SUM(a.rev) AS rev FROM a JOIN q USING (dt) GROUP BY ALL
), lyr AS (
  SELECT a.cat, qly.d_quarter_name, SUM(a.rev) AS rev FROM a JOIN qly ON qly.ly = a.dt GROUP BY ALL
), g AS (
  SELECT c.cat, q.d_quarter_name, q.d_year, q.d_qoy
  FROM (SELECT DISTINCT cat FROM a) c CROSS JOIN (SELECT DISTINCT d_quarter_name, d_year, d_qoy FROM q) q
), t AS (
  SELECT g.cat, g.d_quarter_name, g.d_year, c.rev,
    (COALESCE(c.rev, 0) - l.rev) / NULLIF(l.rev, 0) AS yoy,
    SUM(c.rev) OVER (PARTITION BY g.cat ORDER BY g.d_qoy) AS ytd
  FROM g
  LEFT JOIN cur c ON c.cat IS NOT DISTINCT FROM g.cat AND c.d_quarter_name = g.d_quarter_name
  LEFT JOIN lyr l ON l.cat IS NOT DISTINCT FROM g.cat AND l.d_quarter_name = g.d_quarter_name
)
SELECT * FROM t WHERE rev IS NOT NULL OR yoy IS NOT NULL OR ytd IS NOT NULL
ORDER BY cat DESC NULLS LAST, d_quarter_name, d_year
