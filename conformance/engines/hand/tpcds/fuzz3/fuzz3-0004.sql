-- per quarter number: TOTALYTD replaces the date filter with the year to the quarter number's last
-- date, SAMEPERIODLASTYEAR shifts each of those dates a year back (a month's last day also
-- reaching the shifted month's last day); ALLSELECTED of an unfiltered promotion changes nothing
WITH rev AS (
  SELECT d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), q AS (
  SELECT d_qoy, max(d_date) AS last FROM date_dim GROUP BY d_qoy
), ytd AS (
  SELECT q.d_qoy, d.d_date AS dt FROM q JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', q.last) AND q.last
), ly AS (
  SELECT d_qoy, (dt - INTERVAL 1 YEAR)::DATE AS dt FROM ytd
  UNION SELECT d_qoy, last_day((dt - INTERVAL 1 YEAR)::DATE) FROM ytd WHERE dt = last_day(dt)
)
SELECT ly.d_qoy, SUM(rev.rev) AS m0
FROM ly JOIN rev ON rev.dt = ly.dt
GROUP BY ly.d_qoy
