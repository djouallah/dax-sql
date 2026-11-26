-- under the three cities (a filter on store: store_sales only). m1: the first factor is the larger of
-- the cities' states (archive files are never blank) and the revenue's rank among the education's
-- marital statuses; the second is 0 with no catalog revenue (the quarter is not in scope), else the
-- store rows: never blank but with no store rows, so nearly every group is one
WITH cat AS (
  SELECT sm.sm_type AS s, cd.cd_education_status AS e, cd.cd_marital_status AS m,
    AVG(cs.cs_quantity) FILTER (WHERE ca.ca_state IS NULL OR ca.ca_state <> 'TX') AS aq,
    SUM(cs.cs_ext_sales_price) AS sp
  FROM catalog_sales cs
  LEFT JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk
  GROUP BY 1, 2, 3
), st AS (
  SELECT cd.cd_education_status AS e, cd.cd_marital_status AS m, SUM(ss.ss_ext_sales_price) AS rev, COUNT(*) AS n
  FROM store_sales ss
  JOIN store s ON s.s_store_sk = ss.ss_store_sk AND s.s_city IN ('Fairview', 'Oak Grove', 'Midway')
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY 1, 2
), k AS (
  SELECT CASE WHEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) = 0 THEN 0 ELSE
    (SELECT COUNT(DISTINCT s_state) + MAX(CASE WHEN s_state IS NULL THEN 1 ELSE 0 END) FROM store WHERE s_city IN ('Fairview', 'Oak Grove', 'Midway')) END AS states
), sm AS (SELECT DISTINCT sm_type AS s FROM ship_mode),
g AS (
  SELECT sm.s, cd.e, cd.m FROM sm CROSS JOIN (SELECT DISTINCT cd_education_status AS e, cd_marital_status AS m FROM customer_demographics) cd
), em AS (SELECT DISTINCT e, m FROM g),
rk AS (
  SELECT em.e, em.m, 1 + COUNT(*) FILTER (WHERE COALESCE(o.rev, 0) > COALESCE(cur.rev, 0)) AS r
  FROM em
  CROSS JOIN (SELECT DISTINCT cd_marital_status AS m FROM customer_demographics) x
  LEFT JOIN st cur ON cur.e IS NOT DISTINCT FROM em.e AND cur.m IS NOT DISTINCT FROM em.m
  LEFT JOIN st o ON o.e IS NOT DISTINCT FROM em.e AND o.m IS NOT DISTINCT FROM x.m
  GROUP BY 1, 2
), r AS (
  SELECT g.s, g.e, g.m, cat.aq AS m0,
    GREATEST(k.states, rk.r) * CASE WHEN cat.sp IS NULL THEN 0 ELSE st.n END AS m1
  FROM g
  CROSS JOIN k
  LEFT JOIN cat ON cat.s IS NOT DISTINCT FROM g.s AND cat.e IS NOT DISTINCT FROM g.e AND cat.m IS NOT DISTINCT FROM g.m
  LEFT JOIN st ON st.e IS NOT DISTINCT FROM g.e AND st.m IS NOT DISTINCT FROM g.m
  LEFT JOIN rk ON rk.e IS NOT DISTINCT FROM g.e AND rk.m IS NOT DISTINCT FROM g.m
)
SELECT * FROM r WHERE m0 IS NOT NULL OR m1 IS NOT NULL
