-- Pembukaan penguncian login oleh admin dicatat bersama tindakan sandi yang
-- sudah ada. Data, sandi, pengikat kunci, sesi, dan pembatas login tidak diubah.
ALTER TABLE participant_password_audit DROP CONSTRAINT participant_password_audit_event_check;
ALTER TABLE participant_password_audit ADD CONSTRAINT participant_password_audit_event_check
  CHECK (event IN ('create_manual', 'create_auto', 'reset_manual', 'reset_auto', 'reveal', 'unlock_login'));
