-- TESP | Tempo de espera SP
-- Execute no SQL Editor do projeto TESP (NÃO no projeto "1 ano em 12 semanas")
--
-- Antes de rodar: confira os nomes das colunas da tabela `registros` em
-- Table Editor → registros. Ajuste os nomes abaixo se forem diferentes.

-- ─── RPC: métricas para o dashboard OKR ──────────────────────────────────────
-- WAU       = usuários distintos com ≥1 registro no período
-- Tempo méd = média de tempo de espera dos registros no período

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
  -- Usuário = quem tem user_id (conta) OU installation_id (instalação anônima)
  SELECT COUNT(DISTINCT COALESCE(user_id::text, installation_id::text))
    INTO wau_val
  FROM public.registros
  WHERE created_at >= p_inicio
    AND created_at < p_fim
    AND COALESCE(user_id, installation_id) IS NOT NULL;

  -- Tempo médio de espera (ajuste "tempo_espera" se a coluna tiver outro nome)
  SELECT ROUND(AVG(tempo_espera)::numeric, 2)
    INTO tempo_val
  FROM public.registros
  WHERE created_at >= p_inicio
    AND created_at < p_fim
    AND tempo_espera IS NOT NULL;

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

-- ─── Teste rápido (últimos 7 dias) ───────────────────────────────────────────
-- SELECT public.get_okr_live_metrics();
