-- every address, catalog sales by ship address (USERELATIONSHIP), store sales by address
WITH x AS (SELECT cs_ship_addr_sk AS k, SUM(cs_quantity) AS x FROM catalog_sales GROUP BY cs_ship_addr_sk),
y AS (SELECT ss_addr_sk AS k, SUM(ss_ext_sales_price) AS y FROM store_sales GROUP BY ss_addr_sk)
SELECT ca_address_sk, x.x, y.y
FROM customer_address
LEFT JOIN x ON x.k = ca_address_sk
LEFT JOIN y ON y.k = ca_address_sk
