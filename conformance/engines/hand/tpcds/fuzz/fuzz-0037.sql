-- items of brands other than "importcorp #1" (a blank brand compares as "", the blank item passes); per marital
-- status (m1 is never blank: every status of the dimension, and the blank one when some sale has no
-- demographics):
-- m0: 0 when catalog has neither revenue nor quantity in February, else store revenue of every date a year
--     back (the average over the categories of one value: ALL(i_category) undoes each category)
-- m1: 0 when the catalog YoY of the last date's year to date (against those dates a year back) is blank, else
--     the catalog quantity
WITH it AS (
  SELECT * FROM item WHERE COALESCE(i_brand, '') <> 'importcorp #1'
), shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), ytd AS (
  SELECT d_date FROM date_dim
  WHERE d_date BETWEEN date_trunc('year', (SELECT MAX(d_date) FROM date_dim))::DATE AND (SELECT MAX(d_date) FROM date_dim)
), ytd_ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM ytd
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM ytd WHERE d_date = last_day(d_date)
), c AS (
  SELECT cd.cd_marital_status,
    SUM(cs.cs_ext_sales_price) FILTER (WHERE d.d_moy = 2) AS rev_feb, SUM(cs.cs_quantity) FILTER (WHERE d.d_moy = 2) AS qty_feb,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT d_date FROM ytd)) AS qty_ytd,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT ly FROM ytd_ly)) AS qty_ytd_ly,
    SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE COALESCE(i.i_brand, '') <> 'importcorp #1'
  GROUP BY ALL
), s AS (
  SELECT cd.cd_marital_status, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  WHERE COALESCE(i.i_brand, '') <> 'importcorp #1'
  GROUP BY ALL
)
SELECT m.cd_marital_status,
  CASE WHEN c.rev_feb IS NULL AND c.qty_feb IS NULL THEN 0
       WHEN (SELECT COUNT(*) FROM it) > 0 THEN s.rev_ly END AS m0,
  CASE WHEN (COALESCE(c.qty_ytd, 0) - c.qty_ytd_ly) / NULLIF(c.qty_ytd_ly, 0) IS NULL THEN 0 ELSE c.qty END AS m1
FROM (SELECT cd_marital_status FROM customer_demographics
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
        OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
          OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))) m
LEFT JOIN c ON c.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
LEFT JOIN s ON s.cd_marital_status IS NOT DISTINCT FROM m.cd_marital_status
