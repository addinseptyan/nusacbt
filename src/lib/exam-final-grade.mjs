// Hitung menggunakan rasional eksak dari jumlah benar/jumlah soal setiap
// pengerjaan. Nilai satu pengerjaan yang sudah dibulatkan tidak dijadikan input.
// BigInt juga menghindari perubahan hasil pada batas pembulatan seperti 1,005.
export function calculateFinalGrade(method, attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0 || !['highest', 'average'].includes(method)) return null;

  let numerator = 0n;
  let denominator = 1n;
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== 'object') return null;
    const correct = attempt.correctCount;
    const total = attempt.questionCount;
    if (!Number.isSafeInteger(correct) || !Number.isSafeInteger(total) || total <= 0 || total > 1000 || correct < 0 || correct > total) return null;
    const n = BigInt(correct);
    const d = BigInt(total);
    if (method === 'highest') {
      if (n * denominator > numerator * d) { numerator = n; denominator = d; }
    } else {
      const common = gcd(denominator, d);
      numerator = numerator * (d / common) + n * (denominator / common);
      denominator = denominator * (d / common);
      const reduction = gcd(numerator, denominator);
      numerator /= reduction;
      denominator /= reduction;
    }
  }
  if (method === 'average') denominator *= BigInt(attempts.length);

  // 100 nilai per jawaban sempurna dan 100 untuk dua digit desimal.
  // Angka nonnegatif tepat di setengah sen dibulatkan naik.
  const scaled = numerator * 10000n;
  const hundredths = (scaled * 2n + denominator) / (denominator * 2n);
  return Number(hundredths) / 100;
}

function gcd(a, b) {
  while (b !== 0n) { const r = a % b; a = b; b = r; }
  return a;
}

export function formatFinalGrade(score) {
  return score.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
