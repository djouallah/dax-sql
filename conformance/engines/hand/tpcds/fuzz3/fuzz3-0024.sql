-- m0: catalog YoY, all sales against every date a year back
-- m1: 0 with no store sales, else store revenue over the year to the last date of
--     1998-12-02 .. 1999-01-01 (the YTD of a YTD is the same dates; no such date: blank)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), c AS (
  SELECT SUM(cs.cs_quantity) AS qty, SUM(cs.cs_quantity) FILTER (WHERE ly.dt IS NOT NULL) AS qty_ly
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN ly ON ly.dt = d.d_date
), last AS (
  SELECT max(d_date) AS dt FROM date_dim WHERE d_date > DATE '1999-01-01' - INTERVAL 1 MONTH AND d_date <= DATE '1999-01-01'
)
SELECT (COALESCE(c.qty, 0) - c.qty_ly) / NULLIF(c.qty_ly, 0) AS m0,
       CASE WHEN NOT EXISTS (SELECT 1 FROM store_sales) THEN 0
            ELSE (SELECT SUM(ss.ss_ext_sales_price) FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk, last
                  WHERE d.d_date BETWEEN date_trunc('year', last.dt) AND last.dt) END AS m1
FROM c
