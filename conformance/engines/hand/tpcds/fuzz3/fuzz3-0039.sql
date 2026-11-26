-- the marital statuses whose catalog quantity (bill-to) is past 1000; per status, catalog
-- revenue and store quantity (sales without demographics: the blank status)
WITH c AS (
  SELECT cd.cd_marital_status, SUM(cs.cs_quantity) AS qty, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), s AS (
  SELECT cd.cd_marital_status, SUM(ss.ss_quantity) AS qty
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT c.cd_marital_status, c.rev AS m0, s.qty AS m1
FROM c LEFT JOIN s ON s.cd_marital_status IS NOT DISTINCT FROM c.cd_marital_status
WHERE c.qty > 1000 AND (c.rev IS NOT NULL OR s.qty IS NOT NULL)
