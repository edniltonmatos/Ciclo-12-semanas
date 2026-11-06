-- TESP | Tempo de espera SP
-- Detalhe de um período: coorte, funil, cobertura e rankings.
--
-- A primeira versão lia wait_contributions inteira várias vezes. A API cancela
-- em cerca de 3 segundos (statement timeout) e o painel mostrava "sem conexão".
-- Aqui a primeira coleta de cada lugar fica numa tabela pequena, atualizada
-- por trigger. A função da API só olha a janela do período.
--
-- Rode este arquivo inteiro no SQL Editor do TESP. Pode rodar de novo.

SET statement_timeout = '300s';

CREATE TABLE IF NOT EXISTS public.okr_place_first (
  name_key text NOT NULL DEFAULT '',
  city_key text NOT NULL DEFAULT '',
  uf_key text NOT NULL DEFAULT '',
  first_at timestamptz NOT NULL,
  PRIMARY KEY (name_key, city_key, uf_key)
);

CREATE INDEX IF NOT EXISTS okr_place_first_at_idx
  ON public.okr_place_first (first_at);

ALTER TABLE public.okr_place_first ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.okr_place_first FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS wait_contributions_created_at_idx
  ON public.wait_contributions (created_at);

CREATE INDEX IF NOT EXISTS wait_contributions_user_created_idx
  ON public.wait_contributions ((contributor_user_id::text), created_at);

CREATE INDEX IF NOT EXISTS wait_contributions_email_only_created_idx
  ON public.wait_contributions (lower(btrim(contributor_email)), created_at)
  WHERE contributor_user_id IS NULL AND contributor_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_profiles_created_at_idx
  ON public.delivery_profiles (created_at);

CREATE OR REPLACE FUNCTION public.okr_place_first_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := coalesce(nullif(lower(btrim(NEW.store_name)), ''), '');
  v_city text := coalesce(nullif(lower(btrim(NEW.store_city)), ''), '');
  v_uf text := coalesce(nullif(lower(btrim(NEW.store_uf)), ''), '');
