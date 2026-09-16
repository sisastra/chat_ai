# 🏛️ Blueprint & Panduan Integrasi Arsitektur AI Enterprise
**PT PLN Indonesia Power Renewables**

Dokumentasi ini menjelaskan implementasi teknis dan panduan integrasi sistem yang selaras dengan arsitektur **Ingestion Pipeline + Hybrid Retrieval + Data Privacy Guardrails + LLM Generation**.

---

## 1. 🗺️ Diagram Alur & Pemetaan Komponen

```
[ Power BI API / Upload File ] 
        │
        ▼ (Extraction & Sections)
[ Ingestion Pipeline ] ──► Chunking (500 chars / 100 overlap)
        │
        ├──► JSON Metadata Generator (docId, sectionTitle, charCount)
        ├──► Sparse Vector Engine (TF-IDF / BM25)
        ├──► Dense Vector Embedding (FastAPI BAAI/bge-small-en / Gemini)
        │
        ▼
[ Secure Private Vector Store (Qdrant & SQLite) ]
        ▲
        │ (Hybrid Search: Cosine + BM25 + Query Adjacent Chunks)
        ▼
[ Reranker Engine (BAAI/bge-reranker-base / RRF) ]
        │
        ▼ (Top-K Chunks + Surrounding Context)
[ Data Privacy Guardrails (PII & Financial Masking) ]
        │
        ▼
[ Orchestrator & Tool Plugins ]
   ├── 🎙️ Meeting Summary (Audio Mic / Transkrip + Dokumen Pendukung)
   ├── 📝 Draft Nota Dinas Resmi PLN (Format Tata Naskah Dinas)
   ├── 📊 Analisis Kinerja Korporat, Finansial & Bisnis EBT
   └── 🛡️ Compliance Review & Policy Feedback Loop
        │
        ▼
[ Generation Model (Private vLLM Llama-3-70B / LLM) ]
        │
        ▼
[ Safe Unmasking & Output Delivery to User ]
```

---

## 2. 🔌 API Endpoints Siap Pakai

### A. Ingestion Pipeline
* **`POST /api/ingest/powerbi`**: Menerima dataset telemetri/laporan Power BI (metrik KPI, ringkasan, tabel data) dan langsung mengindeksnya ke dalam Vector Store.
* **`POST /api/ingest/batch`**: Menerima batch dokumen dengan pemotongan seksi dan metadata otomatis.
* **`POST /api/documents`**: Upload file individu (PDF, DOCX, XLSX, CSV, TXT) via multipart form.

### B. Tool Plugins & Orchestrator
* **`POST /api/tools/draft-memo`**: Menyusun **Nota Dinas Resmi Korporasi PLN** lengkap dengan nomor dinas, rujukan regulasi, pertimbangan finansial/CAPEX, dan rekomendasi disposisi.
* **`POST /api/tools/compliance-review`**: Melakukan audit kepatuhan (*Compliance Review*) terhadap dokumen/kontrak dan menghasilkan *Policy Feedback Loop* berbasis regulasi eksternal (UU PDP, Permen ESDM, GCG).
* **`POST /api/tools/corporate-analysis`**: Menganalisis data finansial (EBITDA, Net Margin, CAPEX/OPEX, LCOE per kWh) dan KPI korporat tahunan.
* **`POST /api/chat`**: Chat hybrid multi-dokumen (mendukung RAG, SQL Tabular, Komparasi Antar File, dan Live Audio Resume Rapat).

---

## 3. 🛡️ Data Privacy Guardrails (`privacy.js`)
Sebelum teks dikirimkan ke model AI (baik cloud maupun private on-premise), sistem otomatis menyamarkan:
1. **Nomor Rekening Bank & Kartu** (`[NO_REKENING_TERLINDUNGI_X]`)
2. **NIK / KTP / No Identitas 16-Digit** (`[NIK_TERLINDUNGI_X]`)
3. **Nomor Telepon & Handphone** (`[NO_HP_TERLINDUNGI_X]`)
4. **Alamat Email Pribadi/Perusahaan** (`[EMAIL_RAHASIA_X]`)
5. **Nominal Finansial Tertentu** (`[NOMINAL_FINANSIAL_X]`)

Setelah jawaban selesai digenerate oleh AI, sistem memulihkan (*unmask*) kembali nilai asli secara aman khusus pada antarmuka pengguna yang berhak.

---

## 4. 🐳 Cara Menghubungkan ke Cluster Qdrant & FastAPI (Opsional)

Jika ingin menjalankan service Qdrant dan FastAPI Embedding secara on-premise via Docker:

```bash
# 1. Jalankan Qdrant Vector DB
docker run -d -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant

# 2. Update .env di aplikasi:
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=pln_renewables_kb
```

Sistem akan otomatis mendeteksi koneksi ke Qdrant dan melakukan *hybrid vector indexing* tanpa perlu mengubah kode sumber!
