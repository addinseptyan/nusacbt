using System.Drawing;
using System.Drawing.Imaging;
using System.Text;

namespace NusaCBT.Server;

/// <summary>
/// Generator QR Code ISO/IEC 18004 (Byte mode, Error Correction Level M, Versi 1-10)
/// tanpa dependensi paket eksternal sehingga aman untuk build offline maupun single-file.
/// </summary>
internal static class QrCodeGenerator
{
    private readonly record struct VersionSpec(
        int Version,
        int TotalBytes,
        int DataBytes,
        int EccPerBlock,
        int Group1Blocks,
        int Group1DataBytes,
        int Group2Blocks,
        int Group2DataBytes,
        int[] AlignmentCenters);

    private static readonly VersionSpec[] VersionsM =
    [
        new(1, 26, 16, 10, 1, 16, 0, 0, []),
        new(2, 44, 28, 16, 1, 28, 0, 0, [6, 18]),
        new(3, 70, 44, 26, 1, 44, 0, 0, [6, 22]),
        new(4, 100, 64, 18, 2, 32, 0, 0, [6, 26]),
        new(5, 134, 86, 24, 2, 43, 0, 0, [6, 30]),
        new(6, 172, 108, 16, 4, 27, 0, 0, [6, 34]),
        new(7, 196, 124, 18, 4, 31, 0, 0, [6, 22, 38]),
        new(8, 242, 154, 22, 2, 38, 2, 39, [6, 24, 42]),
        new(9, 292, 182, 22, 3, 36, 2, 37, [6, 26, 46]),
        new(10, 346, 216, 26, 4, 43, 1, 44, [6, 28, 50]),
    ];

    private static readonly byte[] GfExp = new byte[512];
    private static readonly byte[] GfLog = new byte[256];

    static QrCodeGenerator()
    {
        var x = 1;
        for (var i = 0; i < 255; i++)
        {
            GfExp[i] = (byte)x;
            GfLog[x] = (byte)i;
            x <<= 1;
            if ((x & 0x100) != 0)
            {
                x ^= 0x11d;
            }
        }
        for (var i = 255; i < 512; i++)
        {
            GfExp[i] = GfExp[i - 255];
        }
    }

    public static Bitmap RenderBitmap(string text, int targetPixelSize = 240)
    {
        var matrix = Encode(text);
        var modules = matrix.GetLength(0);
        const int quietZone = 4;
        var totalModules = modules + quietZone * 2;
        var scale = Math.Max(2, targetPixelSize / totalModules);
        var pixelSize = totalModules * scale;

        var bmp = new Bitmap(pixelSize, pixelSize, PixelFormat.Format24bppRgb);
        using var g = Graphics.FromImage(bmp);
        g.Clear(Color.White);

        for (var r = 0; r < modules; r++)
        {
            for (var c = 0; c < modules; c++)
            {
                if (!matrix[r, c]) continue;
                g.FillRectangle(
                    Brushes.Black,
                    (c + quietZone) * scale,
                    (r + quietZone) * scale,
                    scale,
                    scale);
            }
        }

        return bmp;
    }

