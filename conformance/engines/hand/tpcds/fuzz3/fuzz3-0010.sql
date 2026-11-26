-- per promotion name (no context transition but in the measures and CALCULATE):
--   the average over the categories of the promotion's store profit share > 1000: catalog revenue;
--   else the promotion's store profit (summed over every store name of store_sales) < 0:
--     HASONEVALUE(ca_state), with no state filter, is false: blank;
--   else the stores (no date or promotion filter reaches store)
-- top 3 by it (blank last), ties by name
WITH sp AS (
  SELECT p.p_promo_name, i.i_category, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk JOIN item i ON i.i_item_sk = ss.ss_item_sk
  GROUP BY ALL
), pn AS (
  SELECT p.p_promo_name, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  GROUP BY ALL
), share AS (
  SELECT pn.p_promo_name, AVG(sp.np / NULLIF(pn.np, 0)) AS avg_share
  FROM pn JOIN sp ON sp.p_promo_name IS NOT DISTINCT FROM pn.p_promo_name
  GROUP BY ALL
), cr AS (
  SELECT p.p_promo_name, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
), m AS (
  SELECT n.p_promo_name,
         CASE WHEN share.avg_share > 1000 THEN cr.rev
              WHEN COALESCE(pn.np, 0) < 0 THEN NULL
              ELSE (SELECT COUNT(*) FROM store) END AS m0
  FROM (SELECT DISTINCT p_promo_name FROM promotion) n
  LEFT JOIN pn ON pn.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
  LEFT JOIN share ON share.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
  LEFT JOIN cr ON cr.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
)
SELECT p_promo_name, m0 FROM m
QUALIFY rank() OVER (ORDER BY m0 DESC NULLS LAST, p_promo_name NULLS FIRST) <= 3
