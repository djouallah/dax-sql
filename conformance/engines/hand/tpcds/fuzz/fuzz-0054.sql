-- every education status by every store city (the dimensions' values, as dax-sql has them: no blank row);
-- m0: catalog YoY of the status against every date a year back (the store city reaches no catalog sale)
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT cd.cd_education_status, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS qty_ly
  FROM catalog_sales cs JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), s AS (
  SELECT cd.cd_education_status, st.s_city, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), t AS (
  SELECT e.cd_education_status, g.s_city, (COALESCE(c.qty, 0) - c.qty_ly) / NULLIF(c.qty_ly, 0) AS m0, s.rev AS m1
  FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e CROSS JOIN (SELECT DISTINCT s_city FROM store) g
  LEFT JOIN c ON c.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
  LEFT JOIN s ON s.cd_education_status IS NOT DISTINCT FROM e.cd_education_status AND s.s_city IS NOT DISTINCT FROM g.s_city
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL
