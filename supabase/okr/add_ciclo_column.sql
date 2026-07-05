-- Projeto OKR | 1 ano em 12 semanas
-- Execute no SQL Editor do projeto do dashboard OKR (sbywtjxgkhqdeplymhdz)

ALTER TABLE okr_ciclo ADD COLUMN IF NOT EXISTS ciclo integer NOT NULL DEFAULT 2;

UPDATE okr_ciclo SET ciclo = 2 WHERE ciclo IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'okr_ciclo_ciclo_semana_key'
  ) THEN
    ALTER TABLE okr_ciclo ADD CONSTRAINT okr_ciclo_ciclo_semana_key UNIQUE (ciclo, semana);
  END IF;
END $$;
