-- Soal lama tetap memakai teks/gambar yang ada; NULL berarti belum memiliki struktur rich text.
-- Isi baru divalidasi dan dibangun ulang oleh aplikasi sebelum disimpan sebagai JSONB.
ALTER TABLE question_bank
  ADD COLUMN prompt_rich jsonb,
  ADD COLUMN option_a_rich jsonb,
  ADD COLUMN option_b_rich jsonb,
  ADD COLUMN option_c_rich jsonb,
  ADD COLUMN option_d_rich jsonb,
  ADD COLUMN option_e_rich jsonb,
  ADD CONSTRAINT question_bank_prompt_rich_check CHECK (prompt_rich IS NULL OR (jsonb_typeof(prompt_rich) = 'object' AND octet_length(prompt_rich::text) <= 512000)),
  ADD CONSTRAINT question_bank_option_a_rich_check CHECK (option_a_rich IS NULL OR (jsonb_typeof(option_a_rich) = 'object' AND octet_length(option_a_rich::text) <= 512000)),
  ADD CONSTRAINT question_bank_option_b_rich_check CHECK (option_b_rich IS NULL OR (jsonb_typeof(option_b_rich) = 'object' AND octet_length(option_b_rich::text) <= 512000)),
  ADD CONSTRAINT question_bank_option_c_rich_check CHECK (option_c_rich IS NULL OR (jsonb_typeof(option_c_rich) = 'object' AND octet_length(option_c_rich::text) <= 512000)),
  ADD CONSTRAINT question_bank_option_d_rich_check CHECK (option_d_rich IS NULL OR (jsonb_typeof(option_d_rich) = 'object' AND octet_length(option_d_rich::text) <= 512000)),
  ADD CONSTRAINT question_bank_option_e_rich_check CHECK (option_e_rich IS NULL OR (jsonb_typeof(option_e_rich) = 'object' AND octet_length(option_e_rich::text) <= 512000));
