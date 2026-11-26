-- m0: DATESINPERIOD ending 1999-01-01 holds no date of the calendar, blank; m1 and m2 need store
-- sales, so the groups are theirs (a sale with no demographics: a blank status); m2: every state
-- of the addresses joined by "," (not filtered by the sales), over the catalog's largest profit
-- over the store's average sale (a fixed decimal, rounded half away from zero to 4 places)
WITH s AS (
  SELECT cd.cd_marital_status, i.i_category, i.i_current_price, SUM(ss.ss_net_profit) AS np,
    ROUND((SUM(ss.ss_ext_sales_price) * 1000000)::HUGEINT // NULLIF(COUNT(ss.ss_ext_sales_price), 0) * 0.000001, 4) AS av
  FROM store_sales ss
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), c AS (
  SELECT cd.cd_marital_status, i.i_category, i.i_current_price, MAX(cs.cs_net_profit) AS mx
  FROM catalog_sales cs
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY ALL
), l AS (SELECT SUM(LENGTH(COALESCE(ca_state, ''))) + COUNT(*) - 1 AS n FROM (SELECT DISTINCT ca_state FROM customer_address)),
t AS (
  SELECT s.cd_marital_status, s.i_category, s.i_current_price, NULL::DECIMAL(18, 4) AS m0, s.np AS m1,
    l.n / NULLIF(c.mx / NULLIF(s.av, 0), 0) AS m2
  FROM s CROSS JOIN l
  LEFT JOIN c ON c.cd_marital_status IS NOT DISTINCT FROM s.cd_marital_status AND c.i_category IS NOT DISTINCT FROM s.i_category AND c.i_current_price IS NOT DISTINCT FROM s.i_current_price
)
SELECT * FROM t WHERE m1 IS NOT NULL OR m2 IS NOT NULL
