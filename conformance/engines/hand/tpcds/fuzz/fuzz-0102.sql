-- YTD: the last year; the archive log is related to nothing (no date range empties it): its rows
WITH a AS (
  SELECT ca.ca_state AS st, ROUND(AVG(cs.cs_ext_sales_price), 4) AS av
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk AND d.d_year = (SELECT MAX(d_year) FROM date_dim)
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY 1
), src AS (SELECT SUM(row_count) AS v FROM stg_tpcds_archive_log),
g AS (SELECT DISTINCT ca_state AS st FROM customer_address UNION SELECT st FROM a),
r AS (
  SELECT g.st, CASE WHEN a.av IS NULL AND src.v IS NULL THEN NULL ELSE COALESCE(a.av * 2, 0) + COALESCE(src.v, 0) END AS m0
  FROM g CROSS JOIN src LEFT JOIN a ON a.st IS NOT DISTINCT FROM g.st
)
SELECT * FROM r WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0) <= 4
