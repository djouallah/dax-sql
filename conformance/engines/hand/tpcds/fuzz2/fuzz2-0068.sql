SELECT m0 FROM (
  SELECT MIN(ss.ss_ext_sales_price) AS m0
  FROM store_sales ss JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  WHERE cd.cd_education_status IN ('4 yr Degree', 'College'))
WHERE m0 IS NOT NULL