BEGIN
  IF v_name = '' AND v_city = '' AND v_uf = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.okr_place_first (name_key, city_key, uf_key, first_at)
  VALUES (v_name, v_city, v_uf, NEW.created_at)
  ON CONFLICT (name_key, city_key, uf_key)
  DO UPDATE SET first_at = LEAST(public.okr_place_first.first_at, EXCLUDED.first_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS okr_place_first_bi ON public.wait_contributions;
CREATE TRIGGER okr_place_first_bi
  BEFORE INSERT ON public.wait_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.okr_place_first_apply();

INSERT INTO public.okr_place_first (name_key, city_key, uf_key, first_at)
SELECT
  coalesce(nullif(lower(btrim(store_name)), ''), ''),
  coalesce(nullif(lower(btrim(store_city)), ''), ''),
  coalesce(nullif(lower(btrim(store_uf)), ''), ''),
  min(created_at)
FROM public.wait_contributions
WHERE nullif(btrim(store_name), '') IS NOT NULL
   OR nullif(btrim(store_city), '') IS NOT NULL
   OR nullif(btrim(store_uf), '') IS NOT NULL
GROUP BY 1, 2, 3
ON CONFLICT (name_key, city_key, uf_key)
DO UPDATE SET first_at = LEAST(public.okr_place_first.first_at, EXCLUDED.first_at);

CREATE OR REPLACE FUNCTION public.get_okr_period_detail(
  p_inicio timestamptz,
  p_fim timestamptz,
  p_prev_inicio timestamptz,
  p_prev_fim timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
AS $$
DECLARE
  v_active integer := 0;
  v_previous integer := 0;
  v_retained integer := 0;
  v_new integer := 0;
  v_lost integer := 0;
  v_stores_new integer := 0;
  v_stores_prev integer := 0;
  v_cities_new integer := 0;
  v_cities_prev integer := 0;
  v_states_new integer := 0;
  v_states_prev integer := 0;
  v_login integer := 0;
  v_a11y integer := 0;
  v_became integer := 0;
  v_stores jsonb := '[]'::jsonb;
  v_cities jsonb := '[]'::jsonb;
BEGIN
  WITH people AS (
    SELECT
      COALESCE(contributor_user_id::text, app_install_id::text) AS who,
      bool_or(created_at >= p_inicio AND created_at < p_fim) AS in_cur,
      bool_or(created_at >= p_prev_inicio AND created_at < p_prev_fim) AS in_prev
    FROM public.wait_contributions
    WHERE created_at >= LEAST(p_inicio, p_prev_inicio)
      AND created_at < GREATEST(p_fim, p_prev_fim)
      AND (contributor_user_id IS NOT NULL OR app_install_id IS NOT NULL)
    GROUP BY 1
  )
  SELECT
    count(*) FILTER (WHERE in_cur),
    count(*) FILTER (WHERE in_prev),
    count(*) FILTER (WHERE in_cur AND in_prev),
    count(*) FILTER (WHERE in_cur AND NOT in_prev),
    count(*) FILTER (WHERE in_prev AND NOT in_cur)
  INTO v_active, v_previous, v_retained, v_new, v_lost
  FROM people;

  SELECT count(*)
  INTO v_stores_new
  FROM public.okr_place_first
  WHERE name_key <> ''
    AND first_at >= p_inicio
    AND first_at < p_fim;

  SELECT count(*)
  INTO v_stores_prev
  FROM public.okr_place_first
  WHERE name_key <> ''
    AND first_at >= p_prev_inicio
    AND first_at < p_prev_fim;

  SELECT count(*)
  INTO v_cities_new
  FROM (
    SELECT city_key, uf_key
    FROM public.okr_place_first
    WHERE city_key <> ''
    GROUP BY city_key, uf_key
    HAVING min(first_at) >= p_inicio AND min(first_at) < p_fim
  ) cities;

  SELECT count(*)
  INTO v_cities_prev
  FROM (
    SELECT city_key, uf_key
    FROM public.okr_place_first
    WHERE city_key <> ''
    GROUP BY city_key, uf_key
    HAVING min(first_at) >= p_prev_inicio AND min(first_at) < p_prev_fim
  ) cities;

  SELECT count(*)
  INTO v_states_new
  FROM (
    SELECT uf_key
    FROM public.okr_place_first
    WHERE uf_key <> ''
    GROUP BY uf_key
    HAVING min(first_at) >= p_inicio AND min(first_at) < p_fim
  ) states;

  SELECT count(*)
  INTO v_states_prev
  FROM (
    SELECT uf_key
    FROM public.okr_place_first
    WHERE uf_key <> ''
    GROUP BY uf_key
    HAVING min(first_at) >= p_prev_inicio AND min(first_at) < p_prev_fim
  ) states;

  WITH logins AS (
    SELECT DISTINCT ON (user_id)
      user_id::text AS user_id,
      nullif(lower(btrim(email)), '') AS email,
      coalesce(accessibility_enabled, false) AS a11y
    FROM public.delivery_profiles
    WHERE created_at >= p_inicio
      AND created_at < p_fim
      AND user_id IS NOT NULL
    ORDER BY user_id, created_at DESC
  ),
  matched AS (
    SELECT
      l.a11y,
      (
        SELECT min(src.at)
        FROM (
          SELECT (
            SELECT w.created_at
            FROM public.wait_contributions w
            WHERE w.contributor_user_id::text = l.user_id
            ORDER BY w.created_at
            LIMIT 1
          ) AS at
          UNION ALL
          SELECT (
            SELECT w.created_at
            FROM public.wait_contributions w
            WHERE l.email IS NOT NULL
              AND w.contributor_user_id IS NULL
              AND lower(btrim(w.contributor_email)) = l.email
            ORDER BY w.created_at
            LIMIT 1
          )
        ) src
      ) AS first_at
    FROM logins l
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE a11y)::integer,
    count(*) FILTER (WHERE first_at >= p_inicio AND first_at < p_fim)::integer
  INTO v_login, v_a11y, v_became
  FROM matched;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', name,
    'city', city,
    'avg_min', avg_min,
    'pickups', pickups
  ) ORDER BY avg_min DESC, pickups DESC), '[]'::jsonb)
  INTO v_stores
  FROM (
    SELECT
      (array_agg(btrim(store_name) ORDER BY created_at DESC))[1] AS name,
      coalesce((array_agg(btrim(store_city) ORDER BY created_at DESC) FILTER (WHERE nullif(btrim(store_city), '') IS NOT NULL))[1], '') AS city,
      round(avg(wait_ms)::numeric / 60000.0, 1) AS avg_min,
      count(*)::integer AS pickups
    FROM public.wait_contributions
    WHERE created_at >= p_inicio
      AND created_at < p_fim
      AND wait_ms IS NOT NULL
      AND nullif(btrim(store_name), '') IS NOT NULL
    GROUP BY lower(btrim(store_name)), lower(coalesce(btrim(store_city), ''))
    HAVING count(*) >= 5
    ORDER BY avg(wait_ms) DESC, count(*) DESC
    LIMIT 10
  ) ranked;

  WITH hits AS (
    SELECT
      COALESCE(contributor_user_id::text, app_install_id::text) AS who,
      lower(btrim(store_city)) AS city_key,
      lower(coalesce(btrim(store_uf), '')) AS uf_key,
      btrim(store_city) AS city_name,
      coalesce(nullif(btrim(store_uf), ''), '') AS uf_name,
      count(*) AS n,
      max(created_at) AS last_at
    FROM public.wait_contributions
    WHERE created_at >= p_inicio
      AND created_at < p_fim
      AND (contributor_user_id IS NOT NULL OR app_install_id IS NOT NULL)
      AND nullif(btrim(store_city), '') IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5
  ),
  best AS (
    SELECT DISTINCT ON (who) who, city_key, uf_key, city_name, uf_name
    FROM hits
    ORDER BY who, n DESC, last_at DESC
  ),
  ranked AS (
    SELECT
      (array_agg(city_name ORDER BY city_name))[1] AS name,
      (array_agg(uf_name ORDER BY uf_name DESC))[1] AS uf,
      count(*)::integer AS active
    FROM best
    GROUP BY city_key, uf_key
    ORDER BY count(*) DESC, min(city_name)
    LIMIT 5
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', name,
    'uf', uf,
    'active', active
  ) ORDER BY active DESC, name), '[]'::jsonb)
  INTO v_cities
  FROM ranked;

  RETURN jsonb_build_object(
    'active', v_active,
    'previous', v_previous,
    'retained', v_retained,
    'new', v_new,
    'lost', v_lost,
    'stores_new', v_stores_new,
    'stores_new_prev', v_stores_prev,
    'cities_new', v_cities_new,
    'cities_new_prev', v_cities_prev,
    'states_new', v_states_new,
    'states_new_prev', v_states_prev,
    'funnel', jsonb_build_object(
      'login', v_login,
      'accessibility', v_a11y,
      'active', v_became
    ),
    'top_stores', v_stores,
    'top_cities', v_cities,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.okr_place_first_apply() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_okr_period_detail(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_okr_period_detail(timestamptz, timestamptz, timestamptz, timestamptz) TO anon, authenticated;