    public static bool[,] Encode(string text)
    {
        var payload = Encoding.UTF8.GetBytes(text);
        VersionSpec? chosen = null;
        foreach (var spec in VersionsM)
        {
            var countBits = spec.Version <= 9 ? 8 : 16;
            if (4 + countBits + payload.Length * 8 <= spec.DataBytes * 8)
            {
                chosen = spec;
                break;
            }
        }
        if (chosen is null)
        {
            throw new ArgumentException("Teks terlalu panjang untuk QR Code versi 1-10.", nameof(text));
        }

        var vSpec = chosen.Value;
        var charCountBits = vSpec.Version <= 9 ? 8 : 16;

        // 1. Susun bit stream mode Byte (0100)
        var bits = new List<int>(vSpec.DataBytes * 8);
        AppendBits(bits, 0b0100, 4);
        AppendBits(bits, payload.Length, charCountBits);
        foreach (var b in payload)
        {
            AppendBits(bits, b, 8);
        }

        var capacityBits = vSpec.DataBytes * 8;
        var terminator = Math.Min(4, capacityBits - bits.Count);
        AppendBits(bits, 0, terminator);
        while (bits.Count % 8 != 0)
        {
            bits.Add(0);
        }

        var dataCodewords = new List<byte>(vSpec.DataBytes);
        for (var i = 0; i < bits.Count; i += 8)
        {
            var val = 0;
            for (var j = 0; j < 8; j++)
            {
                val = (val << 1) | bits[i + j];
            }
            dataCodewords.Add((byte)val);
        }

        var padIndex = 0;
        while (dataCodewords.Count < vSpec.DataBytes)
        {
            dataCodewords.Add((padIndex++ & 1) == 0 ? (byte)0xec : (byte)0x11);
        }

        // 2. Bagi blok dan hitung Reed-Solomon ECC
        var blocks = new List<(byte[] Data, byte[] Ecc)>(vSpec.Group1Blocks + vSpec.Group2Blocks);
        var offset = 0;
        for (var i = 0; i < vSpec.Group1Blocks; i++)
        {
            var data = dataCodewords.GetRange(offset, vSpec.Group1DataBytes).ToArray();
            offset += vSpec.Group1DataBytes;
            blocks.Add((data, ComputeReedSolomon(data, vSpec.EccPerBlock)));
        }
        for (var i = 0; i < vSpec.Group2Blocks; i++)
        {
            var data = dataCodewords.GetRange(offset, vSpec.Group2DataBytes).ToArray();
            offset += vSpec.Group2DataBytes;
            blocks.Add((data, ComputeReedSolomon(data, vSpec.EccPerBlock)));
        }

        // 3. Interleave data dan ECC
        var finalCodewords = new List<byte>(vSpec.TotalBytes);
        var maxDataLen = Math.Max(vSpec.Group1DataBytes, vSpec.Group2DataBytes);
        for (var i = 0; i < maxDataLen; i++)
        {
            foreach (var blk in blocks)
            {
                if (i < blk.Data.Length) finalCodewords.Add(blk.Data[i]);
            }
        }
        for (var i = 0; i < vSpec.EccPerBlock; i++)
        {
            foreach (var blk in blocks)
            {
                finalCodewords.Add(blk.Ecc[i]);
            }
        }

        // 4. Bangun matriks dan pola fungsi tetap
        var size = 17 + 4 * vSpec.Version;
        var modules = new bool[size, size];
        var isFunction = new bool[size, size];

        void SetFunction(int r, int c, bool dark)
        {
            modules[r, c] = dark;
            isFunction[r, c] = true;
        }

        void DrawFinder(int r0, int c0)
        {
            for (var dr = -1; dr <= 7; dr++)
            {
                for (var dc = -1; dc <= 7; dc++)
                {
                    var r = r0 + dr;
                    var c = c0 + dc;
                    if (r < 0 || r >= size || c < 0 || c >= size) continue;
                    var dark = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
                               (dr == 0 || dr == 6 || dc == 0 || dc == 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
                    SetFunction(r, c, dark);
                }
            }
        }

        DrawFinder(0, 0);
        DrawFinder(0, size - 7);
        DrawFinder(size - 7, 0);

        for (var i = 8; i < size - 8; i++)
        {
            var dark = (i & 1) == 0;
            SetFunction(6, i, dark);
            SetFunction(i, 6, dark);
        }

        SetFunction(size - 8, 8, true);

        var align = vSpec.AlignmentCenters;
        for (var i = 0; i < align.Length; i++)
        {
            for (var j = 0; j < align.Length; j++)
            {
                if ((i == 0 && j == 0) ||
                    (i == 0 && j == align.Length - 1) ||
                    (i == align.Length - 1 && j == 0))
                {
                    continue;
                }
                var cr = align[i];
                var cc = align[j];
                for (var dr = -2; dr <= 2; dr++)
                {
                    for (var dc = -2; dc <= 2; dc++)
                    {
                        SetFunction(cr + dr, cc + dc, Math.Max(Math.Abs(dr), Math.Abs(dc)) != 1);
                    }
                }
            }
        }

        // Cadangkan modul format info
        for (var i = 0; i <= 8; i++)
        {
            if (i != 6)
            {
                isFunction[8, i] = true;
                isFunction[i, 8] = true;
            }
        }
        for (var i = 0; i < 8; i++)
        {
            isFunction[8, size - 1 - i] = true;
            if (i < 7) isFunction[size - 1 - i, 8] = true;
        }

        // Info versi untuk versi >= 7 (BCH 18,6)
        if (vSpec.Version >= 7)
        {
            var rem = vSpec.Version << 12;
            for (var bit = 17; bit >= 12; bit--)
            {
                if (((rem >> bit) & 1) != 0) rem ^= 0x1f25 << (bit - 12);
            }
            var vBits = (vSpec.Version << 12) | rem;
            for (var i = 0; i < 18; i++)
            {
                var dark = ((vBits >> i) & 1) != 0;
                var a = i / 3;
                var b = size - 11 + (i % 3);
                SetFunction(a, b, dark);
                SetFunction(b, a, dark);
            }
        }

        // 5. Tempatkan bit data secara zig-zag
        var bitStream = new int[finalCodewords.Count * 8];
        for (var i = 0; i < finalCodewords.Count; i++)
        {
            var cw = finalCodewords[i];
            for (var b = 0; b < 8; b++)
            {
                bitStream[i * 8 + b] = (cw >> (7 - b)) & 1;
            }
        }

        var bitIdx = 0;
        var upward = true;
        for (var right = size - 1; right >= 1; right -= 2)
        {
            if (right == 6) right = 5;
            for (var vert = 0; vert < size; vert++)
            {
                var r = upward ? size - 1 - vert : vert;
                for (var j = 0; j < 2; j++)
                {
                    var c = right - j;
                    if (isFunction[r, c]) continue;
                    modules[r, c] = bitIdx < bitStream.Length && bitStream[bitIdx] == 1;
                    bitIdx++;
                }
            }
            upward = !upward;
        }

        // 6. Evaluasi 8 pola mask dan pilih penalti terendah
        var bestPenalty = int.MaxValue;
        var bestGrid = modules;

        for (var mask = 0; mask < 8; mask++)
        {
            var candidate = new bool[size, size];
            for (var r = 0; r < size; r++)
            {
                for (var c = 0; c < size; c++)
                {
                    candidate[r, c] = isFunction[r, c]
                        ? modules[r, c]
                        : modules[r, c] ^ IsMasked(mask, r, c);
                }
            }

            ApplyFormatInfo(candidate, size, mask);
            var penalty = ComputePenalty(candidate, size);
            if (penalty < bestPenalty)
            {
                bestPenalty = penalty;
                bestGrid = candidate;
            }
        }

        return bestGrid;
    }

    private static void AppendBits(List<int> bits, int value, int count)
    {
        for (var i = count - 1; i >= 0; i--)
        {
            bits.Add((value >> i) & 1);
        }
    }

    private static byte GfMul(byte a, byte b) =>
        a == 0 || b == 0 ? (byte)0 : GfExp[GfLog[a] + GfLog[b]];

    private static byte[] ComputeReedSolomon(byte[] data, int eccLen)
    {
        var gen = new byte[eccLen + 1];
        gen[0] = 1;
        var genLen = 1;
        for (var i = 0; i < eccLen; i++)
        {
            var root = GfExp[i];
            for (var j = genLen; j >= 1; j--)
            {
                gen[j] = (byte)(gen[j] ^ GfMul(gen[j - 1], root));
            }
            genLen++;
        }

        var rem = new byte[eccLen];
        foreach (var b in data)
        {
            var factor = (byte)(b ^ rem[0]);
            for (var i = 0; i < eccLen - 1; i++)
            {
                rem[i] = rem[i + 1];
            }
            rem[eccLen - 1] = 0;
            if (factor != 0)
            {
                for (var i = 0; i < eccLen; i++)
                {
                    rem[i] ^= GfMul(gen[i + 1], factor);
                }
            }
        }
        return rem;
    }

    private static bool IsMasked(int mask, int r, int c) => mask switch
    {
        0 => ((r + c) & 1) == 0,
        1 => (r & 1) == 0,
        2 => c % 3 == 0,
        3 => (r + c) % 3 == 0,
        4 => ((r >> 1) + c / 3) % 2 == 0,
        5 => (r * c % 2) + (r * c % 3) == 0,
        6 => ((r * c % 2) + (r * c % 3)) % 2 == 0,
        7 => ((r + c) % 2 + (r * c % 3)) % 2 == 0,
        _ => false,
    };

    private static void ApplyFormatInfo(bool[,] grid, int size, int mask)
    {
        // EC Level M = 00
        var data = mask;
        var rem = data << 10;
        for (var bit = 14; bit >= 10; bit--)
        {
            if (((rem >> bit) & 1) != 0) rem ^= 0x537 << (bit - 10);
        }
        var fBits = ((data << 10) | rem) ^ 0x5412;

        // Salinan 1 (kiri-atas) mengikuti ISO/IEC 18004 Gambar 25: bit 0 di (0,8) .. bit 14 di (8,0)
        for (var k = 0; k <= 5; k++) grid[k, 8] = ((fBits >> k) & 1) != 0;
        grid[7, 8] = ((fBits >> 6) & 1) != 0;
        grid[8, 8] = ((fBits >> 7) & 1) != 0;
        grid[8, 7] = ((fBits >> 8) & 1) != 0;
        for (var k = 9; k < 15; k++) grid[8, 14 - k] = ((fBits >> k) & 1) != 0;

        // Salinan 2 (kanan-atas & kiri-bawah): bit 0..7 di baris 8 kanan .. bit 8..14 di kolom 8 bawah
        for (var k = 0; k < 8; k++) grid[8, size - 1 - k] = ((fBits >> k) & 1) != 0;
        for (var k = 8; k < 15; k++) grid[size - 15 + k, 8] = ((fBits >> k) & 1) != 0;
    }

    private static int ComputePenalty(bool[,] grid, int size)
    {
        var penalty = 0;

        // Aturan 1: 5+ modul berurutan berwarna sama per baris & kolom
        for (var r = 0; r < size; r++)
        {
            var run = 1;
            for (var c = 1; c < size; c++)
            {
                if (grid[r, c] == grid[r, c - 1])
                {
                    run++;
                    if (run == 5) penalty += 3;
                    else if (run > 5) penalty++;
                }
                else run = 1;
            }
        }
        for (var c = 0; c < size; c++)
        {
            var run = 1;
            for (var r = 1; r < size; r++)
            {
                if (grid[r, c] == grid[r - 1, c])
                {
                    run++;
                    if (run == 5) penalty += 3;
                    else if (run > 5) penalty++;
                }
                else run = 1;
            }
        }

        // Aturan 2: Blok 2x2 berwarna sama
        for (var r = 0; r < size - 1; r++)
        {
            for (var c = 0; c < size - 1; c++)
            {
                var v = grid[r, c];
                if (v == grid[r, c + 1] && v == grid[r + 1, c] && v == grid[r + 1, c + 1])
                {
                    penalty += 3;
                }
            }
        }

        // Aturan 3: Pola mirip finder 1:1:3:1:1 dengan 4 modul terang
        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c <= size - 11; c++)
            {
                if (MatchesFinderLikeRow(grid, r, c)) penalty += 40;
            }
        }
        for (var c = 0; c < size; c++)
        {
            for (var r = 0; r <= size - 11; r++)
            {
                if (MatchesFinderLikeCol(grid, r, c)) penalty += 40;
            }
        }

