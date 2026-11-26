-- per item color: DIVIDE(IF(HASONEVALUE(store city), ...), ...); no filter leaves the stores one city,
-- so every numerator is blank and no color has a value
SELECT DISTINCT i_color, CAST(NULL AS DOUBLE) AS m0
FROM item
WHERE (SELECT COUNT(DISTINCT s_city) FROM store) = 1 AND false
