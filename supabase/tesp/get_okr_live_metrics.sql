-- TESP | Tempo de espera SP
-- Apenas a função RPC — usa a tabela existente wait_contributions (sem criar tabelas)

CREATE OR REPLACE FUNCTION public.get_okr_live_metrics(
  p_inicio timestamptz DEFAULT (now() - interval '7 days'),
  p_fim timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  wau_val integer;
  tempo_val numeric;
BEGIN
  -- WAU: contribuidores distintos com ≥1 registro em wait_contributions no período
  SELECT COUNT(DISTINCT COALESCE(contributor_user_id::text, app_install_id::text))
    INTO wau_val
  FROM public.wait_contributions
  WHERE created_at >= p_inicio
    AND created_at < p_fim
    AND COALESCE(contributor_user_id, app_install_id) IS NOT NULL;

  -- Tempo médio de espera (wait_ms → minutos)
  SELECT ROUND(AVG(wait_ms)::numeric / 60000.0, 2)
    INTO tempo_val
  FROM public.wait_contributions
  WHERE created_at >= p_inicio
    AND created_at < p_fim
    AND wait_ms IS NOT NULL;

  RETURN jsonb_build_object(
    'wau', COALESCE(wau_val, 0),
    'tempo_medio', tempo_val,
    'inicio', p_inicio,
    'fim', p_fim,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_okr_live_metrics(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_okr_live_metrics(timestamptz, timestamptz) TO anon, authenticated;

-- Teste: SELECT public.get_okr_live_metrics();
