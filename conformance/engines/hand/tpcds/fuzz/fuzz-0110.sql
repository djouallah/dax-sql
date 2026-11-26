-- filters on store and ship mode do not reach the demographics: its marital statuses
SELECT n FROM (
  SELECT NULLIF(COUNT(DISTINCT cd_marital_status) + MAX(CASE WHEN cd_marital_status IS NULL THEN 1 ELSE 0 END), 0) AS n FROM customer_demographics
) WHERE n IS NOT NULL
