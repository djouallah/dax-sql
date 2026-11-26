-- m0: per marital status, the catalog quantity YoY (all dates against every date a year back) past 100
-- picks the status's revenue, else the overall average quantity (AVERAGE: no context transition).
-- m1: the least quantity of the status outside the class 'dresses' (a blank class kept). A sale with no (or an
-- unknown) customer_demographics key makes that table's blank row: a blank status.
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
c AS (
  SELECT cd.cd_marital_status, SUM(cs.cs_quantity) AS q, SUM(cs.cs_ext_sales_price) AS rev,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qly,
    MIN(cs.cs_quantity) FILTER (WHERE i.i_class IS DISTINCT FROM 'dresses') AS mq
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY 1),
a AS (SELECT AVG(cs_quantity) AS a FROM catalog_sales)
SELECT m.cd_marital_status,
  CASE WHEN COALESCE((COALESCE(c.q, 0) - c.qly)::DOUBLE / NULLIF(c.qly, 0), 0) > 100 THEN c.rev::DOUBLE ELSE a.a END AS m0,
  c.mq AS m1
FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
        OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_ship_cdemo_sk IS NULL
          OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics) OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))) m
CROSS JOIN a
LEFT JOIN c ON c.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
