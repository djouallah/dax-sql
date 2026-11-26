WITH g AS (SELECT DISTINCT ca_zip FROM customer_address),
x AS (SELECT d.ca_zip, SUM(f.cs_ext_sales_price) AS x FROM catalog_sales f JOIN customer_address d ON f.cs_bill_addr_sk = d.ca_address_sk GROUP BY d.ca_zip),
y AS (SELECT d.ca_zip, SUM(f.ss_ext_sales_price) AS y FROM store_sales f JOIN customer_address d ON f.ss_addr_sk = d.ca_address_sk GROUP BY d.ca_zip)
SELECT g.ca_zip, x.x, y.y
FROM g
LEFT JOIN x ON x.ca_zip IS NOT DISTINCT FROM g.ca_zip
LEFT JOIN y ON y.ca_zip IS NOT DISTINCT FROM g.ca_zip
