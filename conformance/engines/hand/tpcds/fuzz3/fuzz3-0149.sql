-- SUMMARIZE over store_sales by the address's state (a sale with no address: blank): a group's
-- context is its store_sales rows, which reach catalog_sales only through the dimensions both
-- share (item, promotion, billing address and demographics, date). m1: the group's average sale
-- when its catalog revenue is not blank (or, in the month to 2026-10-30, its marital statuses
-- plus its catalog quantity pass 1000), else its revenue on the dates a year before its own
-- sales' dates (a month's last day also reaching the days after it a year back, as Feb 29)
WITH g AS (
  SELECT ca.ca_state, d.d_date, ss.*
  FROM store_sales ss
  LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
), gd AS (
  SELECT DISTINCT ca_state, d_date FROM g WHERE d_date IS NOT NULL
), shifted AS (
  SELECT gd.ca_state, (gd.d_date - INTERVAL 1 YEAR)::DATE AS d FROM gd
  UNION
  SELECT gd.ca_state, x.d_date
  FROM gd
  JOIN gd p ON p.ca_state IS NOT DISTINCT FROM gd.ca_state AND p.d_date = gd.d_date - 1
  JOIN date_dim x ON x.d_date > (gd.d_date - INTERVAL 1 YEAR) AND x.d_date <= last_day((gd.d_date - INTERVAL 1 YEAR)::DATE)
  WHERE gd.d_date = last_day(gd.d_date)
), ly AS (
  SELECT g.ca_state, SUM(g.ss_ext_sales_price) AS r
  FROM g
  JOIN shifted s ON s.ca_state IS NOT DISTINCT FROM g.ca_state AND s.d = g.d_date
  GROUP BY ALL
), k AS (
  SELECT DISTINCT ca_state, ss_item_sk, ss_promo_sk, ss_addr_sk, ss_cdemo_sk, ss_sold_date_sk FROM g
), cat AS (
  SELECT k.ca_state, SUM(cs.cs_ext_sales_price) AS rev,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date > DATE '2026-09-30' AND d.d_date <= DATE '2026-10-30') AS q
  FROM k JOIN catalog_sales cs ON cs.cs_item_sk = k.ss_item_sk AND cs.cs_promo_sk = k.ss_promo_sk
    AND cs.cs_bill_addr_sk = k.ss_addr_sk AND cs.cs_bill_cdemo_sk = k.ss_cdemo_sk AND cs.cs_sold_date_sk = k.ss_sold_date_sk
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), grp AS (
  SELECT g.ca_state,
    ROUND((SUM(g.ss_ext_sales_price) * 1000000)::HUGEINT // NULLIF(COUNT(g.ss_ext_sales_price), 0) * 0.000001, 4) AS av,
    COUNT(DISTINCT cd.cd_marital_status) FILTER (WHERE g.d_date > DATE '2026-09-30' AND g.d_date <= DATE '2026-10-30') AS dcm
  FROM g LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = g.ss_cdemo_sk
  GROUP BY ALL
)
SELECT grp.ca_state, (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS m0,
  CASE WHEN (NULLIF(grp.dcm, 0) IS NOT NULL OR cat.q IS NOT NULL) AND COALESCE(grp.dcm, 0) + COALESCE(cat.q, 0) > 1000
         OR cat.rev IS NOT NULL
       THEN grp.av ELSE ly.r END AS m1
FROM grp
LEFT JOIN cat ON cat.ca_state IS NOT DISTINCT FROM grp.ca_state
LEFT JOIN ly ON ly.ca_state IS NOT DISTINCT FROM grp.ca_state
