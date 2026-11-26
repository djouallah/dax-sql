-- DISTINCTCOUNT counts a missing customer as one more value
-- every cd_marital_status of customer_demographics, each fact through its own relationship
WITH d AS (SELECT DISTINCT cd_marital_status FROM customer_demographics),
x AS (SELECT cd_marital_status, SUM(cs_net_profit) AS x FROM catalog_sales JOIN customer_demographics ON cd_demo_sk = cs_ship_cdemo_sk GROUP BY cd_marital_status),
y AS (SELECT cd_marital_status, NULLIF(COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT, 0) AS y FROM store_sales JOIN customer_demographics ON cd_demo_sk = ss_cdemo_sk GROUP BY cd_marital_status)
SELECT d.cd_marital_status, x.x, y.y
FROM d
LEFT JOIN x ON x.cd_marital_status IS NOT DISTINCT FROM d.cd_marital_status
LEFT JOIN y ON y.cd_marital_status IS NOT DISTINCT FROM d.cd_marital_status
