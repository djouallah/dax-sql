-- the store names (the blank one too, for a sale with no or an unknown store), each with the education
-- statuses of every demographic (nothing filters customer_demographics; DISTINCTCOUNT leaves out its blank row)
SELECT s_store_name,
  (SELECT COUNT(DISTINCT cd_education_status) + MAX(CASE WHEN cd_education_status IS NULL THEN 1 ELSE 0 END) FROM customer_demographics)
FROM (
  SELECT DISTINCT s_store_name FROM store
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))
)