        // Aturan 4: Keseimbangan modul gelap terhadap 50%
        var darkCount = 0;
        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c < size; c++)
            {
                if (grid[r, c]) darkCount++;
            }
        }
        var pct = (darkCount * 100) / (size * size);
        penalty += (Math.Abs(pct - 50) / 5) * 10;

        return penalty;
    }

    private static bool MatchesFinderLikeRow(bool[,] g, int r, int c) =>
        (g[r, c] && !g[r, c + 1] && g[r, c + 2] && g[r, c + 3] && g[r, c + 4] && !g[r, c + 5] && g[r, c + 6] && !g[r, c + 7] && !g[r, c + 8] && !g[r, c + 9] && !g[r, c + 10]) ||
        (!g[r, c] && !g[r, c + 1] && !g[r, c + 2] && !g[r, c + 3] && g[r, c + 4] && !g[r, c + 5] && g[r, c + 6] && g[r, c + 7] && g[r, c + 8] && !g[r, c + 9] && g[r, c + 10]);

    private static bool MatchesFinderLikeCol(bool[,] g, int r, int c) =>
        (g[r, c] && !g[r + 1, c] && g[r + 2, c] && g[r + 3, c] && g[r + 4, c] && !g[r + 5, c] && g[r + 6, c] && !g[r + 7, c] && !g[r + 8, c] && !g[r + 9, c] && !g[r + 10, c]) ||
        (!g[r, c] && !g[r + 1, c] && !g[r + 2, c] && !g[r + 3, c] && g[r + 4, c] && !g[r + 5, c] && g[r + 6, c] && g[r + 7, c] && g[r + 8, c] && !g[r + 9, c] && g[r + 10, c]);
}
