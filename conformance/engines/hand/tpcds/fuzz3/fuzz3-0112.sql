-- SUMMARIZE over store_sales: a group's context is its store_sales rows, which reach catalog_sales
-- only through the dimensions both share (item, promotion, address, demographics, date): a catalog
-- sale counts when its keys are those of one of the group's store sales (a NULL key meets a NULL key,
-- both the dimension's blank row). m0 sums over the states of the group's stores (a group of no
-- store: the blank state of store's blank row): 0 with no such catalog sale, else the larger of that
-- catalog quantity a year back and the group's stores in the state (none in the blank one: blank). m1: the
-- group's profit over itself, REMOVEFILTERS('item') leaving the store_sales rows in place
WITH g AS (
  SELECT s.s_city, i.i_color, s.s_state, s.s_store_sk, d.d_date, ss.*
  FROM store_sales ss
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), grp AS (
  SELECT s_city, i_color, SUM(ss_net_profit) AS pr FROM g GROUP BY ALL
), k4 AS (
  SELECT DISTINCT s_city, i_color, ss_item_sk, ss_promo_sk, ss_addr_sk, ss_cdemo_sk FROM g
), k5 AS (
  SELECT DISTINCT s_city, i_color, ss_item_sk, ss_promo_sk, ss_addr_sk, ss_cdemo_sk, ss_sold_date_sk FROM g
), x AS (
  SELECT k.s_city, k.i_color, MAX(cs.cs_ext_sales_price) AS mx
  FROM k5 k JOIN catalog_sales cs ON cs.cs_item_sk IS NOT DISTINCT FROM k.ss_item_sk
    AND cs.cs_promo_sk IS NOT DISTINCT FROM k.ss_promo_sk
    AND cs.cs_bill_addr_sk IS NOT DISTINCT FROM k.ss_addr_sk
    AND cs.cs_bill_cdemo_sk IS NOT DISTINCT FROM k.ss_cdemo_sk
    AND cs.cs_sold_date_sk IS NOT DISTINCT FROM k.ss_sold_date_sk
  GROUP BY ALL
), ly AS (
  SELECT k.s_city, k.i_color, SUM(cs.cs_quantity) AS q
  FROM k4 k
  JOIN x ON x.s_city IS NOT DISTINCT FROM k.s_city AND x.i_color IS NOT DISTINCT FROM k.i_color
  JOIN catalog_sales cs ON cs.cs_item_sk IS NOT DISTINCT FROM k.ss_item_sk
    AND cs.cs_promo_sk IS NOT DISTINCT FROM k.ss_promo_sk
    AND cs.cs_bill_addr_sk IS NOT DISTINCT FROM k.ss_addr_sk
    AND cs.cs_bill_cdemo_sk IS NOT DISTINCT FROM k.ss_cdemo_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE (d.d_date + INTERVAL 1 YEAR)::DATE IN (SELECT g2.d_date FROM g g2 WHERE g2.s_city IS NOT DISTINCT FROM k.s_city AND g2.i_color IS NOT DISTINCT FROM k.i_color)
  GROUP BY ALL
), st AS (
  SELECT s_city, i_color, s_state, NULLIF(COUNT(DISTINCT s_store_sk), 0) AS n FROM g GROUP BY ALL
)
SELECT grp.s_city, grp.i_color,
  (SELECT SUM(CASE WHEN x.mx IS NULL THEN 0 WHEN COALESCE(ly.q, 0) >= COALESCE(st.n, 0) THEN COALESCE(ly.q, st.n) ELSE st.n END)
   FROM st WHERE st.s_city IS NOT DISTINCT FROM grp.s_city AND st.i_color IS NOT DISTINCT FROM grp.i_color) AS m0,
  grp.pr / NULLIF(grp.pr, 0) AS m1
FROM grp
LEFT JOIN x ON x.s_city IS NOT DISTINCT FROM grp.s_city AND x.i_color IS NOT DISTINCT FROM grp.i_color
LEFT JOIN ly ON ly.s_city IS NOT DISTINCT FROM grp.s_city AND ly.i_color IS NOT DISTINCT FROM grp.i_color
