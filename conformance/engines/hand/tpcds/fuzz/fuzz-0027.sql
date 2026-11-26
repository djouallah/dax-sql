-- married customers ("zz-none" is no status), the years other than 2026 (the blank year too: BLANK <> 2026,
-- so m1 counts the store sales with no date; they shift to no date a year back); m0: the store cities (no filter
-- reaches store); m2: catalog quantity of those years' dates a year back
WITH dates AS (
  SELECT d_date FROM date_dim WHERE d_year <> 2026
), shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM dates
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM dates WHERE d_date = last_day(d_date)
), t AS (
  SELECT
    (SELECT NULLIF(COUNT(DISTINCT s_city) + (COUNT(*) > COUNT(s_city))::INT, 0) FROM store) AS m0,
    (SELECT NULLIF(COUNT(*), 0) FROM store_sales ss
     JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk AND cd.cd_marital_status IN ('zz-none', 'M')
     LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
     WHERE d.d_year IS DISTINCT FROM 2026) AS m1,
    (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs
     JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_marital_status IN ('zz-none', 'M')
     JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)) AS m2
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
