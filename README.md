# Sistem Ujian Olimpiade Annur

Sistem ujian berbasis web modern yang dioptimalkan untuk memproses soal olimpiade langsung dari dokumen Microsoft Word (.docx). Data disimpan secara lokal di dalam browser menggunakan basis data **IndexedDB**, sehingga tidak membutuhkan setup server database terpisah.

## Cara Menjalankan

1. Cukup buka berkas [index.html](index.html) di browser modern (Chrome, Edge, Firefox, dll) untuk membuka halaman ujian siswa.
2. Untuk membuka halaman admin (unggah soal & melihat nilai), klik tautan **Halaman Admin** di pojok kanan atas halaman siswa atau buka berkas [admin.html](admin.html) secara langsung.

## Format File Soal Word (.docx)

Agar sistem dapat membaca soal dan kunci jawaban dengan benar, buat file Word Anda dengan format berikut:

1. **Setiap Soal**: Ketik soal langsung di satu paragraf (bisa dengan nomor maupun tidak).
2. **Pilihan Ganda (Opsional)**: Ketik pilihan jawaban dengan awalan `A.`, `B.`, `C.`, `D.`, atau `E.` (bisa berupa baris baru atau dalam satu baris yang sama). Jika tidak ada format pilihan ini, sistem akan otomatis menjadikannya soal **esai / isian bebas**.
3. **Kunci Jawaban**: Baris jawaban harus diawali dengan kata `Jawaban:` tepat setelah pertanyaan/pilihan ganda yang bersangkutan.

### Contoh Format Dokumen Word:
```text
1. Siapakah pendiri sekolah Annur?
A. Ahmad Hidayat
B. Muhammad Yusuf
C. Budi Utomo
D. Joko Anwar
Jawaban: B

2. Apa ibukota negara Indonesia saat ini?
Jawaban: Jakarta

3. Hasil dari 5 + 5 * 2 adalah...
A. 20
B. 15
C. 25
D. 10
Jawaban: B
```

## Fitur Utama

- **Basis Data Lokal**: Soal, kunci jawaban, dan seluruh hasil pengerjaan siswa disimpan secara persisten di browser menggunakan **IndexedDB**.
- **Pemeriksaan Otomatis**: Hasil jawaban pilihan ganda akan langsung dikoreksi secara otomatis.
- **Ekspor Nilai**: Admin dapat mengunduh daftar lengkap pengerjaan peserta ujian beserta tanggal dan detail jawabannya dalam format berkas **CSV** (Excel).
- **Desain Modern Premium**: Dilengkapi tema gelap transparan (glassmorphism) yang responsif dan nyaman di mata peserta ujian.
