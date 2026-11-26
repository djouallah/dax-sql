-- m0: with no item filter the profit share is 1 (when the profit is not 0), so the archive's rows.
-- m1: the largest store price over the catalog quantity (a fixed decimal by a whole number: four places).
-- m2: MAX of two (a blank compares as 0) of the distinct store customers and the average catalog quantity.
WITH s AS (
  SELECT cd.cd_education_status, d.d_year, SUM(ss.ss_net_profit) AS p, MAX(ss.ss_ext_sales_price) AS mx,
    COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS cust
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1, 2),
c AS (
  SELECT cd.cd_education_status, d.d_year, SUM(cs.cs_quantity) AS q, AVG(cs.cs_quantity) AS aq
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY 1, 2),
a AS (SELECT SUM(row_count) AS r FROM stg_tpcds_archive_log),
t AS (
  SELECT g.cd_education_status, g.d_year,
    a.r / CASE WHEN s.p <> 0 THEN 1 END::DOUBLE AS m0,
    ROUND(s.mx / NULLIF(c.q, 0), 4) AS m1,
    CASE WHEN COALESCE(s.cust, 0) > COALESCE(c.aq, 0) THEN s.cust WHEN COALESCE(c.aq, 0) > COALESCE(s.cust, 0) THEN c.aq
      ELSE COALESCE(s.cust, c.aq) END AS m2
  FROM (SELECT * FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e, (SELECT DISTINCT d_year FROM date_dim) y) g CROSS JOIN a
  LEFT JOIN s ON s.cd_education_status IS NOT DISTINCT FROM g.cd_education_status AND s.d_year IS NOT DISTINCT FROM g.d_year
  LEFT JOIN c ON c.cd_education_status IS NOT DISTINCT FROM g.cd_education_status AND c.d_year IS NOT DISTINCT FROM g.d_year)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
