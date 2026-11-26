-- per ship mode type: all store revenue (store_sales is not related to ship_mode), rounded to units
SELECT sm_type, (SELECT ABS(ROUND(SUM(ss_ext_sales_price), 0)) FROM store_sales) AS m0
FROM (SELECT DISTINCT sm_type FROM ship_mode)
