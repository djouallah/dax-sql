-- d_year is held to -1: the date table has no such year, so no rows
SELECT d_qoy, d_year, NULL::DOUBLE AS m0, NULL::DOUBLE AS m1, NULL::DOUBLE AS m2
FROM date_dim WHERE d_year = -1 AND FALSE
