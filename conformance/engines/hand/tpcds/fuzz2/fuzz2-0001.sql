-- per item brand and color (ship_mode never in scope):
-- m0: 0 when no Jewelry store sale of a qualifying class, else the rank of a value every city shares (1)
--     a class qualifies when (its store revenue in the last year of the calendar > 10 ? its share of all store profit : the brand and color's top catalog price) > 100
-- m1: catalog revenue June 2025 to July 10 2026 of non-married bill customers > 100 ? max(last-year catalog quantity, 1 brand) : OVERNIGHT/TWO DAY catalog revenue or 0
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), g AS (
  SELECT DISTINCT i_brand, i_color FROM item
), ssc AS (
  SELECT i.i_brand, i.i_color, i.i_class,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN w.y0 AND w.y1) AS ytd,
    SUM(ss.ss_net_profit) AS profit
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk CROSS JOIN w
  GROUP BY ALL
), csc AS (
  SELECT i.i_brand, i.i_color, MAX(cs.cs_ext_sales_price) AS top
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), cls AS (
  SELECT c.i_brand, c.i_color, c.i_class
  FROM (SELECT DISTINCT i_brand, i_color, i_class FROM item) c
  LEFT JOIN ssc s ON s.i_brand IS NOT DISTINCT FROM c.i_brand AND s.i_color IS NOT DISTINCT FROM c.i_color AND s.i_class IS NOT DISTINCT FROM c.i_class
  LEFT JOIN csc k ON k.i_brand IS NOT DISTINCT FROM c.i_brand AND k.i_color IS NOT DISTINCT FROM c.i_color
  WHERE CASE WHEN COALESCE(s.ytd, 0) > 10 THEN COALESCE(s.profit / NULLIF((SELECT SUM(ss_net_profit) FROM store_sales), 0), 0)
             ELSE COALESCE(k.top, 0) END > 100
), jew AS (
  SELECT DISTINCT i.i_brand, i.i_color
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk AND i.i_category = 'Jewelry'
  JOIN cls ON cls.i_brand IS NOT DISTINCT FROM i.i_brand AND cls.i_color IS NOT DISTINCT FROM i.i_color AND cls.i_class IS NOT DISTINCT FROM i.i_class
), cs AS (
  SELECT i.i_brand, i.i_color,
    SUM(cs.cs_ext_sales_price) FILTER (WHERE d.d_date BETWEEN DATE '2025-06-02' AND DATE '2026-07-10' AND COALESCE(cd.cd_marital_status, '') <> 'M') AS rev,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date BETWEEN w.y0 AND w.y1) AS ytdq,
    SUM(cs.cs_ext_sales_price) FILTER (WHERE sm.sm_type IN ('OVERNIGHT', 'TWO DAY')) AS shiprev
  FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  CROSS JOIN w
  GROUP BY ALL
)
SELECT g.i_brand, g.i_color,
  CASE WHEN EXISTS (SELECT 1 FROM jew j WHERE j.i_brand IS NOT DISTINCT FROM g.i_brand AND j.i_color IS NOT DISTINCT FROM g.i_color) THEN 1 ELSE 0 END,
  CASE WHEN COALESCE(cs.rev, 0) > 100 THEN GREATEST(cs.ytdq, 1) ELSE COALESCE(cs.shiprev, 0) END
FROM g
LEFT JOIN cs ON cs.i_brand IS NOT DISTINCT FROM g.i_brand AND cs.i_color IS NOT DISTINCT FROM g.i_color
