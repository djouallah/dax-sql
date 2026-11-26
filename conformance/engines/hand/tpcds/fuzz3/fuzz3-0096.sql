-- per marital status (of 2 yr Degree), quarter (d_qoy) and promotion name, all shown (the archive's rows never
-- blank): twice the addresses' distinct states (filtered by nothing, blank counting once) plus the catalog
-- quantity of the last class by descending name (blank sorts last) over the quarter's dates a year back
WITH cl AS (SELECT i_class FROM (SELECT DISTINCT i_class FROM item) ORDER BY i_class ASC NULLS FIRST LIMIT 1
), ly AS (
  SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), q AS (
  SELECT cd.cd_marital_status AS ms, ly.d_qoy AS q, p.p_promo_name AS pn, SUM(cs.cs_quantity) AS sply
  FROM catalog_sales cs
  JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk AND cd.cd_education_status = '2 yr Degree'
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND i.i_class IS NOT DISTINCT FROM (SELECT i_class FROM cl)
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN ly ON ly.dt = d.d_date
  LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  GROUP BY ALL
)
SELECT gm.cd_marital_status, gq.d_qoy, gp.p_promo_name,
  (SELECT COUNT(DISTINCT ca_state) + MAX((ca_state IS NULL)::INT) FROM customer_address) * 2 + COALESCE(q.sply, 0) AS m0,
  (SELECT SUM(row_count) FROM stg_tpcds_archive_log) AS m1
FROM (SELECT DISTINCT cd_marital_status FROM customer_demographics WHERE cd_education_status = '2 yr Degree') gm
CROSS JOIN (SELECT DISTINCT d_qoy FROM date_dim) gq
CROSS JOIN (SELECT DISTINCT p_promo_name FROM promotion) gp
LEFT JOIN q ON q.ms = gm.cd_marital_status AND q.q = gq.d_qoy AND q.pn IS NOT DISTINCT FROM gp.p_promo_name
