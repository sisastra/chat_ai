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

def create_styled_document():
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

    # Path to images
    diagram_img_path = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789550182819.png"
    shield_img_path = "/Users/sastrafirmansyah/.gemini/antigravity-ide/brain/037cd376-ea8b-49e4-a142-56b4967754da/.user_uploaded/media_1789549801992.png"

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

    run_title = title_p.add_run("DOKUMEN DESAIN SISTEM & ARSITEKTUR ENTERPRISE AI")
    run_title.font.name = "Arial"
    run_title.font.size = Pt(22)
    run_title.font.bold = True
    run_title.font.color.rgb = COLOR_PLN_NAVY

    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(20)
    run_sub = sub_p.add_run("Platform Generative AI, Hybrid Retrieval (RAG), Power BI Telemetry, Data Privacy Shield & Decision Support System untuk Transisi Energi dan Kinerja Korporat")
    run_sub.font.name = "Arial"
    run_sub.font.size = Pt(11)
    run_sub.font.italic = True
    run_sub.font.color.rgb = COLOR_MUTED

    # Meta Table (Doc Info)
    meta_table = doc.add_table(rows=4, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_data = [
        ("Nama Sistem", "Renewables AI Platform (v1.0.0 Enterprise)"),
        ("Instansi Pemilik", "PT PLN Indonesia Power Renewables"),
        ("Tujuan Dokumen", "Arsitektur Teknis, Panduan Integrasi Power BI & DB, dan Bahan Presentasi Manajemen"),
        ("Status Keamanan", "Enterprise Grade - Air-Gapped & PII Cryptographic Masking Shield")
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
    # 2. EXECUTIVE SUMMARY
    # ---------------------------------------------------------
    h1 = doc.add_heading("1. Ringkasan Eksekutif (Executive Summary)", level=1)
    h1.paragraph_format.space_before = Pt(18)
    h1.paragraph_format.space_after = Pt(8)
    h1.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p1 = doc.add_paragraph()
    p1.paragraph_format.line_spacing = 1.2
    p1.add_run(
        "Platform Renewables AI dikembangkan sebagai solusi terpadu untuk mengakselerasi transformasi digital dan otomatisasi pengambilan keputusan strategis di lingkungan PT PLN Indonesia Power Renewables. Sistem ini memadukan kemampuan Large Language Model (LLM) dengan mesin pencarian hibrida berkecepatan tinggi (Hybrid Dense + Sparse Vector Retrieval), telemetri live Power BI API, basis data relasional korporat, serta lapisan proteksi privasi mutlak (Data Privacy Guardrails)."
    )

    # ---------------------------------------------------------
    # 3. EMBEDDED ARCHITECTURE DIAGRAM (GAMBAR ASLI)
    # ---------------------------------------------------------
    doc.add_page_break()
    h2 = doc.add_heading("2. Blueprint Arsitektur Sistem & Diagram Alir Data Lengkap", level=1)
    h2.paragraph_format.space_before = Pt(18)
    h2.paragraph_format.space_after = Pt(8)
    h2.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p_diag_intro = doc.add_paragraph()
    p_diag_intro.add_run("Berikut adalah visualisasi arsitektur komprehensif sistem yang mengintegrasikan Power BI API Ingestion, Hybrid Retrieval, Adjacent Chunks Expansion, Reranker, Data Privacy Shield, dan Multi-Tool Generation:")

    # Embed High-Res Architecture Diagram Image
    if os.path.exists(diagram_img_path):
        p_img = doc.add_paragraph()
        p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img.paragraph_format.space_before = Pt(10)
        p_img.paragraph_format.space_after = Pt(4)
        run_img = p_img.add_run()
        run_img.add_picture(diagram_img_path, width=Inches(6.5))

        p_caption = doc.add_paragraph()
        p_caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_caption.paragraph_format.space_after = Pt(14)
        r_cap = p_caption.add_run("Gambar 1: Blueprint Arsitektur Ingestion Pipeline & Hybrid Retrieval Renewables AI PT PLN IP")
        r_cap.font.size = Pt(9)
        r_cap.font.italic = True
        r_cap.font.color.rgb = COLOR_MUTED

    # Penjelasan Detail Blok Diagram
    p_block_exp = doc.add_paragraph()
    p_block_exp.add_run("Penjelasan Alur 6 Blok Utama pada Diagram Arsitektur:\n").font.bold = True
    
    diag_blocks = [
        ("Ingestion Pipeline (Atas):", "Mengalirkan data dari Power BI API dan Dokumen Internal (PDF, Word, Excel, CSV) melalui tahapan Ekstraksi Seksi ➔ Pemotongan Chunks Cerdas ➔ Pembangkitan JSON Metadata ➔ Dual Vectorization (Sparse TF-IDF & Dense Private Embedding) ➔ Penyimpanan Terenkripsi ke Qdrant Vector Store."),
        ("Retrieval & Re-ranking (Bawah):", "Kueri pengguna diproses ganda via Dense Vector (FastAPI BAAI/bge-small-en-v1.5) dan Sparse TF-IDF ➔ Pencarian Hybrid Cosine Similarity + BM25 di Qdrant ➔ KRP (Keyword / Reciprocal Rank) ➔ Query Adjacent Chunks (mengambil chunk sebelum & sesudah untuk kelengkapan konteks) ➔ Re-ranking (FastAPI BAAI/bge-reranker-base)."),
        ("Privacy Shield & Guardrails:", "Menyaring seluruh teks dari PII dan nominal keuangan rahasia sebelum diumpankan ke model AI."),
        ("Orchestrator & Tool Plugins:", "Mengarahkan instruksi ke modul spesifik: Analisis Tabular/Finansial, Resume Rapat Audio/Transkrip, Generator Nota Dinas Resmi, dan Policy Feedback Loop untuk Compliance Officer.")
    ]
    for b_title, b_desc in diag_blocks:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {b_title} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(b_desc)

    # ---------------------------------------------------------
    # 4. KHUSUS: INTEGRASI POWER BI & TELEMETRI REAL-TIME
    # ---------------------------------------------------------
    doc.add_page_break()
    h_pbi = doc.add_heading("3. Integrasi Power BI, Telemetri Real-Time & ERP Korporat", level=1)
    h_pbi.paragraph_format.space_before = Pt(18)
    h_pbi.paragraph_format.space_after = Pt(8)
    h_pbi.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p_pbi_intro = doc.add_paragraph()
    p_pbi_intro.paragraph_format.line_spacing = 1.2
    p_pbi_intro.add_run(
        "Sesuai dengan diagram arsitektur di bagian Ingestion Pipeline, Power BI bertindak sebagai Sumber Telemetri & Data Operasional Dinamis. Platform Renewables AI dilengkapi dengan API Ingestion khusus dan REST Webhook Connector untuk menarik data metrik, KPI visual, dan tabel teragregasi dari Power BI Service secara otomatis."
    )

    # Alur Kerja Integrasi Power BI
    h_pbi_flow = doc.add_heading("3.1. Alur Kerja Integrasi Power BI (End-to-End)", level=2)
    h_pbi_flow.runs[0].font.color.rgb = COLOR_PLN_BLUE

    pbi_steps = [
        ("1. Pengiriman Data via REST Endpoint (/api/ingest/powerbi):",
         "Power Automate, Azure Data Factory, atau script Power BI mem-push payload JSON yang berisi nama dataset, judul laporan, ringkasan eksekutif, metrik KPI (misal: Produksi GWh, EAF %, EBITDA Margin), dan baris tabel data."),
        ("2. Pemrosesan Seksi & JSON Metadata Otomatis:",
         "Sistem secara otomatis mengonversi data Power BI menjadi format dokumen semantik dengan tag metadata khusus: sourceType: 'powerbi_telemetry', datasetName, dan timestamp sinkronisasi."),
        ("3. Vektorisasi Dual & Indeksasi Vektor Store:",
         "Data Power BI diubah menjadi Sparse Vector (TF-IDF) dan Dense Vector (BGE Embedding) lalu di-upsert ke Qdrant Vector Store dan SQLite untuk pencarian instan."),
        ("4. Tanya Jawab Bahasa Alami atas Dashboard Power BI (Natural Language Analytics):",
         "Pengguna tidak perlu mencari grafik visual secara manual. Cukup ketik pertanyaan seperti: 'Berdasarkan data Power BI hari ini, berapa deviasi produksi PLTS Cirata terhadap target RKAP?' dan AI akan langsung menyajikan jawaban angka akurat beserta analisis trennya.")
    ]
    for pst, psd in pbi_steps:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {pst} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(psd)

    # Connector Script Reference
    p_conn_ref = doc.add_paragraph()
    p_conn_ref.paragraph_format.space_before = Pt(6)
    p_conn_ref.add_run("Modul Penghubung di Kode Sumber: ").font.bold = True
    p_conn_ref.add_run("Tersedia modul konektor bawaan ")
    r_c1 = p_conn_ref.add_run("connectors/powerbi_connector.js")
    r_c1.font.bold = True
    r_c1.font.color.rgb = COLOR_PLN_BLUE
    p_conn_ref.add_run(" untuk webhook Power BI dan ")
    r_c2 = p_conn_ref.add_run("connectors/db_connector.js")
    r_c2.font.bold = True
    r_c2.font.color.rgb = COLOR_PLN_BLUE
    p_conn_ref.add_run(" untuk sinkronisasi database ERP (PostgreSQL, MySQL, SQL Server, Oracle).")

    # ---------------------------------------------------------
    # 5. KHUSUS: PENJELASAN MENDALAM DATA PRIVACY SHIELD
    # ---------------------------------------------------------
    doc.add_page_break()
    h_shield = doc.add_heading("4. Data Privacy Shield: Mekanisme Keamanan & Anti-Kebocoran Data", level=1)
    h_shield.paragraph_format.space_before = Pt(18)
    h_shield.paragraph_format.space_after = Pt(8)
    h_shield.runs[0].font.color.rgb = COLOR_PLN_NAVY

    p_shield_intro = doc.add_paragraph()
    p_shield_intro.paragraph_format.line_spacing = 1.2
    p_shield_intro.add_run(
        "Fitur [🛡️ Data Privacy Shield] adalah pilar keamanan utama pada platform Renewables AI yang bertindak sebagai Firewall Kriptografis Lokal. Fitur ini menjamin bahwa seluruh data rahasia korporasi, data finansial perusahaan, dan data pribadi karyawan (Personally Identifiable Information - PII) TIDAK PERNAH bocor ke internet luar, tidak tersimpan di server cloud publik, dan terlindungi sesuai mandat UU Perlindungan Data Pribadi (UU PDP No. 27/2022)."
    )

    # Embed Privacy Shield Badge Icon
    if os.path.exists(shield_img_path):
        p_badge = doc.add_paragraph()
        p_badge.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p_badge.paragraph_format.space_before = Pt(4)
        p_badge.paragraph_format.space_after = Pt(8)
        run_badge = p_badge.add_run()
        run_badge.add_picture(shield_img_path, width=Inches(1.6))
        r_btext = p_badge.add_run("   ◀ Indikator Status Keamanan Aktif di Antarmuka Pengguna")
        r_btext.font.size = Pt(10)
        r_btext.font.italic = True
        r_btext.font.color.rgb = COLOR_EMERALD

    # 3 Lapisan Keamanan Shield
    h_layers = doc.add_heading("4.1. Tiga Lapisan Perlindungan Data Privacy Shield", level=2)
    h_layers.runs[0].font.color.rgb = COLOR_PLN_BLUE

    shield_layers = [
        ("Lapisan 1: Sensor & Pseudonimisasi Otomatis (privacy.js)",
         "Sebelum pesan atau dokumen dianalisis oleh AI, sistem mendeteksi pola data sensitif secara lokal dan menggantinya dengan token anonim: \n"
         "  • NIK / KTP / No Paspor 16-Digit ➔ Diganti menjadi [NIK_TERLINDUNGI_1]\n"
         "  • Nomor Rekening Bank & Kartu Kredit ➔ Diganti menjadi [NO_REKENING_TERLINDUNGI_1]\n"
         "  • Angka Finansial & Gaji Sensitif ➔ Diganti menjadi [NOMINAL_FINANSIAL_1]\n"
         "  • Nomor Telepon / HP Internal ➔ Diganti menjadi [NO_HP_TERLINDUNGI_1]\n"
         "  • Alamat Email Pribadi / Korporat ➔ Diganti menjadi [EMAIL_RAHASIA_1]"),
        
        ("Lapisan 2: Safe Memory Mapping & Unmasking Lokal",
         "Tabel pemetaan nilai asli disimpan khusus di memori lokal laptop/server PLN yang terotorisasi. AI luar HANYA menerima token anonim bertopeng. Ketika AI selesai menghasilkan analisa, nilai asli dipulihkan kembali (unmasked) secara aman khusus pada antarmuka pengguna yang berhak."),
        
        ("Lapisan 3: Air-Gapped On-Premise Mode (Zero Internet Outbound)",
         "Jika instansi menghubungkan konfigurasi ke cluster GPU privat PLN (vLLM / Llama-3-70B di Port 8000 dan Qdrant di Port 6333), SELURUH komputasi berjalan 100% di dalam jaringan intranet tertutup tanpa perlu koneksi internet sama sekali.")
    ]

    for s_title, s_desc in shield_layers:
        p_s = doc.add_paragraph(style='List Bullet')
        r1 = p_s.add_run(f"• {s_title}:\n")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        p_s.add_run(s_desc)

    # Tabel Perbandingan Keamanan Shield
    h_comp = doc.add_heading("4.2. Matriks Komparasi Keamanan Data", level=2)
    h_comp.runs[0].font.color.rgb = COLOR_PLN_BLUE

    sec_table = doc.add_table(rows=6, cols=3)
    sec_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    sec_headers = ["Parameter Keamanan", "Renewables AI (Privacy Shield Aktif)", "AI Cloud Publik Biasa"]
    for j, h in enumerate(sec_headers):
        c = sec_table.cell(0, j)
        c.text = h
        set_cell_background(c, "0B3C5D")
        set_cell_margins(c, 100, 100, 100, 100)
        c.paragraphs[0].runs[0].font.bold = True
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        c.paragraphs[0].runs[0].font.size = Pt(9.5)

    sec_rows = [
        ("Penyimpanan Dokumen", "Storage Lokal / Qdrant Private On-Premise", "Server Cloud Pihak Ketiga Global"),
        ("Sensor PII & Finansial", "Otomatis 100% via Guardrails Shield", "Tidak Ada (Rentan Terbaca Terbuka)"),
        ("Transmisi Jaringan", "Terenkripsi / Terisolasi di Intranet PLN", "Melalui Internet Publik Terbuka"),
        ("Kepatuhan Regulasi", "Sesuai UU PDP No. 27/2022 & GCG PLN", "Potensi Pelanggaran Kerahasiaan Data"),
        ("Ketergantungan Internet", "Bisa berjalan Offline / Air-Gapped", "Wajib Terhubung ke Internet")
    ]
    for i, row in enumerate(sec_rows):
        for j, val in enumerate(row):
            c = sec_table.cell(i + 1, j)
            c.text = val
            set_cell_background(c, "FFFFFF" if i % 2 == 0 else "F8FAFC")
            set_cell_margins(c, 80, 80, 80, 80)
            p = c.paragraphs[0]
            if len(p.runs) > 0:
                p.runs[0].font.size = Pt(9)
                p.runs[0].font.color.rgb = COLOR_TEXT

    doc.add_paragraph().paragraph_format.space_after = Pt(16)

    # ---------------------------------------------------------
    # 6. INOVASI TEKNIS LAINNYA
    # ---------------------------------------------------------
    h_tech = doc.add_heading("5. Inovasi Arsitektur: Hybrid Retrieval & Adjacent Chunks", level=1)
    h_tech.paragraph_format.space_before = Pt(18)
    h_tech.runs[0].font.color.rgb = COLOR_PLN_NAVY

    tech_points = [
        ("Query Adjacent Chunks Expansion:", "Mengatasi kelemahan klasik RAG di mana tabel atau pasal kontrak terpotong di batas chunk. Saat Chunk #4 relevan, sistem otomatis menyertakan Chunk #3 dan Chunk #5 sehingga konteks dokumen utuh 100% tanpa halusinasi."),
        ("Dual-Vector Scoring (Dense + Sparse BM25):", "Mengombinasikan 70% kemiripan semantik kontekstual (vektor) dengan 30% pencocokan kata kunci eksak BM25 untuk menemukan pasal hukum, kode pembangkit, atau angka finansial yang presisi."),
        ("Cross-Encoder Re-ranking:", "Model BAAI/bge-reranker-base menilai kembali relevansi pasangan pertanyaan-jawaban sebelum teks diserahkan ke LLM.")
    ]
    for tt, td in tech_points:
        bp = doc.add_paragraph(style='List Bullet')
        r1 = bp.add_run(f"• {tt} ")
        r1.font.bold = True
        r1.font.color.rgb = COLOR_PLN_NAVY
        bp.add_run(td)

    # ---------------------------------------------------------
    # 7. SKENARIO PENGGUNAAN BISNIS (USE CASES)
    # ---------------------------------------------------------
    h_uc_main = doc.add_heading("6. Skenario Penggunaan Bisnis (Executive Use Cases)", level=1)
    h_uc_main.paragraph_format.space_before = Pt(18)
    h_uc_main.runs[0].font.color.rgb = COLOR_PLN_NAVY

    use_cases = [
        ("Use Case 1: Analisis Kinerja Finansial, Power BI & Proyek EBT",
         "Manajemen dapat mengevaluasi performa EBITDA kuartalan, efisiensi BPP (Biaya Pokok Penyediaan), penyerapan CAPEX, serta membandingkan nilai investasi dan LCOE antar pembangkit (PLTS Cirata, Saguling, PLTB Sidrap, Jatigede, Kamojang) dengan output grafik visual dan ekspor Excel instan."),
        
        ("Use Case 2: Otomasi Penyusunan Nota Dinas Resmi Korporasi",
         "Staf atau divisi cukup memasukkan perihal, urgensi, dan latar belakang masalah. AI secara otomatis menyusun berkas Nota Dinas berbobot legal sesuai Tata Naskah Dinas PLN lengkap dengan klausul pertimbangan finansial, kepatuhan, dan usulan disposisi persetujuan Direksi."),
        
        ("Use Case 3: Resume Rapat Cerdas & Ekstraksi Tindak Lanjut (MoM)",
         "Sistem menangkap suara rapat secara langsung atau membaca file rekaman audio, mengombinasikannya dengan bahan tayang/dokumen rapat terlampir, lalu mengekstrak Ringkasan Eksekutif, Poin Keputusan Strategis, Action Items, PIC, dan Target Waktu Penyelesaian."),
        
        ("Use Case 4: Audit Kontrak & Masukan Regulasi Eksternal (Compliance Loop)",
         "Dokumen perjanjian kerjasama atau kontrak jual beli tenaga listrik (PJBL) dapat diaudit keselarasan klausulnya terhadap regulasi Permen ESDM, UU Perlindungan Data Pribadi No. 27/2022, serta Good Corporate Governance (GCG) dengan Health Score (0-100%) dan Red Flags.")
    ]

    for uc_title, uc_desc in use_cases:
        h_uc = doc.add_heading(uc_title, level=2)
        h_uc.runs[0].font.color.rgb = COLOR_PLN_BLUE
        p_uc = doc.add_paragraph()
        p_uc.paragraph_format.line_spacing = 1.15
        p_uc.add_run(uc_desc)

    # ---------------------------------------------------------
    # 8. MATRIKS MICROSERVICES & TECH STACK
    # ---------------------------------------------------------
    doc.add_page_break()
    h_ms = doc.add_heading("7. Matriks Spesifikasi Microservices & Tech Stack", level=1)
    h_ms.paragraph_format.space_before = Pt(18)
    h_ms.runs[0].font.color.rgb = COLOR_PLN_NAVY

    spec_table = doc.add_table(rows=8, cols=4)
    spec_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Microservice / Komponen", "Teknologi", "Port / Endpoint", "Fungsi & Peran Utama"]
    
    for j, h in enumerate(headers):
        cell = spec_table.cell(0, j)
        cell.text = h
        set_cell_background(cell, "0B3C5D")
        set_cell_margins(cell, 120, 120, 120, 120)
        cell.paragraphs[0].runs[0].font.bold = True
        cell.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        cell.paragraphs[0].runs[0].font.size = Pt(9.5)

    specs = [
        ("Web UI & Orchestrator", "Node.js v20, Express, LangChain", "Port 3006 (/api/chat, /api/tools/*)", "Antarmuka chat, manajemen sesi, privacy shield, tool routing"),
        ("Power BI API Connector", "REST Webhook, JSON Ingestion", "Port 3006 (/api/ingest/powerbi)", "Menerima metrik telemetri & dataset Power BI otomatis"),
        ("FastAPI Dense Embedding", "Python 3.11, BAAI/bge-small-en-v1.5", "Port 8001 (/embeddings)", "Menghasilkan representasi vektor 384 dimensi berpresisi tinggi"),
        ("FastAPI Cross Reranker", "Python 3.11, BAAI/bge-reranker-base", "Port 8001 (/rerank)", "Menilai relevansi relasional antara pertanyaan dan konteks teks"),
        ("Secure Vector Database", "Qdrant Vector DB (Rust Engine)", "Port 6333 (/collections/*)", "Penyimpanan dan query vektor miliaran data poin dalam milidetik"),
        ("Relational Database", "SQLite / PostgreSQL / MySQL", "database.sqlite / Port 5432", "Penyimpanan tabel keuangan, KPI, proyek EBT, dan riwayat obrolan"),
        ("Private On-Premise LLM", "vLLM / Llama-3-70B-Instruct-Private", "Port 8000 (/v1/chat/completions)", "Inferensi penalaran tinggi secara mandiri di cluster GPU PLN")
    ]

    for i, row in enumerate(specs):
        for j, val in enumerate(row):
            cell = spec_table.cell(i + 1, j)
            cell.text = val
            set_cell_background(cell, "FFFFFF" if i % 2 == 0 else "F8FAFC")
            set_cell_margins(cell, 100, 100, 100, 100)
            p = cell.paragraphs[0]
            if len(p.runs) > 0:
                p.runs[0].font.size = Pt(9)
                p.runs[0].font.color.rgb = COLOR_TEXT

    output_path = "/Users/sastrafirmansyah/Documents/sastra/projekan/chatai/Renewables_AI_System_Design_and_Architecture_PLN.docx"
    doc.save(output_path)
    print(f"Enhanced Document with Power BI Integration successfully created at: {output_path}")

if __name__ == "__main__":
    create_styled_document()
