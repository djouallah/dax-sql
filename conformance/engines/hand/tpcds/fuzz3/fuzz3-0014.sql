-- the measure reaches no fact the groups filter: the item brands (a blank brand counts) or the
-- archive's source rows, the larger, for every education status x state
WITH m AS (
  SELECT greatest((SELECT NULLIF(COUNT(DISTINCT i_brand) + MAX(CASE WHEN i_brand IS NULL THEN 1 ELSE 0 END), 0) FROM item),
                  (SELECT SUM(row_count) FROM stg_tpcds_archive_log)) AS m0
)
SELECT e.cd_education_status, s.s_state, m.m0
FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e
CROSS JOIN (SELECT DISTINCT s_state FROM store) s CROSS JOIN m
WHERE m.m0 IS NOT NULL
