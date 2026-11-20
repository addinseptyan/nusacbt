-- Perubahan hanya memperluas batas ciphertext; hash, ciphertext, audit, dan
-- binding kunci yang sudah ada tidak diubah. AES-GCM menghasilkan ciphertext
-- sepanjang byte plaintext, sehingga sandi baru delapan huruf memerlukan 8 byte.
ALTER TABLE participant_passwords DROP CONSTRAINT participant_passwords_ciphertext_check;
ALTER TABLE participant_passwords ADD CONSTRAINT participant_passwords_ciphertext_check
  CHECK (octet_length(ciphertext) BETWEEN 8 AND 512);

-- Tepat satu baris pengaturan, tanpa memilih periode secara otomatis saat
-- upgrade. NULL berarti login peserta belum diaktifkan oleh admin.
CREATE TABLE participant_login_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  period_id bigint REFERENCES exam_periods(id) ON DELETE RESTRICT
);
INSERT INTO participant_login_settings (id, period_id) VALUES (1, NULL);
