-- m0: the items at 70.98 or 7.91 hold no more than 100 brands, so the greater of the store revenue and
-- the least store price (both at those prices). m1: the state's store names when the catalog quantity a
-- year before 2024-01-12..2025-08-02 is positive (catalog_sales is not filtered by store), plus the catalog
-- profit. Every promotion name x state x education status where one is not blank. A sale with no (or an unknown)
-- promotion, store or customer_demographics key makes that table's blank row: a blank promotion name, state (its
-- one store name the blank one) or education status, holding those sales.
WITH brands AS (
  SELECT COUNT(DISTINCT i_brand) + (COUNT(*) > COUNT(i_brand))::INT AS n FROM item WHERE i_current_price IN (70.98, 7.91)),
s AS (
  SELECT p.p_promo_name, st.s_state, cd.cd_education_status,
    SUM(ss.ss_ext_sales_price) AS rev, MIN(ss.ss_ext_sales_price) AS mn
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  WHERE i.i_current_price IN (70.98, 7.91)
  GROUP BY ALL),
dr AS (SELECT d_date AS dt FROM date_dim WHERE d_date BETWEEN DATE '2024-01-12' AND DATE '2025-08-02'),
ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM dr
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM dr WHERE dt = last_day(dt)),
c AS (
  SELECT p.p_promo_name, cd.cd_education_status, SUM(cs.cs_net_profit) AS np,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qly
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL),
b AS (
  SELECT EXISTS (SELECT 1 FROM store_sales WHERE ss_promo_sk IS NULL OR ss_promo_sk NOT IN (SELECT p_promo_sk FROM promotion))
      OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_promo_sk IS NULL OR cs_promo_sk NOT IN (SELECT p_promo_sk FROM promotion)) AS p,
    EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store)) AS st,
    EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
      OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_ship_cdemo_sk IS NULL
        OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics) OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)) AS cd),
names AS (
  SELECT s_state, COUNT(DISTINCT s_store_name) + (COUNT(*) > COUNT(s_store_name))::INT AS n FROM store GROUP BY 1
  UNION ALL SELECT NULL, 1 FROM b WHERE b.st AND NOT EXISTS (SELECT 1 FROM store WHERE s_state IS NULL)),
g AS (
  SELECT p.p_promo_name, st.s_state, cd.cd_education_status
  FROM (SELECT DISTINCT p_promo_name FROM promotion UNION SELECT NULL FROM b WHERE b.p) p,
       (SELECT DISTINCT s_state FROM store UNION SELECT NULL FROM b WHERE b.st) st,
       (SELECT DISTINCT cd_education_status FROM customer_demographics UNION SELECT NULL FROM b WHERE b.cd) cd),
t AS (
  SELECT g.*,
    CASE WHEN brands.n > 100 THEN NULL ELSE GREATEST(s.rev, s.mn) END AS m0,
    CASE WHEN c.qly > 0 THEN names.n END AS k, c.np
  FROM g CROSS JOIN brands
  LEFT JOIN s ON s.p_promo_name IS NOT DISTINCT FROM g.p_promo_name AND s.s_state IS NOT DISTINCT FROM g.s_state
    AND s.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
  LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM g.p_promo_name AND c.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
  LEFT JOIN names ON names.s_state IS NOT DISTINCT FROM g.s_state)
SELECT p_promo_name, s_state, cd_education_status, m0,
  CASE WHEN k IS NULL AND np IS NULL THEN NULL ELSE COALESCE(k, 0) + COALESCE(np, 0) END AS m1
FROM t
WHERE m0 IS NOT NULL OR k IS NOT NULL OR np IS NOT NULL
