-- the store names, each with the education statuses of every demographic (nothing filters customer_demographics)
SELECT s_store_name,
  (SELECT COUNT(DISTINCT cd_education_status) + MAX(CASE WHEN cd_education_status IS NULL THEN 1 ELSE 0 END) FROM customer_demographics)
FROM (SELECT DISTINCT s_store_name FROM store)
