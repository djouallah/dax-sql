-- per year of the date table (no blank year for sales of no date, as dax-sql has it beside a time intelligence
-- measure): store revenue of the year's dates a year back, date by date
WITH shift AS (
  SELECT d_year, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_year, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), sd AS (
  SELECT d.d_date AS dt, d.d_year, SUM(ss.ss_ext_sales_price) AS rev, MIN(ss.ss_ext_sales_price) AS minp
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), ly AS (
  SELECT shift.d_year, SUM(sd.rev) AS rev FROM shift JOIN sd ON sd.dt = shift.ly GROUP BY ALL
), s AS (
  SELECT d_year, MIN(minp) AS minp FROM sd GROUP BY ALL
), c AS (
  SELECT d.d_year, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), g AS (
  SELECT DISTINCT d_year FROM date_dim
)
SELECT g.d_year, ly.rev AS m0, s.minp AS m1, c.qty AS m2
FROM g
LEFT JOIN ly ON ly.d_year IS NOT DISTINCT FROM g.d_year
LEFT JOIN s ON s.d_year IS NOT DISTINCT FROM g.d_year
LEFT JOIN c ON c.d_year IS NOT DISTINCT FROM g.d_year
WHERE ly.rev IS NOT NULL OR s.minp IS NOT NULL OR c.qty IS NOT NULL
