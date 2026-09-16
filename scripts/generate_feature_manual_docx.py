import os
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    """Set background color of a table cell."""
    tcPr = cell._element.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=120, bottom=120, left=150, right=150):
    """Set internal padding for table cell."""
    tcPr = cell._element.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def create_feature_guide_document():
    doc = Document()

    # Set Standard Page Margins (1 inch)
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    # Base Colors
    COLOR_PLN_BLUE = RGBColor(0, 162, 232)
    COLOR_PLN_NAVY = RGBColor(11, 60, 93)
    COLOR_MUTED = RGBColor(100, 116, 139)
    COLOR_TEXT = RGBColor(30, 41, 59)
    COLOR_EMERALD = RGBColor(16, 185, 129)

    # Image Paths
    img_full_dash = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789565778690.png"
    img_launchers = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789564192061.png"
    img_chat_bar = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789564197508.png"
    img_modul_dropdown = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789564205012.png"
    img_sidebar = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789564212097.png"
    img_audit_panel = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789564355429.png"
    img_resume_panel = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789564366084.png"

    # ---------------------------------------------------------
    # 1. COVER / HEADER SECTION
    # ---------------------------------------------------------
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(10)
    title_p.paragraph_format.space_after = Pt(4)
    run_sub_top = title_p.add_run("PT PLN INDONESIA POWER RENEWABLES\n")
    run_sub_top.font.name = "Arial"
    run_sub_top.font.size = Pt(12)
    run_sub_top.font.bold = True
    run_sub_top.font.color.rgb = COLOR_PLN_BLUE

    run_title = title_p.add_run("BUKU PANDUAN PENGGUNA & KATALOG FITUR LENGKAP")
    run_title.font.name = "Arial"
    run_title.font.size = Pt(22)
    run_title.font.bold = True
    run_title.font.color.rgb = COLOR_PLN_NAVY

    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(20)
    run_sub = sub_p.add_run("Dokumentasi Visual Antarmuka, Modul Operasional, Panel Audit Risiko, dan Panel Resume Rapat Pintar Platform Renewables AI (Versi 1.0)")
    run_sub.font.name = "Arial"
    run_sub.font.size = Pt(11)
    run_sub.font.italic = True
    run_sub.font.color.rgb = COLOR_MUTED

    # Meta Table (Doc Info)
    meta_table = doc.add_table(rows=4, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_data = [
        ("Nama Aplikasi", "Renewables AI Platform - PLN IP Renewables (Versi 1.0)"),
        ("Sasaran Pengguna", "Direksi, Manajemen, Analis Finansial, Engineer EBT, Legal & Sekretariat PLN"),
        ("Tujuan Panduan", "Menjelaskan seluruh fitur, modul antarmuka, alur upload, dan panel audit/resume"),
        ("Status Keamanan", "Data Privacy Shield: AKTIF (Sensor PII, Air-Gapped, & Local Vector Store)")
    ]
    for i, (k, v) in enumerate(meta_data):
        cell_k = meta_table.cell(i, 0)
        cell_v = meta_table.cell(i, 1)
        cell_k.text = k
        cell_v.text = v
        set_cell_background(cell_k, "0B3C5D")
        set_cell_background(cell_v, "F1F5F9")
        set_cell_margins(cell_k, 100, 100, 150, 150)
        set_cell_margins(cell_v, 100, 100, 150, 150)
        cell_k.paragraphs[0].runs[0].font.bold = True
        cell_k.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        cell_k.paragraphs[0].runs[0].font.size = Pt(10)
        cell_v.paragraphs[0].runs[0].font.size = Pt(10)
        cell_v.paragraphs[0].runs[0].font.color.rgb = COLOR_TEXT

    doc.add_paragraph().paragraph_format.space_after = Pt(16)

    # ---------------------------------------------------------
    # 2. BAB 1: OVERVIEW TAMPILAN UTAMA DASHBOARD
    # ---------------------------------------------------------
    h1 = doc.add_heading("1. Tampilan Utama & Antarmuka Dashboard (Overview)", level=1)
    h1.paragraph_format.space_before = Pt(18)
    h1.paragraph_format.space_after = Pt(8)
    h1.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p_dash_intro = doc.add_paragraph()
    p_dash_intro.paragraph_format.line_spacing = 1.2
    p_dash_intro.add_run(
        "Platform Renewables AI dirancang dengan antarmuka yang modern, elegan, dan intuitif. Tampilan awal langsung memberikan akses cepat ke seluruh kapabilitas analisis data EBT, query database proyek, komparasi kontrak, audit risiko, serta resume rapat cerdas."
    )

    # Embed Image 1: Full Panoramic Dashboard
    if os.path.exists(img_full_dash):
        p_img1 = doc.add_paragraph()
        p_img1.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img1.paragraph_format.space_before = Pt(8)
        p_img1.paragraph_format.space_after = Pt(4)
        run_img1 = p_img1.add_run()
        run_img1.add_picture(img_full_dash, width=Inches(6.4))

        p_cap1 = doc.add_paragraph()
        p_cap1.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap1.paragraph_format.space_after = Pt(14)
        r_cap1 = p_cap1.add_run("Gambar 1: Tampilan Dashboard Utama Platform Renewables AI PT PLN Indonesia Power Renewables")
        r_cap1.font.size = Pt(9)
        r_cap1.font.italic = True
        r_cap1.font.color.rgb = COLOR_MUTED

    p_elem_intro = doc.add_paragraph()
    p_elem_intro.add_run("Komponen Navigasi Utama pada Gambar 1:\n").font.bold = True
    dash_elements = [
        ("Header Atas:", "Menampilkan logo resmi PLN IP Renewables (AI ASSISTANT Versi 1.0), Pemilih Modul Cepat, Indikator [🛡️ Privacy Shield: AKTIF], Status Koneksi AI (Gemini / Private On-Premise), dan Tombol Reset."),
        ("Sidebar Kiri:", "Pusat navigasi untuk Sesi Percakapan Baru, Riwayat Obrolan Lengkap, Widget Kuota Token, dan Profil Pengguna (Tim Divisi EBT)."),
        ("Area Tengah (Main Canvas):", "Menampilkan ucapan selamat datang, deskripsi sistem, dan 5 Kartu Launcher Cepat (Quick Action Cards)."),
        ("Panel Input Bawah:", "Kolom chat cerdas interaktif yang dilengkapi tombol lampiran file langsung (📎) dan input suara mic (🎙️).")
    ]
    for d_title, d_desc in dash_elements:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {d_title} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(d_desc)

    # ---------------------------------------------------------
    # 3. BAB 2: SIDEBAR NAVIGASI, RIWAYAT PERCAKAPAN & TATA KELOLA TOKEN
    # ---------------------------------------------------------
    doc.add_page_break()
    h2 = doc.add_heading("2. Navigasi Sidebar, Riwayat Percakapan & Tata Kelola Token", level=1)
    h2.paragraph_format.space_before = Pt(18)
    h2.paragraph_format.space_after = Pt(8)
    h2.runs[0].font.color.rgb = COLOR_PLN_NAVY

    sidebar_features = [
        ("Tombol '+ Percakapan Baru':", "Membuat sesi obrolan baru yang bersih untuk memulai topik analisis baru tanpa tercampur dengan riwayat sebelumnya."),
        ("Daftar 'RIWAYAT PERCAKAPAN':", "Menyimpan seluruh sesi tanya jawab, resume rapat, dan komparasi kontrak sebelumnya secara permanen. Pengguna dapat mengeklik judul riwayat kapan saja untuk melanjutkan obrolan."),
        ("Widget 'PENGGUNAAN TOKEN':", "Menampilkan jumlah token yang telah terpakai secara real-time (misal: 15.703 / 500.000 Token) untuk memastikan kepatuhan tata kelola biaya komputasi AI."),
        ("Profil Pengguna & Tombol '[🛡️ Shield]':", "Menampilkan identitas pengguna aktif (Tim Divisi EBT - ebt@plnindonesiapower.co.id) serta tombol status hijau [Shield] untuk memastikan proteksi privasi PII selalu aktif."),
        ("Lampiran Dokumen Langsung (📎):", "Pengguna dapat mengunggah file dokumen analisis (PDF, Word, Excel, CSV, TXT) secara instan melalui tombol lampiran di kolom chat utama.")
    ]
    for st, sd in sidebar_features:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {st} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(sd)

    # ---------------------------------------------------------
    # 4. BAB 3: MODUL SELECTOR & 5 FITUR UTAMA
    # ---------------------------------------------------------
    doc.add_page_break()
    h3 = doc.add_heading("3. Pemilih Modul & Rincian 5 Fitur Utama Aplikasi", level=1)
    h3.paragraph_format.space_before = Pt(18)
    h3.paragraph_format.space_after = Pt(8)
    h3.runs[0].font.color.rgb = COLOR_PLN_NAVY

    # Embed Image 4: Dropdown Selector
    if os.path.exists(img_modul_dropdown):
        p_img_drop = doc.add_paragraph()
        p_img_drop.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img_drop.paragraph_format.space_before = Pt(8)
        p_img_drop.paragraph_format.space_after = Pt(4)
        run_img_drop = p_img_drop.add_run()
        run_img_drop.add_picture(img_modul_dropdown, width=Inches(5.0))

        p_cap_drop = doc.add_paragraph()
        p_cap_drop.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap_drop.paragraph_format.space_after = Pt(14)
        r_cap_drop = p_cap_drop.add_run("Gambar 3: Dropdown Pemilih Modul Cepat (Header Bar)")
        r_cap_drop.font.size = Pt(9)
        r_cap_drop.font.italic = True
        r_cap_drop.font.color.rgb = COLOR_MUTED

    # Embed Image 2: 5 Launcher Cards
    if os.path.exists(img_launchers):
        p_img_launch = doc.add_paragraph()
        p_img_launch.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img_launch.paragraph_format.space_before = Pt(8)
        p_img_launch.paragraph_format.space_after = Pt(4)
        run_img_launch = p_img_launch.add_run()
        run_img_launch.add_picture(img_launchers, width=Inches(6.0))

        p_cap_launch = doc.add_paragraph()
        p_cap_launch.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap_launch.paragraph_format.space_after = Pt(14)
        r_cap_launch = p_cap_launch.add_run("Gambar 4: Lima Kartu Launcher Utama pada Dashboard")
        r_cap_launch.font.size = Pt(9)
        r_cap_launch.font.italic = True
        r_cap_launch.font.color.rgb = COLOR_MUTED

    modules_detail = [
        ("1. Cek Dokumen (RAG Knowledge Base)", "Ikon Dokumen Biru", "Tanya jawab cerdas berbasis SOP, studi kelayakan, pedoman teknis, dan dokumen EBT yang tersimpan di Knowledge Base."),
        ("2. Cari Data Tabular (SQL Database)", "Ikon Database Hijau", "Kueri otomatis database SQL korporat, filter kapasitas pembangkit (MW), efisiensi LCOE (Rp/kWh), EBITDA, CAPEX/OPEX, render grafik visual SVG, dan ekspor ke Excel."),
        ("3. Bandingkan Dokumen (Compare)", "Ikon Timbangan Kuning", "Membandingkan klausul antar draf dokumen/kontrak secara berdampingan (side-by-side matrix) dan mencatat delta perubahan."),
        ("4. Review & Audit Risiko", "Ikon Perisai Merah", "Menghitung Health Score Kepatuhan Dokumen (0 - 100%), mendeteksi Red Flags klausul kritis, dan memberikan draf klausul perbaikan."),
        ("5. Resume Rapat Pintar (Minutes of Meeting & Live Audio)", "Ikon Mikrofon Hijau", "Mendengarkan rapat langsung via mikrofon atau mengunggah rekaman audio bersama dokumen materi rapat untuk menghasilkan notulensi resmi (MoM) + Action Items.")
    ]

    for m_name, m_icon, m_desc in modules_detail:
        h_m = doc.add_heading(m_name, level=2)
        h_m.runs[0].font.color.rgb = COLOR_PLN_BLUE
        p_m = doc.add_paragraph()
        p_m.paragraph_format.line_spacing = 1.15
        r_ic = p_m.add_run(f"[{m_icon}]\n")
        r_ic.font.bold = True
        r_ic.font.color.rgb = COLOR_MUTED
        p_m.add_run(m_desc)

    # ---------------------------------------------------------
    # 5. BAB 4: DEEP DIVE PANEL REVIEW DOKUMEN & AUDIT RISIKO RED FLAGS
    # ---------------------------------------------------------
    doc.add_page_break()
    h_audit_sec = doc.add_heading("4. Panel Review Dokumen & Audit Risiko Red Flags (Deep Dive)", level=1)
    h_audit_sec.paragraph_format.space_before = Pt(18)
    h_audit_sec.paragraph_format.space_after = Pt(8)
    h_audit_sec.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p_aud_intro = doc.add_paragraph()
    p_aud_intro.paragraph_format.line_spacing = 1.2
    p_aud_intro.add_run(
        "Panel Review Dokumen & Audit Risiko dirancang khusus bagi Divisi Legal, Kepatuhan, dan Manajemen Kontrak untuk menguji kelayakan draf perjanjian kerja sama (PJBL, NDA, SPK) dan menemukan klausul yang berisiko merugikan korporasi secara instan."
    )

    # Embed Image: Audit Panel Screenshot
    if os.path.exists(img_audit_panel):
        p_img_aud = doc.add_paragraph()
        p_img_aud.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img_aud.paragraph_format.space_before = Pt(8)
        p_img_aud.paragraph_format.space_after = Pt(4)
        run_img_aud = p_img_aud.add_run()
        run_img_aud.add_picture(img_audit_panel, width=Inches(6.2))

        p_cap_aud = doc.add_paragraph()
        p_cap_aud.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap_aud.paragraph_format.space_after = Pt(14)
        r_cap_aud = p_cap_aud.add_run("Gambar 5: Antarmuka Panel Review Dokumen & Audit Risiko Red Flags (Health Score & Deteksi Celah Klausul)")
        r_cap_aud.font.size = Pt(9)
        r_cap_aud.font.italic = True
        r_cap_aud.font.color.rgb = COLOR_MUTED

    p_aud_fields = doc.add_paragraph()
    p_aud_fields.add_run("Penjelasan Kolom & Tombol pada Panel Audit Dokumen:\n").font.bold = True
    audit_fields_desc = [
        ("1. Dokumen Knowledge Base (Dropdown):", "Memilih dokumen referensi atau pedoman internal yang sudah ada di Knowledge Base sebagai acuan audit."),
        ("2. Atau Unggah File (Choose File):", "Mengunggah draf dokumen baru (PDF / Word .docx / Text) yang ingin diaudit secara langsung dari komputer."),
        ("3. Tipe Audit (Dropdown):", "Memilih metode pemeriksaan: '🔍 Review Menyeluruh (360° Audit)', '🛡️ Audit Kepatuhan Regulasi ESDM & UU PDP', atau '⚠️ Uji Risiko Klausul Finansial & Liabilitas'."),
        ("Area Tempel Teks Klausul (Textarea):", "Opsi alternatif untuk menempelkan (paste) potongan pasal/klausul tertentu secara cepat tanpa perlu mengunggah file utuh."),
        ("Fokus Audit Khusus (Input):", "Kolom instruksi tambahan khusus (contoh: 'Periksa denda keterlambatan COD pembangkit, klausul ganti rugi, dan batas penalti liabilitas')."),
        ("Tombol '🛡️ Jalankan Review Dokumen':", "Tombol merah oranye untuk mengeksekusi analisis audit AI dan menghasilkan Health Score (0-100%), daftar Red Flags, serta draf perbaikan hukum.")
    ]
    for af_t, af_d in audit_fields_desc:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {af_t} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(af_d)

    # ---------------------------------------------------------
    # 6. BAB 5: DEEP DIVE PANEL RESUME RAPAT PINTAR (LIVE AUDIO & MoM)
    # ---------------------------------------------------------
    doc.add_page_break()
    h_resume_sec = doc.add_heading("5. Panel Resume Rapat Pintar (Minutes of Meeting & Live Audio)", level=1)
    h_resume_sec.paragraph_format.space_before = Pt(18)
    h_resume_sec.paragraph_format.space_after = Pt(8)
    h_resume_sec.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p_res_intro = doc.add_paragraph()
    p_res_intro.paragraph_format.line_spacing = 1.2
    p_res_intro.add_run(
        "Panel Resume Rapat Pintar mengotomatisasi pembuatan notulensi rapat formal (Minutes of Meeting). Fitur ini mampu menangkap suara langsung dari mikrofon saat rapat berlangsung, membaca file rekaman suara, serta menyelaraskannya dengan bahan tayang presentasi terlampir."
    )

    # Embed Image: Resume Panel Screenshot
    if os.path.exists(img_resume_panel):
        p_img_res = doc.add_paragraph()
        p_img_res.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img_res.paragraph_format.space_before = Pt(8)
        p_img_res.paragraph_format.space_after = Pt(4)
        run_img_res = p_img_res.add_run()
        run_img_res.add_picture(img_resume_panel, width=Inches(6.2))

        p_cap_res = doc.add_paragraph()
        p_cap_res.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap_res.paragraph_format.space_after = Pt(14)
        r_cap_res = p_cap_res.add_run("Gambar 6: Antarmuka Panel Resume Rapat Pintar (Live Mic Recording, Upload Audio & Dokumen Pendukung)")
        r_cap_res.font.size = Pt(9)
        r_cap_res.font.italic = True
        r_cap_res.font.color.rgb = COLOR_MUTED

    p_res_fields = doc.add_paragraph()
    p_res_fields.add_run("Penjelasan Kolom & Fitur pada Panel Resume Rapat:\n").font.bold = True
    resume_fields_desc = [
        ("Topik / Agenda Rapat:", "Kolom untuk mendefinisikan judul pertemuan (contoh: 'Rapat Koordinasi & Evaluasi Proyek EBT Kuartal 4')."),
        ("((•)) Transkrip / Bicara Langsung:", "Area teks transkrip percakapan. Pengguna bisa menempel teks transkrip manual atau menggunakan tombol '🎙️ Mulai Mic'."),
        ("Tombol '🎙️ Mulai Mic' (Live Web Speech):", "Merekam suara pembicara langsung melalui mikrofon komputer secara real-time dan otomatis mengonversinya menjadi teks."),
        ("🎵 Atau Unggah Rekaman Audio / Video:", "Mendukung upload file rekaman suara rapat eksternal (.mp3, .wav, .m4a, .webm)."),
        ("📄 Dokumen Pendukung / Acuan Rapat (Opsional):", "Memilih dokumen dari Knowledge Base atau mengunggah materi presentasi (PDF/Word/Excel) agar AI memvalidasi angka teknis yang diucapkan pembicara."),
        ("Catatan Tambahan Rapat (Input):", "Kolom catatan khusus seperti daftar kehadiran PIC penting, arahan khusus Direktur Utama, atau timeline mendesak."),
        ("Tombol '📄 Buat Resume Rapat & Action Items':", "Tombol biru toska untuk mengeksekusi pembuatan Minutes of Meeting resmi lengkap dengan Ringkasan Eksekutif, Keputusan Strategis, dan Matriks Action Items per PIC.")
    ]
    for rf_t, rf_d in resume_fields_desc:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {rf_t} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(rf_d)

    # ---------------------------------------------------------
    # 7. BAB 6: PANEL INPUT CHAT CERDAS & MULTI-ATTACHMENT
    # ---------------------------------------------------------
    doc.add_page_break()
    h4 = doc.add_heading("6. Panel Input Chat Cerdas & Multi-Attachment Langsung", level=1)
    h4.paragraph_format.space_before = Pt(18)
    h4.paragraph_format.space_after = Pt(8)
    h4.runs[0].font.color.rgb = COLOR_PLN_NAVY

    # Embed Image 3: Chat Input Bar
    if os.path.exists(img_chat_bar):
        p_img_chat = doc.add_paragraph()
        p_img_chat.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img_chat.paragraph_format.space_before = Pt(8)
        p_img_chat.paragraph_format.space_after = Pt(4)
        run_img_chat = p_img_chat.add_run()
        run_img_chat.add_picture(img_chat_bar, width=Inches(6.2))

        p_cap_chat = doc.add_paragraph()
        p_cap_chat.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap_chat.paragraph_format.space_after = Pt(14)
        r_cap_chat = p_cap_chat.add_run("Gambar 7: Panel Input Chat Interaktif dengan Lampiran File (📎), Mic (🎙️), dan Kirim")
        r_cap_chat.font.size = Pt(9)
        r_cap_chat.font.italic = True
        r_cap_chat.font.color.rgb = COLOR_MUTED

    chat_tools = [
        ("Tombol 'Lampirkan File' (📎):", "Memilih satu atau banyak file sekaligus (PDF, Word, Excel, CSV, TXT) untuk dianalisis instan secara berdampingan."),
        ("Drag & Drop File:", "Menarik file dari komputer dan melepaskannya langsung ke area chat."),
        ("Tombol Suara (🎙️ Mic):", "Mendiktekan pertanyaan suara tanpa perlu mengetik manual."),
        ("Tombol 'Kirim' (🚀):", "Mengirim prompt ke AI untuk dianalisis instan."),
        ("Catatan Kaki Privasi (Footer):", "'Renewables AI didukung oleh Gemini Flash & Privacy Shield. Mendukung PDF, Word, Excel, CSV, Text, Audio, dan Komparasi Dokumen Otomatis.'")
    ]
    for ct, cd in chat_tools:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {ct} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(cd)

    # ---------------------------------------------------------
    # 8. BAB 7: TABEL CONTOH PROMPT TERBAIK
    # ---------------------------------------------------------
    doc.add_page_break()
    h6 = doc.add_heading("7. Rekomendasi Prompt Terbaik untuk Operasional PLN", level=1)
    h6.paragraph_format.space_before = Pt(18)
    h6.runs[0].font.color.rgb = COLOR_PLN_NAVY

    prompt_table = doc.add_table(rows=6, cols=3)
    prompt_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    p_headers = ["Kategori Modul", "Contoh Prompt yang Disarankan", "Hasil Output yang Diperoleh"]
    for j, h in enumerate(p_headers):
        c = prompt_table.cell(0, j)
        c.text = h
        set_cell_background(c, "0B3C5D")
        set_cell_margins(c, 100, 100, 100, 100)
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        c.paragraphs[0].runs[0].font.size = Pt(9.5)

    prompt_data = [
        ("Cari Data Tabular (SQL)",
         "\"Berapa EBITDA, laba bersih, dan margin kuartal 1 sampai 4 tahun 2025? Tampilkan grafik trennya.\"",
         "Tabel angka keuangan, grafik visual SVG, dan tombol download Excel (.xlsx)."),
        
        ("Cek Dokumen (RAG)",
         "\"Apa saja kewajiban pemeliharaan berkala pada turbin PLTB Sidrap menurut dokumen SOP terlampir?\"",
         "Jawaban terstruktur berbasis klausul dokumen asli beserta kutipan halamannya."),
        
        ("Bandingkan Dokumen",
         "\"Bandingkan draf RKAP 2025 Awal vs Revisi yang saya lampirkan ini. Tampilkan tabel varians anggarannya.\"",
         "Matriks perbandingan berdampingan dengan label [DITAMBAHKAN], [DIUBAH], [DIHAPUS]."),
        
        ("Review & Audit Risiko",
         "\"Audit draf kontrak PJBL terlampir ini. Apakah ada klausul liabilitas dan penalti yang membahayakan korporasi?\"",
         "Health Score (0-100%), daftar Red Flags kritis, dan draf klausul perbaikan legal."),
        
        ("Resume Rapat Pintar",
         "\"Buatkan Minutes of Meeting dari rekaman suara rapat koordinasi ini lengkap dengan Action Items dan PIC.\"",
         "Notulensi formal, ringkasan keputusan direksi, dan matriks penanggung jawab (PIC).")
    ]

    for i, row in enumerate(prompt_data):
        for j, val in enumerate(row):
            c = prompt_table.cell(i + 1, j)
            c.text = val
            set_cell_background(c, "FFFFFF" if i % 2 == 0 else "F8FAFC")
            set_cell_margins(c, 80, 80, 80, 80)
            p = c.paragraphs[0]
            if len(p.runs) > 0:
                p.runs[0].font.size = Pt(9)
                p.runs[0].font.color.rgb = COLOR_TEXT

    output_path = "/Users/sastrafirmansyah/Documents/sastra/projekan/chatai/Renewables_AI_User_Guide_and_Feature_Catalog_PLN.docx"
    doc.save(output_path)
    print(f"User Guide Document successfully updated with all panels at: {output_path}")

if __name__ == "__main__":
    create_feature_guide_document()
