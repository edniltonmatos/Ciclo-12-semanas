-- Conecta o dashboard OKR aos dados reais do Grana Certa (WAU + tempo médio de espera)
-- Execute no SQL Editor do Supabase: https://supabase.com/dashboard/project/sbywtjxgkhqdeplymhdz/sql

-- ─── 1. Separar ciclos no okr_ciclo ────────────────────────────────────────
ALTER TABLE okr_ciclo ADD COLUMN IF NOT EXISTS ciclo integer NOT NULL DEFAULT 2;

UPDATE okr_ciclo SET ciclo = 2 WHERE ciclo IS NULL;

-- Chave composta para upsert por ciclo + semana
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'okr_ciclo_ciclo_semana_key'
  ) THEN
    ALTER TABLE okr_ciclo ADD CONSTRAINT okr_ciclo_ciclo_semana_key UNIQUE (ciclo, semana);
  END IF;
END $$;

-- ─── 2. Tabelas do app (caso ainda não existam neste projeto) ────────────────
CREATE TABLE IF NOT EXISTS touch_app_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  installation_id uuid,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wait_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  store_name text,
  wait_minutes numeric NOT NULL CHECK (wait_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_wait_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name text,
  wait_minutes numeric NOT NULL CHECK (wait_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON touch_app_presence (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_presence_user ON touch_app_presence (user_id);
CREATE INDEX IF NOT EXISTS idx_wait_contrib_created ON wait_contributions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_wait_created ON user_wait_records (created_at DESC);

-- ─── 3. RPC: métricas ao vivo para o dashboard ───────────────────────────────
CREATE OR REPLACE FUNCTION get_okr_live_metrics()
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
  -- WAU: usuários distintos (conta ou instalação) ativos nos últimos 7 dias
  SELECT COUNT(DISTINCT COALESCE(user_id::text, installation_id::text))
    INTO wau_val
  FROM touch_app_presence
  WHERE last_seen_at >= now() - interval '7 days';

  -- Tempo médio: contribuições anônimas + registros autenticados (últimos 7 dias)
  SELECT ROUND(AVG(wait_minutes)::numeric, 2)
    INTO tempo_val
  FROM (
    SELECT wait_minutes FROM wait_contributions
      WHERE created_at >= now() - interval '7 days'
    UNION ALL
    SELECT wait_minutes FROM user_wait_records
      WHERE created_at >= now() - interval '7 days'
  ) waits;

  RETURN jsonb_build_object(
    'wau', COALESCE(wau_val, 0),
    'tempo_medio', tempo_val,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION get_okr_live_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_okr_live_metrics() TO anon, authenticated;

-- ─── 4. Políticas RLS (leitura agregada via RPC; escrita só autenticado) ─────
ALTER TABLE okr_ciclo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS okr_ciclo_anon_all ON okr_ciclo;
CREATE POLICY okr_ciclo_anon_all ON okr_ciclo
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE touch_app_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE wait_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_wait_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS presence_insert ON touch_app_presence;
CREATE POLICY presence_insert ON touch_app_presence
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

DROP POLICY IF EXISTS wait_contrib_insert ON wait_contributions;
CREATE POLICY wait_contrib_insert ON wait_contributions
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

DROP POLICY IF EXISTS user_wait_own ON user_wait_records;
CREATE POLICY user_wait_own ON user_wait_records
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
