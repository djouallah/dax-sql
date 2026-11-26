SELECT m0 FROM (
  SELECT SUM(ss.ss_ext_sales_price) AS m0
  FROM store_sales ss JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  WHERE ca.ca_state IN ('CO', 'GA'))
WHERE m0 IS NOT NULL
