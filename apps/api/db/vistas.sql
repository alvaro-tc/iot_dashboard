-- Vistas de agregación. Archivo aparte para poder recrearlas en un despliegue ya en marcha
-- sin tocar los datos:  pnpm db:vistas
DROP VIEW IF EXISTS v_resumen_sesion, v_lecturas_por_hora, v_lecturas_por_minuto CASCADE;

--
-- "En marcha" = alguna rueda con PWM de al menos 10 (de 255). Por debajo de eso el motor
-- no mueve el chasis: contarlo como marcha infla el tiempo de uso con ruido.

CREATE VIEW v_lecturas_por_minuto AS
SELECT
  l.dispositivo_id,
  l.sesion_id,
  date_trunc('minute', l.creado_en)                       AS minuto,
  count(*)                                                AS lecturas,
  min(l.distancia_izquierda_cm)                           AS min_izquierda_cm,
  min(l.distancia_central_cm)                             AS min_central_cm,
  min(l.distancia_derecha_cm)                             AS min_derecha_cm,
  avg(l.distancia_izquierda_cm)                           AS prom_izquierda_cm,
  avg(l.distancia_central_cm)                             AS prom_central_cm,
  avg(l.distancia_derecha_cm)                             AS prom_derecha_cm,
  avg(abs(l.movimiento_izquierda))                        AS prom_pwm_izquierda,
  avg(abs(l.movimiento_derecha))                          AS prom_pwm_derecha,
  -- Con signo: positivo adelante, negativo atrás. El promedio de |PWM| de arriba dice
  -- cuánto corre la rueda; este dice hacia dónde, que es lo que pinta el widget de motor.
  avg(l.movimiento_izquierda)                             AS prom_mov_izquierda,
  avg(l.movimiento_derecha)                               AS prom_mov_derecha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10) AS lecturas_marcha_izquierda,
  count(*) FILTER (WHERE abs(l.movimiento_derecha)   >= 10) AS lecturas_marcha_derecha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10
                      OR abs(l.movimiento_derecha)   >= 10) AS lecturas_en_marcha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) <  10
                     AND abs(l.movimiento_derecha)   <  10) AS lecturas_detenido,
  avg(l.bateria_porcentaje)                               AS prom_bateria_porcentaje
FROM lecturas l
GROUP BY 1, 2, 3;

CREATE VIEW v_lecturas_por_hora AS
SELECT
  l.dispositivo_id,
  date_trunc('hour', l.creado_en)                         AS hora,
  count(*)                                                AS lecturas,
  min(l.distancia_izquierda_cm)                           AS min_izquierda_cm,
  min(l.distancia_central_cm)                             AS min_central_cm,
  min(l.distancia_derecha_cm)                             AS min_derecha_cm,
  avg(l.distancia_izquierda_cm)                           AS prom_izquierda_cm,
  avg(l.distancia_central_cm)                             AS prom_central_cm,
  avg(l.distancia_derecha_cm)                             AS prom_derecha_cm,
  avg(abs(l.movimiento_izquierda))                        AS prom_pwm_izquierda,
  avg(abs(l.movimiento_derecha))                          AS prom_pwm_derecha,
  -- Con signo: positivo adelante, negativo atrás. El promedio de |PWM| de arriba dice
  -- cuánto corre la rueda; este dice hacia dónde, que es lo que pinta el widget de motor.
  avg(l.movimiento_izquierda)                             AS prom_mov_izquierda,
  avg(l.movimiento_derecha)                               AS prom_mov_derecha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10) AS lecturas_marcha_izquierda,
  count(*) FILTER (WHERE abs(l.movimiento_derecha)   >= 10) AS lecturas_marcha_derecha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10
                      OR abs(l.movimiento_derecha)   >= 10) AS lecturas_en_marcha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) <  10
                     AND abs(l.movimiento_derecha)   <  10) AS lecturas_detenido,
  avg(l.bateria_porcentaje)                               AS prom_bateria_porcentaje,
  -- Cuántas veces cada sensor vio algo a 15 cm o menos: en qué dirección se topa el robot.
  count(*) FILTER (WHERE l.distancia_izquierda_cm IS NOT NULL AND l.distancia_izquierda_cm <= 15) AS cerca_izquierda,
  count(*) FILTER (WHERE l.distancia_central_cm   IS NOT NULL AND l.distancia_central_cm   <= 15) AS cerca_central,
  count(*) FILTER (WHERE l.distancia_derecha_cm   IS NOT NULL AND l.distancia_derecha_cm   <= 15) AS cerca_derecha
FROM lecturas l
GROUP BY 1, 2;

CREATE VIEW v_resumen_sesion AS
SELECT
  s.id                                                                  AS sesion_id,
  s.dispositivo_id,
  s.iniciada_en,
  s.finalizada_en,
  EXTRACT(EPOCH FROM (coalesce(s.finalizada_en, now()) - s.iniciada_en)) AS duracion_s,
  s.total_lecturas,
  s.bateria_inicio_porcentaje,
  s.bateria_fin_porcentaje,
  s.bateria_inicio_porcentaje - s.bateria_fin_porcentaje                AS bateria_consumida_porcentaje,
  agg.lecturas_en_marcha,
  agg.lecturas_detenido,
  agg.prom_pwm_izquierda,
  agg.prom_pwm_derecha,
  agg.min_izquierda_cm,
  agg.min_central_cm,
  agg.min_derecha_cm,
  agg.cerca_izquierda,
  agg.cerca_central,
  agg.cerca_derecha
FROM sesiones s
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10
                        OR abs(l.movimiento_derecha)   >= 10)           AS lecturas_en_marcha,
    count(*) FILTER (WHERE abs(l.movimiento_izquierda) <  10
                       AND abs(l.movimiento_derecha)   <  10)           AS lecturas_detenido,
    avg(abs(l.movimiento_izquierda))                                    AS prom_pwm_izquierda,
    avg(abs(l.movimiento_derecha))                                      AS prom_pwm_derecha,
    min(l.distancia_izquierda_cm)                                       AS min_izquierda_cm,
    min(l.distancia_central_cm)                                         AS min_central_cm,
    min(l.distancia_derecha_cm)                                         AS min_derecha_cm,
    count(*) FILTER (WHERE l.distancia_izquierda_cm IS NOT NULL AND l.distancia_izquierda_cm <= 15) AS cerca_izquierda,
    count(*) FILTER (WHERE l.distancia_central_cm   IS NOT NULL AND l.distancia_central_cm   <= 15) AS cerca_central,
    count(*) FILTER (WHERE l.distancia_derecha_cm   IS NOT NULL AND l.distancia_derecha_cm   <= 15) AS cerca_derecha
  FROM lecturas l WHERE l.sesion_id = s.id
) agg ON true;
