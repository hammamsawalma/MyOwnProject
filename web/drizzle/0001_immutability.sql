-- Issued documents are immutable; corrections are made with a reversing document
-- (credit note). The only permitted update is attaching the rendered PDF once.
CREATE OR REPLACE FUNCTION documents_guard_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document % is immutable and cannot be deleted; issue a reversing document', OLD.ref
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['pdf_key', 'pdf_sha256']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['pdf_key', 'pdf_sha256']) THEN
    RAISE EXCEPTION 'document % is immutable', OLD.ref USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.pdf_key IS NOT NULL AND NEW.pdf_key IS DISTINCT FROM OLD.pdf_key)
     OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION 'document % already has a PDF attached', OLD.ref USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_immutable
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_guard_immutable();
--> statement-breakpoint

-- Once a quote leaves draft its content is frozen: only the status and the
-- acceptance record may change. Changes need a new quote version.
CREATE OR REPLACE FUNCTION quotes_guard_issued() RETURNS trigger AS $$
DECLARE
  mutable_cols text[] := ARRAY['status', 'accepted_at', 'accepted_ip', 'accepted_user_agent', 'accepted_terms_version', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'quote % has been issued and cannot be deleted', OLD.ref USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'draft' THEN
    RAISE EXCEPTION 'quote % cannot return to draft', OLD.ref USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(OLD) - mutable_cols) IS DISTINCT FROM (to_jsonb(NEW) - mutable_cols) THEN
    RAISE EXCEPTION 'quote % is issued and immutable; create a new version', OLD.ref USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.accepted_at IS NOT NULL AND (
       NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.accepted_ip IS DISTINCT FROM OLD.accepted_ip
    OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent
    OR NEW.accepted_terms_version IS DISTINCT FROM OLD.accepted_terms_version) THEN
    RAISE EXCEPTION 'acceptance record of quote % is immutable', OLD.ref USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quotes_issued_immutable
  BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION quotes_guard_issued();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION quote_line_items_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO parent_status FROM quotes WHERE id = OLD.quote_id;
    IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
      RAISE EXCEPTION 'line items of an issued quote are immutable' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO parent_status FROM quotes WHERE id = NEW.quote_id;
    IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
      RAISE EXCEPTION 'line items of an issued quote are immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER quote_line_items_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON quote_line_items
  FOR EACH ROW EXECUTE FUNCTION quote_line_items_guard();
--> statement-breakpoint

INSERT INTO settings (key, value) VALUES ('document_mode', '"receipt"'::jsonb)
  ON CONFLICT (key) DO NOTHING;
