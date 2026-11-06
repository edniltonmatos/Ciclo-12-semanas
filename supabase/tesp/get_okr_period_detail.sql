-- TESP | Tempo de espera SP
-- Detalhe de um período do painel: coorte, funil, cobertura e rankings.
-- Lê wait_contributions e delivery_profiles. Não cria tabela.

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

  WITH first_store AS (
    SELECT min(created_at) AS first_at
    FROM public.wait_contributions
    WHERE nullif(btrim(store_name), '') IS NOT NULL
    GROUP BY lower(btrim(store_name)),
             lower(coalesce(btrim(store_city), '')),
             lower(coalesce(btrim(store_uf), ''))
  )
  SELECT
    count(*) FILTER (WHERE first_at >= p_inicio AND first_at < p_fim),
    count(*) FILTER (WHERE first_at >= p_prev_inicio AND first_at < p_prev_fim)
  INTO v_stores_new, v_stores_prev
  FROM first_store;

  WITH first_city AS (
    SELECT min(created_at) AS first_at
    FROM public.wait_contributions
    WHERE nullif(btrim(store_city), '') IS NOT NULL
    GROUP BY lower(btrim(store_city)), lower(coalesce(btrim(store_uf), ''))
  )
  SELECT
    count(*) FILTER (WHERE first_at >= p_inicio AND first_at < p_fim),
    count(*) FILTER (WHERE first_at >= p_prev_inicio AND first_at < p_prev_fim)
  INTO v_cities_new, v_cities_prev
  FROM first_city;

  WITH first_state AS (
    SELECT min(created_at) AS first_at
    FROM public.wait_contributions
    WHERE nullif(btrim(store_uf), '') IS NOT NULL
    GROUP BY lower(btrim(store_uf))
  )
  SELECT
    count(*) FILTER (WHERE first_at >= p_inicio AND first_at < p_fim),
    count(*) FILTER (WHERE first_at >= p_prev_inicio AND first_at < p_prev_fim)
  INTO v_states_new, v_states_prev
  FROM first_state;

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
  first_by_user AS (
    SELECT contributor_user_id::text AS user_id, min(created_at) AS first_at
    FROM public.wait_contributions
    WHERE contributor_user_id IS NOT NULL
    GROUP BY 1
  ),
  first_by_email AS (
    SELECT lower(btrim(contributor_email)) AS email, min(created_at) AS first_at
    FROM public.wait_contributions
    WHERE contributor_user_id IS NULL
      AND nullif(btrim(contributor_email), '') IS NOT NULL
    GROUP BY 1
  ),
  matched AS (
    SELECT
      l.a11y,
      (
        SELECT min(src.first_at)
        FROM (
          SELECT f.first_at FROM first_by_user f WHERE f.user_id = l.user_id
          UNION ALL
          SELECT f.first_at FROM first_by_email f WHERE l.email IS NOT NULL AND f.email = l.email
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

REVOKE ALL ON FUNCTION public.get_okr_period_detail(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_okr_period_detail(timestamptz, timestamptz, timestamptz, timestamptz) TO anon, authenticated;
