-- m0: catalog revenue; m1: DATESBETWEEN from after to before is empty: blank;
-- m2: the least catalog sales price over the year to the last date
WITH last AS (SELECT max(d_date) AS dt FROM date_dim)
SELECT (SELECT SUM(cs_ext_sales_price) FROM catalog_sales) AS m0,
       NULL::DOUBLE AS m1,
       (SELECT MIN(cs.cs_ext_sales_price) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk, last
        WHERE d.d_date BETWEEN date_trunc('year', last.dt) AND last.dt) AS m2
