-- SUM sees neither the state row nor the marital row (no CALCULATE): the total profit. A sale with no
-- (or an unknown) store or demographics gives that table a blank row: a blank state, a blank marital status
WITH blank AS (
  SELECT EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)) AS st,
    EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)) AS cd
)
SELECT g.s_state,
  CASE WHEN (SELECT SUM(ss_net_profit) FROM store_sales) > 10 THEN
    (SELECT NULLIF(COUNT(DISTINCT cd_marital_status) + (MAX(CASE WHEN cd_marital_status IS NULL THEN 1 ELSE 0 END) = 1 OR ANY_VALUE(blank.cd))::INT, 0)
     FROM customer_demographics, blank) END
FROM (SELECT DISTINCT s_state FROM store UNION SELECT NULL FROM blank WHERE st) g
