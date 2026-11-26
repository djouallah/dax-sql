-- AVERAGE of a fixed decimal: the exact SUM / COUNT, rounded half away from zero to 4 places
WITH a AS (
  SELECT
    CAST(SUM(ss_ext_sales_price) FILTER (ss_store_sk = 2 AND ss_item_sk = 16) * 10000 AS HUGEINT) AS s1,
    NULLIF(COUNT(ss_ext_sales_price) FILTER (ss_store_sk = 2 AND ss_item_sk = 16), 0) AS n1,
    CAST(SUM(ss_ext_sales_price) FILTER (ss_store_sk = 6 AND ss_item_sk = 8) * 10000 AS HUGEINT) AS s2,
    NULLIF(COUNT(ss_ext_sales_price) FILTER (ss_store_sk = 6 AND ss_item_sk = 8), 0) AS n2,
    CAST(SUM(ss_ext_sales_price) FILTER (ss_store_sk = 5 AND ss_item_sk = 12) * 10000 AS HUGEINT) AS s3,
    NULLIF(COUNT(ss_ext_sales_price) FILTER (ss_store_sk = 5 AND ss_item_sk = 12), 0) AS n3
  FROM store_sales
  WHERE (ss_store_sk, ss_item_sk) IN ((2, 16), (6, 8), (5, 12))),
r AS (
  SELECT sign(s1) * ((2 * abs(s1) + n1) // (2 * n1)) / 10000 AS avg1,
         sign(s2) * ((2 * abs(s2) + n2) // (2 * n2)) / 10000 AS avg2,
         sign(s3) * ((2 * abs(s3) + n3) // (2 * n3)) / 10000 AS avg3
  FROM a)
SELECT avg1, avg2, avg3, avg2, avg2, avg2 * 100000 FROM r
