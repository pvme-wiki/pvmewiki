-- Operator-only additive migration. Existing jobs retain their private target.
ALTER TABLE publication_jobs ADD COLUMN target jsonb NOT NULL DEFAULT '{"mode":"private"}'::jsonb;
ALTER TABLE publication_jobs ADD CONSTRAINT publication_target_shape CHECK ((
 target = '{"mode":"private"}'::jsonb OR (
  target->>'mode' = 'public' AND jsonb_typeof(target)='object' AND
  target ?& ARRAY['mode','repository','baseBranch','installationId'] AND
  (target - ARRAY['mode','repository','baseBranch','installationId']) = '{}'::jsonb AND
  jsonb_typeof(target->'repository')='string' AND jsonb_typeof(target->'baseBranch')='string' AND jsonb_typeof(target->'installationId')='string' AND
  target->>'repository' ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]*/[a-zA-Z0-9][a-zA-Z0-9_.-]*$' AND
  target->>'baseBranch' ~ '^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,150}$' AND
  target->>'installationId' ~ '^[0-9]+$')) IS TRUE);
CREATE FUNCTION preserve_publication_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target IS DISTINCT FROM OLD.target THEN RAISE EXCEPTION 'Publication targets are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_target_immutable BEFORE UPDATE ON publication_jobs FOR EACH ROW EXECUTE FUNCTION preserve_publication_target();
CREATE TABLE public_publications (
 proof_key text PRIMARY KEY CHECK (proof_key ~ '^[a-f0-9]{64}$'),
 submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id),
 repository text NOT NULL, base_branch text NOT NULL, installation_id text NOT NULL,
 proof jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER public_publications_immutable BEFORE UPDATE OR DELETE ON public_publications FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
INSERT INTO schema_migrations(version) VALUES(2);
