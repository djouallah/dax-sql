-- m1: the least catalog quantity of one promotion name (every name: no group column reaches promotion; sales
-- of no promotion are in the blank name); no blank marital status for sales of no customer, as dax-sql has it
-- beside an iteration over another dimension
WITH g AS (
  SELECT cd.cd_marital_status, i.i_brand, i.i_color, p.p_promo_name, MAX(cs.cs_net_profit) AS maxp, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), t AS (
  SELECT cd_marital_status, i_brand, i_color, MAX(maxp) AS m0,
    MIN(qty) FILTER (WHERE p_promo_name IN (SELECT p_promo_name FROM promotion)
                        OR p_promo_name IS NULL AND EXISTS (SELECT 1 FROM promotion WHERE p_promo_name IS NULL)) AS m1,
    SUM(qty) AS m2
  FROM g GROUP BY ALL
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
