import express from "express";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
	ChatGoogleGenerativeAI,
	GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { maskSensitiveData, unmaskSensitiveData } from "./privacy.js";
import { HybridVectorStore } from "./vectorStore.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));
const DAILY_TOKEN_LIMIT = Number(process.env.DAILY_TOKEN_LIMIT || 500000);
const MONTHLY_TOKEN_LIMIT = Number(process.env.MONTHLY_TOKEN_LIMIT || 5000000);
const API_KEY_ID = createHash("sha256")
	.update(process.env.GEMINI_API_KEY || "")
	.digest("hex")
	.slice(0, 16);
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 20 * 1024 * 1024 },
});

let db;
let vectorStore = null;
let hybridVectorStore = null;
let ragDocs = [];

// Dynamic Model Factory: Private LLM On-Premise (vLLM / Llama-3-70B) & Cloud Gemini with Auto-Fallback
function createLLMModel() {
	const geminiModel = new ChatGoogleGenerativeAI({
		modelName: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
		apiKey: process.env.GEMINI_API_KEY,
		temperature: 0.1,
	});

	if (process.env.PRIVATE_LLM_URL && process.env.PRIVATE_LLM_URL.trim() !== "") {
		console.log(
			`[LLM Engine] Mode Dual-AI: Private On-Premise (${process.env.PRIVATE_LLM_MODEL || "Llama-3-70B"}) & Cloud Gemini (Aktif & Siap)`,
		);
		const privateModel = new ChatOpenAI({
			configuration: {
				baseURL: process.env.PRIVATE_LLM_URL,
				apiKey: process.env.PRIVATE_LLM_API_KEY || "dummy-key-for-local-vllm",
			},
			modelName: process.env.PRIVATE_LLM_MODEL || "Llama-3-70B-Instruct-Private",
			temperature: 0.1,
			maxRetries: 1,
			timeout: 5000,
		});

		// Fallback otomatis ke Gemini jika private GPU server offline / timeout
		return privateModel.withFallbacks({ fallbacks: [geminiModel] });
	}

	return geminiModel;
}

const model = createLLMModel();

// Setup Database & Vector Store
async function init() {
	db = await open({
		filename: "./database.sqlite",
		driver: sqlite3.Database,
	});

	// 1. Skema Tabel SQLite
	await db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_mesin TEXT,
      lokasi TEXT,
      status TEXT,
      tanggal DATE
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT,
      content TEXT,
	  conversation_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

	CREATE TABLE IF NOT EXISTS documents (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,
	  title TEXT NOT NULL,
	  content TEXT NOT NULL,
	  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_tokens INTEGER,
			api_key_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

		CREATE TABLE IF NOT EXISTS departments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			kode TEXT NOT NULL UNIQUE,
			nama TEXT NOT NULL,
			lokasi TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS positions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			kode TEXT NOT NULL UNIQUE,
			nama TEXT NOT NULL,
			level TEXT NOT NULL,
			gaji_min REAL NOT NULL,
			gaji_max REAL NOT NULL
		);

		CREATE TABLE IF NOT EXISTS employees (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			nomor_induk TEXT NOT NULL UNIQUE,
			nama TEXT NOT NULL,
			email TEXT NOT NULL UNIQUE,
			jenis_kelamin TEXT NOT NULL,
			tanggal_lahir DATE NOT NULL,
			department_id INTEGER NOT NULL,
			position_id INTEGER NOT NULL,
			lokasi_kerja TEXT NOT NULL,
			status_kepegawaian TEXT NOT NULL,
			tanggal_masuk DATE NOT NULL,
			gaji_pokok REAL NOT NULL,
			FOREIGN KEY (department_id) REFERENCES departments(id),
			FOREIGN KEY (position_id) REFERENCES positions(id)
		);

		CREATE TABLE IF NOT EXISTS corporate_kpis (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tahun INTEGER NOT NULL,
			periode TEXT NOT NULL,
			kategori TEXT NOT NULL,
			indikator_kpi TEXT NOT NULL,
			target REAL NOT NULL,
			realisasi REAL NOT NULL,
			satuan TEXT NOT NULL,
			capaian_persen REAL NOT NULL,
			status TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS financial_performance (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tahun INTEGER NOT NULL,
			kuartal TEXT NOT NULL,
			pendapatan_miliar REAL NOT NULL,
			beban_pokok_miliar REAL NOT NULL,
			ebitda_miliar REAL NOT NULL,
			laba_bersih_miliar REAL NOT NULL,
			capex_miliar REAL NOT NULL,
			opex_miliar REAL NOT NULL,
			lcoe_rp_per_kwh REAL NOT NULL,
			net_margin_persen REAL NOT NULL
		);

		CREATE TABLE IF NOT EXISTS renewable_projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			nama_proyek TEXT NOT NULL,
			jenis_ebt TEXT NOT NULL,
			kapasitas_mw REAL NOT NULL,
			lokasi TEXT NOT NULL,
			nilai_investasi_miliar REAL NOT NULL,
			target_cod TEXT NOT NULL,
			status_proyek TEXT NOT NULL,
			produksi_tahunan_gwh REAL NOT NULL,
			lcoe_rp_kwh REAL NOT NULL
		);
  `);
	const historyColumns = await db.all("PRAGMA table_info(chat_history)");
	const tokenUsageColumns = await db.all("PRAGMA table_info(token_usage)");
	if (!tokenUsageColumns.some((column) => column.name === "api_key_id")) {
		await db.exec("ALTER TABLE token_usage ADD COLUMN api_key_id TEXT");
	}
	if (!historyColumns.some((column) => column.name === "conversation_id")) {
		await db.exec("ALTER TABLE chat_history ADD COLUMN conversation_id TEXT");
	}
	if (!historyColumns.some((column) => column.name === "result_json")) {
		await db.exec("ALTER TABLE chat_history ADD COLUMN result_json TEXT");
	}
	if (!historyColumns.some((column) => column.name === "sql_query")) {
		await db.exec("ALTER TABLE chat_history ADD COLUMN sql_query TEXT");
	}
	if (!historyColumns.some((column) => column.name === "mode")) {
		await db.exec("ALTER TABLE chat_history ADD COLUMN mode TEXT");
	}
	await db.run(
		"UPDATE chat_history SET conversation_id = 'legacy-history' WHERE conversation_id IS NULL",
	);
	await db.run(
		"UPDATE chat_history SET mode = CASE WHEN sql_query IS NOT NULL THEN 'sql' ELSE 'rag' END WHERE mode IS NULL",
	);

	// Seed Financial Performance Data
	const finCount = await db.get("SELECT COUNT(*) as count FROM financial_performance");
	if (finCount.count === 0) {
		await db.exec(`
			INSERT INTO financial_performance (tahun, kuartal, pendapatan_miliar, beban_pokok_miliar, ebitda_miliar, laba_bersih_miliar, capex_miliar, opex_miliar, lcoe_rp_per_kwh, net_margin_persen) VALUES
			(2024, 'Q1', 1250.5, 780.2, 470.3, 215.4, 620.0, 180.5, 875.0, 17.2),
			(2024, 'Q2', 1380.0, 810.0, 570.0, 268.0, 710.0, 195.0, 850.0, 19.4),
			(2024, 'Q3', 1420.8, 835.5, 585.3, 280.2, 850.0, 210.0, 840.0, 19.7),
			(2024, 'Q4', 1590.2, 910.4, 679.8, 345.6, 990.0, 230.0, 825.0, 21.7),
			(2025, 'Q1', 1650.0, 940.0, 710.0, 375.0, 1100.0, 245.0, 810.0, 22.7),
			(2025, 'Q2', 1780.5, 990.2, 790.3, 420.5, 1250.0, 260.0, 795.0, 23.6),
			(2025, 'Q3', 1850.0, 1020.0, 830.0, 455.0, 1380.0, 275.0, 780.0, 24.6),
			(2025, 'Q4', 2050.0, 1100.0, 950.0, 530.0, 1500.0, 290.0, 760.0, 25.8);
		`);
	}

	// Seed Corporate KPIs
	const kpiCount = await db.get("SELECT COUNT(*) as count FROM corporate_kpis");
	if (kpiCount.count === 0) {
		await db.exec(`
			INSERT INTO corporate_kpis (tahun, periode, kategori, indikator_kpi, target, realisasi, satuan, capaian_persen, status) VALUES
			(2025, 'Tahunan', 'Operasional EBT', 'Total Kapasitas Terpasang EBT', 1200.0, 1285.0, 'MW', 107.08, 'Tercapai'),
			(2025, 'Tahunan', 'Operasional EBT', 'Produksi Listrik Hijau', 4500.0, 4720.0, 'GWh', 104.89, 'Tercapai'),
			(2025, 'Tahunan', 'Finansial', 'Pendapatan Usaha', 7000.0, 7330.5, 'Miliar Rp', 104.72, 'Tercapai'),
			(2025, 'Tahunan', 'Finansial', 'EBITDA Margin', 38.0, 40.5, '%', 106.58, 'Tercapai'),
			(2025, 'Tahunan', 'Finansial', 'Efisiensi Biaya Pokok Penyediaan (BPP)', 820.0, 786.0, 'Rp/kWh', 104.33, 'Tercapai'),
			(2025, 'Tahunan', 'ESG & Dekarbonisasi', 'Reduksi Emisi Karbon (CO2e)', 2.8, 3.1, 'Juta Ton', 110.71, 'Tercapai'),
			(2025, 'Tahunan', 'Keandalan', 'Equivalent Availability Factor (EAF)', 94.0, 95.8, '%', 101.91, 'Tercapai'),
			(2025, 'Tahunan', 'Investasi', 'Penyerapan CAPEX Proyek EBT', 5000.0, 5230.0, 'Miliar Rp', 104.60, 'Tercapai');
		`);
	}

	// Seed Renewable Power Plants / Projects
	const projectCount = await db.get("SELECT COUNT(*) as count FROM renewable_projects");
	if (projectCount.count === 0) {
		await db.exec(`
			INSERT INTO renewable_projects (nama_proyek, jenis_ebt, kapasitas_mw, lokasi, nilai_investasi_miliar, target_cod, status_proyek, produksi_tahunan_gwh, lcoe_rp_kwh) VALUES
			('PLTS Apung Cirata', 'PLTS Apung', 145.0, 'Jawa Barat', 1800.0, '2023', 'Operasi Penuh', 245.0, 780.0),
			('PLTS Apung Saguling', 'PLTS Apung', 60.0, 'Jawa Barat', 850.0, '2025', 'Konstruksi', 98.0, 790.0),
			('PLTB Sidrap Ekspansi', 'PLTB Bayu', 75.0, 'Sulawesi Selatan', 1450.0, '2024', 'Operasi Penuh', 185.0, 860.0),
			('PLTB Jeneponto', 'PLTB Bayu', 72.0, 'Sulawesi Selatan', 1380.0, '2023', 'Operasi Penuh', 178.0, 870.0),
			('PLTA Jatigede', 'PLTA Hidro', 110.0, 'Jawa Barat', 2400.0, '2024', 'Operasi Penuh', 450.0, 680.0),
			('PLTP Kamojang Unit 6', 'PLTP Geothermal', 55.0, 'Jawa Barat', 1900.0, '2025', 'Konstruksi', 410.0, 920.0),
			('PLTS Ground-Mounted IKN', 'PLTS Surya', 50.0, 'Kalimantan Timur', 720.0, '2024', 'Operasi Penuh', 82.0, 810.0);
		`);
	}

	// Dummy data jika tabel maintenance kosong
	const count = await db.get("SELECT COUNT(*) as count FROM maintenance_logs");
	if (count.count === 0) {
		await db.exec(`
      INSERT INTO maintenance_logs (nama_mesin, lokasi, status, tanggal) VALUES
      ('Turbin Generator A', 'Area 1', 'PENDING', '2026-03-01'),
      ('Pompa Pendingin B', 'Area 2', 'SELESAI', '2026-03-02'),
      ('Kompresor Udara C', 'Area 1', 'PROSES', '2026-03-03');
    `);
	}

	const departmentCount = await db.get(
		"SELECT COUNT(*) AS count FROM departments",
	);
	if (departmentCount.count === 0) {
		for (const department of [
			["OPS", "Operasional", "Jakarta"],
			["IT", "Teknologi Informasi", "Bandung"],
			["FIN", "Keuangan", "Jakarta"],
			["HR", "Human Resources", "Surabaya"],
			["MKT", "Marketing", "Jakarta"],
			["SCM", "Supply Chain", "Semarang"],
		]) {
			await db.run(
				"INSERT INTO departments (kode, nama, lokasi) VALUES (?, ?, ?)",
				department,
			);
		}
	}

	const positionCount = await db.get("SELECT COUNT(*) AS count FROM positions");
	if (positionCount.count === 0) {
		for (const position of [
			["DIR", "Director", "Direksi", 30000000, 50000000],
			["MGR", "Manager", "Manajerial", 18000000, 30000000],
			["SPV", "Supervisor", "Pengawas", 10000000, 18000000],
			["SEN", "Senior Specialist", "Senior", 9000000, 16000000],
			["STF", "Staff", "Pelaksana", 5500000, 10000000],
			["INT", "Intern", "Magang", 2500000, 4000000],
		]) {
			await db.run(
				"INSERT INTO positions (kode, nama, level, gaji_min, gaji_max) VALUES (?, ?, ?, ?, ?)",
				position,
			);
		}
	}

	const employeeCount = await db.get("SELECT COUNT(*) AS count FROM employees");
	if (employeeCount.count === 0) {
		const employees = [
			[
				"EMP001",
				"Aditya Pranoto",
				"aditya.pranoto@atlas.test",
				"L",
				"1985-02-14",
				"OPS",
				"DIR",
				"Jakarta",
				"Tetap",
				"2012-01-09",
				42000000,
			],
			[
				"EMP002",
				"Sinta Maharani",
				"sinta.maharani@atlas.test",
				"P",
				"1988-07-21",
				"OPS",
				"MGR",
				"Jakarta",
				"Tetap",
				"2015-04-13",
				24500000,
			],
			[
				"EMP003",
				"Rizky Kurniawan",
				"rizky.kurniawan@atlas.test",
				"L",
				"1990-11-03",
				"OPS",
				"SPV",
				"Jakarta",
				"Tetap",
				"2018-08-20",
				14500000,
			],
			[
				"EMP004",
				"Wulan Sari",
				"wulan.sari@atlas.test",
				"P",
				"1994-05-18",
				"OPS",
				"STF",
				"Jakarta",
				"Tetap",
				"2021-02-01",
				7500000,
			],
			[
				"EMP005",
				"Bagas Ramadhan",
				"bagas.ramadhan@atlas.test",
				"L",
				"1996-09-12",
				"OPS",
				"STF",
				"Jakarta",
				"Kontrak",
				"2023-06-12",
				6800000,
			],
			[
				"EMP006",
				"Nabila Putri",
				"nabila.putri@atlas.test",
				"P",
				"1998-01-28",
				"OPS",
				"INT",
				"Jakarta",
				"Magang",
				"2026-01-15",
				3500000,
			],
			[
				"EMP007",
				"Fajar Nugroho",
				"fajar.nugroho@atlas.test",
				"L",
				"1987-03-30",
				"IT",
				"MGR",
				"Bandung",
				"Tetap",
				"2016-09-05",
				27000000,
			],
			[
				"EMP008",
				"Larasati Dewi",
				"larasati.dewi@atlas.test",
				"P",
				"1991-12-09",
				"IT",
				"SEN",
				"Bandung",
				"Tetap",
				"2019-01-07",
				13500000,
			],
			[
				"EMP009",
				"Yoga Firmansyah",
				"yoga.firmansyah@atlas.test",
				"L",
				"1993-06-16",
				"IT",
				"SEN",
				"Bandung",
				"Tetap",
				"2020-03-16",
				12800000,
			],
			[
				"EMP010",
				"Citra Anggraini",
				"citra.anggraini@atlas.test",
				"P",
				"1995-10-25",
				"IT",
				"STF",
				"Bandung",
				"Tetap",
				"2022-07-04",
				8200000,
			],
			[
				"EMP011",
				"Dimas Setiawan",
				"dimas.setiawan@atlas.test",
				"L",
				"1997-04-11",
				"IT",
				"STF",
				"Bandung",
				"Kontrak",
				"2024-01-08",
				7000000,
			],
			[
				"EMP012",
				"Rara Amelia",
				"rara.amelia@atlas.test",
				"P",
				"1999-08-19",
				"IT",
				"INT",
				"Bandung",
				"Magang",
				"2026-02-02",
				3000000,
			],
			[
				"EMP013",
				"Budi Santoso",
				"budi.santoso@atlas.test",
				"L",
				"1986-01-06",
				"FIN",
				"MGR",
				"Jakarta",
				"Tetap",
				"2014-02-17",
				23500000,
			],
			[
				"EMP014",
				"Maya Lestari",
				"maya.lestari@atlas.test",
				"P",
				"1990-04-22",
				"FIN",
				"SEN",
				"Jakarta",
				"Tetap",
				"2018-11-12",
				14500000,
			],
			[
				"EMP015",
				"Andi Wijaya",
				"andi.wijaya@atlas.test",
				"L",
				"1993-09-27",
				"FIN",
				"STF",
				"Jakarta",
				"Tetap",
				"2021-05-03",
				7800000,
			],
			[
				"EMP016",
				"Putri Ayuningtyas",
				"putri.ayuningtyas@atlas.test",
				"P",
				"1996-02-15",
				"FIN",
				"STF",
				"Jakarta",
				"Kontrak",
				"2023-10-02",
				6500000,
			],
			[
				"EMP017",
				"Hendra Gunawan",
				"hendra.gunawan@atlas.test",
				"L",
				"1989-06-08",
				"HR",
				"MGR",
				"Surabaya",
				"Tetap",
				"2017-06-19",
				22000000,
			],
			[
				"EMP018",
				"Dewi Kartika",
				"dewi.kartika@atlas.test",
				"P",
				"1992-11-17",
				"HR",
				"SEN",
				"Surabaya",
				"Tetap",
				"2020-08-10",
				13000000,
			],
			[
				"EMP019",
				"Arman Hakim",
				"arman.hakim@atlas.test",
				"L",
				"1995-03-13",
				"HR",
				"STF",
				"Surabaya",
				"Tetap",
				"2022-01-10",
				7600000,
			],
			[
				"EMP020",
				"Nina Oktaviani",
				"nina.oktaviani@atlas.test",
				"P",
				"1998-12-01",
				"HR",
				"INT",
				"Surabaya",
				"Magang",
				"2026-01-12",
				3200000,
			],
			[
				"EMP021",
				"Kevin Hartono",
				"kevin.hartono@atlas.test",
				"L",
				"1988-10-29",
				"MKT",
				"MGR",
				"Jakarta",
				"Tetap",
				"2016-01-11",
				25000000,
			],
			[
				"EMP022",
				"Ayu Wulandari",
				"ayu.wulandari@atlas.test",
				"P",
				"1991-05-05",
				"MKT",
				"SEN",
				"Jakarta",
				"Tetap",
				"2019-05-06",
				14000000,
			],
			[
				"EMP023",
				"Galih Permana",
				"galih.permana@atlas.test",
				"L",
				"1994-07-14",
				"MKT",
				"STF",
				"Jakarta",
				"Tetap",
				"2021-09-13",
				8000000,
			],
			[
				"EMP024",
				"Sarah Natalia",
				"sarah.natalia@atlas.test",
				"P",
				"1997-01-23",
				"MKT",
				"STF",
				"Jakarta",
				"Kontrak",
				"2024-03-04",
				7200000,
			],
			[
				"EMP025",
				"Taufik Hidayat",
				"taufik.hidayat@atlas.test",
				"L",
				"1987-08-31",
				"SCM",
				"MGR",
				"Semarang",
				"Tetap",
				"2015-10-19",
				21000000,
			],
			[
				"EMP026",
				"Intan Permata",
				"intan.permata@atlas.test",
				"P",
				"1992-02-10",
				"SCM",
				"SPV",
				"Semarang",
				"Tetap",
				"2019-12-02",
				12000000,
			],
			[
				"EMP027",
				"Rian Maulana",
				"rian.maulana@atlas.test",
				"L",
				"1993-11-26",
				"SCM",
				"STF",
				"Semarang",
				"Tetap",
				"2021-11-15",
				7300000,
			],
			[
				"EMP028",
				"Eka Safitri",
				"eka.safitri@atlas.test",
				"P",
				"1996-06-30",
				"SCM",
				"STF",
				"Semarang",
				"Kontrak",
				"2023-02-06",
				6700000,
			],
			[
				"EMP029",
				"Robby Kencana",
				"robby.kencana@atlas.test",
				"L",
				"1999-09-09",
				"SCM",
				"INT",
				"Semarang",
				"Magang",
				"2026-02-16",
				2800000,
			],
			[
				"EMP030",
				"Mira Puspita",
				"mira.puspita@atlas.test",
				"P",
				"1994-12-20",
				"IT",
				"STF",
				"Bandung",
				"Cuti Panjang",
				"2022-04-18",
				8400000,
			],
		];
		for (const employee of employees) {
			const department = employee.splice(5, 1)[0];
			const position = employee.splice(5, 1)[0];
			const departmentRow = await db.get(
				"SELECT id FROM departments WHERE kode = ?",
				department,
			);
			const positionRow = await db.get(
				"SELECT id FROM positions WHERE kode = ?",
				position,
			);
			await db.run(
				`INSERT INTO employees
				 (nomor_induk, nama, email, jenis_kelamin, tanggal_lahir, department_id, position_id, lokasi_kerja, status_kepegawaian, tanggal_masuk, gaji_pokok)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				employee[0],
				employee[1],
				employee[2],
				employee[3],
				employee[4],
				departmentRow.id,
				positionRow.id,
				employee[5],
				employee[6],
				employee[7],
				employee[8],
			);
		}
	}

	// 2. Vector Store untuk RAG Dokumen
	await rebuildVectorStore();

	console.log("Database SQLite & Vector Store Siap.");
}

async function rebuildVectorStore() {
	ragDocs = [];
	try {
		if (!hybridVectorStore && db) {
			hybridVectorStore = new HybridVectorStore({
				db,
				qdrantUrl: process.env.QDRANT_URL,
				collectionName: process.env.QDRANT_COLLECTION || "pln_renewables_kb",
				embeddingUrl: process.env.FASTAPI_EMBEDDING_URL || process.env.EMBEDDING_API_URL,
				rerankerUrl: process.env.RERANKER_API_URL,
			});
			await hybridVectorStore.init();
		}

		const uploadedDocuments = await db.all(
			"SELECT id, title, content FROM documents ORDER BY id ASC",
		);

		if (!uploadedDocuments || uploadedDocuments.length === 0) {
			vectorStore = null;
			return;
		}

		const textSplitter = new RecursiveCharacterTextSplitter({
			chunkSize: 900,
			chunkOverlap: 120,
		});

		for (const doc of uploadedDocuments) {
			const chunks = await textSplitter.createDocuments(
				[doc.content],
				[{ source: doc.title, docId: doc.id }],
			);
			ragDocs.push(...chunks);

			if (hybridVectorStore) {
				await hybridVectorStore.ingestDocument({
					docId: doc.id,
					source: doc.title,
					content: doc.content,
					metadata: { type: "knowledge_base_document", title: doc.title },
				});
			}
		}

		if (ragDocs.length > 0) {
			vectorStore = await MemoryVectorStore.fromDocuments(
				ragDocs,
				new GoogleGenerativeAIEmbeddings({
					apiKey: process.env.GEMINI_API_KEY,
					modelName: "gemini-embedding-001",
				}),
			);
		} else {
			vectorStore = null;
		}
	} catch (error) {
		console.warn(
			`Vector Store Gemini tidak tersedia, memakai retrieval lokal/hybrid: ${error.message}`,
		);
		vectorStore = null;
	}
}

function sanitizeRagAnswer(text) {
	if (typeof text !== "string") return "";
	return text.trim();
}

app.get("/api/documents", async (req, res) => {
	const documents = await db.all(
		"SELECT id, title, length(content) AS size, created_at FROM documents ORDER BY id DESC",
	);
	res.json(documents);
});

app.delete("/api/documents/:id", async (req, res) => {
	try {
		const { id } = req.params;
		const doc = await db.get("SELECT id, title FROM documents WHERE id = ?", id);
		if (!doc) {
			return res.status(404).json({ error: "Dokumen tidak ditemukan." });
		}
		await db.run("DELETE FROM documents WHERE id = ?", id);
		await rebuildVectorStore();
		res.json({ message: `Dokumen "${doc.title}" berhasil dihapus.` });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

async function extractDocumentText(file) {
	const extension = (file.originalname.split(".").pop() || "").toLowerCase();
	const fileName = file.originalname;

	if (extension === "pdf") {
		try {
			const parser = new PDFParse({ data: file.buffer });
			const parsed = await parser.getText();
			await parser.destroy();
			const content = (parsed?.text || "").trim();
			if (!content) {
				throw new Error(
					`PDF "${fileName}" tidak berisi teks yang dapat dibaca. Pastikan file PDF bukan hasil scan murni tanpa OCR.`,
				);
			}
			return content;
		} catch (error) {
			throw new Error(
				`Gagal membaca PDF "${fileName}". Pastikan file memiliki teks yang bisa diekstrak.`,
			);
		}
	}

	if (extension === "docx" || extension === "doc") {
		try {
			const result = await mammoth.extractRawText({ buffer: file.buffer });
			const content = (result.value || "").trim();
			if (!content) {
				throw new Error(`Dokumen Word "${fileName}" kosong atau tidak bisa dibaca.`);
			}
			return content;
		} catch (error) {
			throw new Error(`Gagal membaca file Word "${fileName}": ${error.message}`);
		}
	}

	if (extension === "xlsx" || extension === "xls") {
		try {
			const workbook = XLSX.read(file.buffer, { type: "buffer" });
			let fullText = `[DOKUMEN EXCEL: ${fileName}]\n`;
			workbook.SheetNames.forEach((sheetName) => {
				const sheet = workbook.Sheets[sheetName];
				const csv = XLSX.utils.sheet_to_csv(sheet);
				if (csv && csv.trim()) {
					fullText += `\n--- LEMBAR KERJA: ${sheetName} ---\n${csv}\n`;
				}
			});
			const content = fullText.trim();
			if (!content || content.length <= fileName.length + 20) {
				throw new Error(`File Excel "${fileName}" kosong atau tidak memiliki data.`);
			}
			return content;
		} catch (error) {
			throw new Error(`Gagal membaca file Excel "${fileName}": ${error.message}`);
		}
	}

	// Plain text, Markdown, CSV, JSON, HTML, XML, RTF, YAML, LOG, dll.
	try {
		const content = file.buffer.toString("utf8").trim();
		if (!content) {
			throw new Error(`Dokumen "${fileName}" kosong atau tidak bisa dibaca.`);
		}
		return content;
	} catch (error) {
		throw new Error(`Gagal membaca file "${fileName}": ${error.message}`);
	}
}

app.post("/api/documents", upload.single("document"), async (req, res) => {
	try {
		if (!req.file) {
			return res
				.status(400)
				.json({ error: "Pilih file dokumen terlebih dahulu." });
		}
		const title = req.file.originalname;
		const content = await extractDocumentText(req.file);

		// Hindari duplikasi file identik
		const existing = await db.get(
			"SELECT id FROM documents WHERE title = ? AND length(content) = ?",
			title,
			content.length,
		);

		let docId;
		if (existing) {
			await db.run(
				"UPDATE documents SET content = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
				content,
				existing.id,
			);
			docId = existing.id;
		} else {
			const result = await db.run(
				"INSERT INTO documents (title, content) VALUES (?, ?)",
				title,
				content,
			);
			docId = result.lastID;
		}

		await rebuildVectorStore();
		res.status(201).json({
			id: docId,
			title,
			message: "Dokumen berhasil ditambahkan ke knowledge base.",
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// API Chat Endpoint (Mendukung Direct File Attachment Multi-Format & Multi-File)
app.post("/api/chat", upload.any(), async (req, res) => {
	try {
		const { message, mode, question, documentId, docId, stream: clientStream } = req.body;
		const isStream =
			clientStream === true ||
			clientStream === "true" ||
			req.headers.accept?.includes("text/event-stream");
		const rawMode = String(mode ?? "").toLowerCase();
		const userMessage = (message ?? question ?? "").trim();
		const resolvedMode = rawMode === "sql" ? "sql" : "rag";
		const selectedDocId = documentId || docId || null;
		const conversationId = req.body.conversationId || randomUUID();
		const privacyMode =
			req.body.privacyMode !== "false" && req.body.privacyMode !== false;

		const attachedFiles = Array.isArray(req.files) ? req.files : [];
		const attachedDocs = [];
		for (const file of attachedFiles) {
			try {
				const text = await extractDocumentText(file);
				if (text) {
					attachedDocs.push({ name: file.originalname, content: text });
				}
			} catch (err) {
				console.warn(`Gagal membaca lampiran ${file.originalname}:`, err.message);
			}
		}

		const usage = await getTokenUsage();
		const requestReserve = Math.ceil((userMessage.length + attachedDocs.reduce((acc, d) => acc + d.content.length, 0)) / 4) + 1000;
		if (usage.daily + requestReserve > DAILY_TOKEN_LIMIT) {
			return res.status(429).json({
				error: `Limit token harian tercapai. Terpakai ${usage.daily.toLocaleString("id-ID")} dari ${DAILY_TOKEN_LIMIT.toLocaleString("id-ID")} token.`,
				usage,
				limits: { daily: DAILY_TOKEN_LIMIT, monthly: MONTHLY_TOKEN_LIMIT },
			});
		}
		if (usage.monthly + requestReserve > MONTHLY_TOKEN_LIMIT) {
			return res.status(429).json({
				error: `Limit token bulanan tercapai. Terpakai ${usage.monthly.toLocaleString("id-ID")} dari ${MONTHLY_TOKEN_LIMIT.toLocaleString("id-ID")} token.`,
				usage,
				limits: { daily: DAILY_TOKEN_LIMIT, monthly: MONTHLY_TOKEN_LIMIT },
			});
		}

		if (isStream) {
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders?.();
		}

		const historyTitle = attachedDocs.length > 0
			? `${userMessage || "Analisis Dokumen"} [Lampiran: ${attachedDocs.map(d => d.name).join(", ")}]`
			: userMessage;

		// Simpan input user
		await db.run(
			"INSERT INTO chat_history (role, content, conversation_id) VALUES ('user', ?, ?)",
			[historyTitle, conversationId],
		);

		let answer = "";
		let rows = null;
		let sqlQuery = null;
		let sources = [];

		if (attachedDocs.length >= 2) {
			// KASUS 1: MULTIPLE ATTACHED DOCUMENTS (Komparasi & Analisis Lintas Dokumen)
			sources = attachedDocs.map((d) => d.name);
			const formattedAttached = attachedDocs
				.map((d, i) => `=== DOKUMEN ${i + 1}: ${d.name} ===\n${d.content.slice(0, 30000)}`)
				.join("\n\n---\n\n");

			let mappingTable = {};
			let maskedContext = formattedAttached;
			let maskedInput = userMessage || "Bandingkan seluruh dokumen yang dilampirkan ini secara mendalam, buatkan matriks perbandingan, dan berikan feedback kebijakan eksternal.";

			if (privacyMode) {
				const resInput = maskSensitiveData(maskedInput);
				const resCtx = maskSensitiveData(formattedAttached);
				maskedInput = resInput.maskedText;
				maskedContext = resCtx.maskedText;
				mappingTable = {
					...resInput.mappingTable,
					...resCtx.mappingTable,
				};
			}

			const comparePrompt = ChatPromptTemplate.fromMessages([
				[
					"system",
					`Anda adalah Analis Kebijakan, Kontrak, dan Dokumen Korporasi Senior di PT PLN Indonesia Power Renewables.
Tugas Anda adalah menganalisis dan membandingkan dokumen-dokumen yang dilampirkan oleh pengguna secara komprehensif, teliti, dan profesional.

Strukturkan laporan Anda dengan format Markdown profesional berikut:
### 1. 📌 Ringkasan Eksekutif & Intisari Perbandingan
(Jelaskan esensi dari masing-masing dokumen dan perbedaan fundamental di antara dokumen-dokumen tersebut)

### 2. 📊 Matriks Perbandingan Detail (Tabel)
Buat tabel perbandingan detail dengan kolom:
| No | Parameter / Aspek / Klausul | ${attachedDocs.map((d, i) => `Dokumen ${i + 1} (${d.name.slice(0, 18)})`).join(" | ")} | Status Perubahan / Evaluasi |
(Gunakan label status: [DITAMBAHKAN], [DIUBAH], [DIHAPUS], atau [IDENTIK] pada kolom status)

### 3. 🌐 Masukan Kebijakan Eksternal & Regulasi Terkini
(Analisis keselarasan dokumen dengan regulasi eksternal terbaru seperti UU PDP, regulasi EBT PLN, Permen ESDM, UU Cipta Kerja, dan standar kepatuhan hukum)

### 4. ⚠️ Analisis Risiko & Dampak Perubahan
(Identifikasi potensi celah hukum, beban finansial, kewajiban tersembunyi, atau klausul yang memberatkan)

### 5. 💡 Rekomendasi Tindakan Konkret AI
(Berikan rekomendasi perbaikan dan jawaban spesifik atas instruksi/pertanyaan pengguna: "${maskedInput}")`,
				],
				[
					"human",
					`DOKUMEN YANG DILAMPIRKAN:\n{context}\n\nINSTRUKSI PENGGUNA:\n{input}`,
				],
			]);

			const chain = comparePrompt.pipe(model);
			if (isStream) {
				const streamResp = await chain.stream({
					context: maskedContext,
					input: maskedInput,
				});
				for await (const chunk of streamResp) {
					let textChunk = typeof chunk.content === "string" ? chunk.content : chunk.content?.[0]?.text || "";
					if (textChunk) {
						if (privacyMode && Object.keys(mappingTable).length > 0) {
							textChunk = unmaskSensitiveData(textChunk, mappingTable);
						}
						answer += textChunk;
						res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
					}
				}
			} else {
				const resp = await chain.invoke({
					context: maskedContext,
					input: maskedInput,
				});
				answer = resp.content || "";
			}

			if (privacyMode && Object.keys(mappingTable).length > 0) {
				answer = unmaskSensitiveData(answer, mappingTable);
			}
		} else if (attachedDocs.length === 1) {
			// KASUS 2: SINGLE ATTACHED DOCUMENT (Tanya Jawab / Review / Rangkuman Dokumen Terlampir)
			sources = [attachedDocs[0].name];
			const singleDocContent = `=== DOKUMEN DILAMPIRKAN: ${attachedDocs[0].name} ===\n${attachedDocs[0].content.slice(0, 45000)}`;

			let mappingTable = {};
			let maskedContext = singleDocContent;
			let maskedInput = userMessage || "Analisis dan berikan ringkasan komprehensif, poin-poin penting, serta temuan kritis dari dokumen ini.";

			if (privacyMode) {
				const resInput = maskSensitiveData(maskedInput);
				const resCtx = maskSensitiveData(singleDocContent);
				maskedInput = resInput.maskedText;
				maskedContext = resCtx.maskedText;
				mappingTable = {
					...resInput.mappingTable,
					...resCtx.mappingTable,
				};
			}

			const singleDocPrompt = ChatPromptTemplate.fromMessages([
				[
					"system",
					`Anda adalah Asisten Ahli PT PLN Indonesia Power Renewables. Tugas Anda adalah menganalisis dokumen yang dilampirkan dan menjawab instruksi pengguna secara mendalam, akurat, dan terstruktur.

Jika pengguna menanyakan pertanyaan spesifik, jawab dengan data konkret dari dokumen.
Jika pengguna meminta review/audit, tampilkan Health Score (0-100%), Red Flags, dan klausul yang perlu diperbaiki.
Jika pengguna meminta resume, buatkan ringkasan eksekutif dan poin-poin keputusan penting.
Sertakan juga masukan regulasi/kebijakan eksternal terkini bila relevan.`,
				],
				[
					"human",
					`ISI DOKUMEN:\n{context}\n\nPERTANYAAN / INSTRUKSI PENGGUNA:\n{input}`,
				],
			]);

			const chain = singleDocPrompt.pipe(model);
			if (isStream) {
				const streamResp = await chain.stream({
					context: maskedContext,
					input: maskedInput,
				});
				for await (const chunk of streamResp) {
					let textChunk = typeof chunk.content === "string" ? chunk.content : chunk.content?.[0]?.text || "";
					if (textChunk) {
						if (privacyMode && Object.keys(mappingTable).length > 0) {
							textChunk = unmaskSensitiveData(textChunk, mappingTable);
						}
						answer += textChunk;
						res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
					}
				}
			} else {
				const resp = await chain.invoke({
					context: maskedContext,
					input: maskedInput,
				});
				answer = resp.content || "";
			}

			if (privacyMode && Object.keys(mappingTable).length > 0) {
				answer = unmaskSensitiveData(answer, mappingTable);
			}
		} else if (resolvedMode === "rag") {
			// KASUS 3: MODE RAG KNOWLEDGE BASE (Tanpa Lampiran Chat)
			if (ragDocs.length === 0) {
				answer =
					"Belum ada dokumen yang diunggah ke Knowledge Base. Silakan lampirkan dokumen langsung pada input chat di bawah atau unggah melalui menu Knowledge Base.";
				if (isStream) {
					res.write(`data: ${JSON.stringify({ chunk: answer })}\n\n`);
					res.write(
						`data: ${JSON.stringify({ done: true, answer, sources: [], conversationId })}\n\n`,
					);
					return res.end();
				}
			} else {
				try {
					let contextDocs = [];
					const isSpecificDoc =
						selectedDocId && selectedDocId !== "all" && selectedDocId !== "";

					if (hybridVectorStore && hybridVectorStore.inMemoryChunks.length > 0) {
						const hybridResults = await hybridVectorStore.search({
							query: userMessage,
							filterDocId: isSpecificDoc ? Number(selectedDocId) : null,
							topK: 4,
							includeAdjacent: true,
						});

						if (hybridResults.length > 0) {
							contextDocs = hybridResults.map((r) => ({
								pageContent: `[Seksi: ${r.sectionTitle || "Umum"}${r.isAdjacent ? " (Konteks Lanjutan)" : ""}]\n${r.content}`,
								metadata: { source: r.source, docId: r.docId, section: r.sectionTitle },
							}));
						}
					}

					if (contextDocs.length === 0) {
						if (isSpecificDoc) {
							const numericId = Number(selectedDocId);
							const docChunks = ragDocs.filter(
								(d) => d.metadata.docId === numericId,
							);

							if (docChunks.length === 0) {
								contextDocs = ragDocs.slice(0, 6);
							} else if (docChunks.length <= 8) {
								contextDocs = docChunks;
							} else if (vectorStore) {
								const retriever = vectorStore.asRetriever({
									filter: (doc) => doc.metadata.docId === numericId,
									k: 8,
								});
								contextDocs = await retriever.invoke(userMessage);
							} else {
								contextDocs = docChunks.slice(0, 8);
							}
						} else {
							if (vectorStore) {
								const retriever = vectorStore.asRetriever({ k: 6 });
								contextDocs = await retriever.invoke(userMessage);
							} else {
								const normalizedMessage = userMessage.toLowerCase();
								const matches = ragDocs.filter((doc) =>
									doc.pageContent
										.toLowerCase()
										.split(/\W+/)
										.some(
											(word) =>
												word.length > 3 && normalizedMessage.includes(word),
										),
								);
								contextDocs = matches.length
									? matches.slice(0, 6)
									: ragDocs.slice(0, 6);
							}
						}
					}

					sources = [
						...new Set(
							contextDocs
								.map((d) => d.metadata?.source)
								.filter(Boolean),
						),
					];

					const formattedContext = contextDocs
						.map(
							(d) =>
								`[Dokumen: ${d.metadata?.source || "Dokumen"}]\n${d.pageContent}`,
						)
						.join("\n\n---\n\n");

					let mappingTable = {};
					let maskedContext = formattedContext;
					let maskedInput = userMessage;

					if (privacyMode) {
						const resInput = maskSensitiveData(userMessage);
						const resCtx = maskSensitiveData(formattedContext);
						maskedInput = resInput.maskedText;
						maskedContext = resCtx.maskedText;
						mappingTable = {
							...resInput.mappingTable,
							...resCtx.mappingTable,
						};
					}

					const prompt = ChatPromptTemplate.fromMessages([
						[
							"system",
							"Anda adalah asisten AI yang cerdas, teliti, dan ramah yang bertugas menganalisis dokumen di PT PLN Indonesia Power Renewables. Jawab pertanyaan pengguna HANYA dalam bahasa natural (Bahasa Indonesia) berdasarkan dokumen yang diberikan. DILARANG KERAS menghasilkan kueri SQL, perintah SELECT/database, atau format kode database apapun.",
						],
						[
							"human",
							"Konteks Dokumen:\n<context>\n{context}\n</context>\n\nPertanyaan Pengguna: {input}\n\nJawablah berdasarkan isi dokumen di atas secara jelas, informatif, dan terstruktur:",
						],
					]);

					const chain = prompt.pipe(model);

					if (isStream) {
						const streamResponse = await chain.stream({
							context: maskedContext,
							input: maskedInput,
						});
						for await (const chunk of streamResponse) {
							let textChunk =
								typeof chunk.content === "string"
									? chunk.content
									: chunk.content?.[0]?.text || "";
							if (textChunk) {
								if (privacyMode && Object.keys(mappingTable).length > 0) {
									textChunk = unmaskSensitiveData(textChunk, mappingTable);
								}
								answer += textChunk;
								res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
							}
						}
					} else {
						const response = await chain.invoke({
							context: maskedContext,
							input: maskedInput,
						});
						answer = response.content || "";
					}

					if (privacyMode && Object.keys(mappingTable).length > 0) {
						answer = unmaskSensitiveData(answer, mappingTable);
					}

					answer = sanitizeRagAnswer(answer);
				} catch (error) {
					console.warn(`RAG processing error: ${error.message}`);
					try {
						const fallbackContext = ragDocs
							.slice(0, 5)
							.map((d) => `[${d.metadata?.source}]: ${d.pageContent}`)
							.join("\n\n");
						const fallbackPrompt = ChatPromptTemplate.fromMessages([
							[
								"system",
								"Anda adalah asisten AI yang bertugas menganalisis dokumen. Jawablah hanya dalam bahasa natural berdasarkan konteks dokumen. Jangan membuat kode SQL.",
							],
							[
								"human",
								"Isi Dokumen:\n{context}\n\nPertanyaan: {input}",
							],
						]);
						const fallbackChain = fallbackPrompt.pipe(model);
						if (isStream) {
							const fallbackStream = await fallbackChain.stream({
								context: fallbackContext,
								input: userMessage,
							});
							for await (const chunk of fallbackStream) {
								const textChunk =
									typeof chunk.content === "string"
										? chunk.content
										: chunk.content?.[0]?.text || "";
								if (textChunk) {
									answer += textChunk;
									res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
								}
							}
						} else {
							const resFallback = await fallbackChain.invoke({
								context: fallbackContext,
								input: userMessage,
							});
							answer = resFallback.content || "";
						}
						answer = sanitizeRagAnswer(answer);
					} catch (fallbackErr) {
						answer = `Maaf, terjadi kesalahan saat memproses dokumen: ${error.message}`;
						if (isStream) {
							res.write(`data: ${JSON.stringify({ chunk: answer })}\n\n`);
						}
					}
				}
			}
		} else {
			// MODE SQL (Cari Data DB)
			const schemaRows = await db.all(
				"SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT IN ('chat_history', 'token_usage', 'documents') ORDER BY name",
			);
			const schema = schemaRows.map((table) => table.sql).join("\n");
			const prompt = ChatPromptTemplate.fromMessages([
				[
					"system",
					`Anda adalah ahli SQL SQLite untuk analisis dan visualisasi data. Berdasarkan skema database berikut:
${schema}

Instruksi:
1. Ubah pertanyaan/permintaan pengguna menjadi kueri SQL SQLite MURNI tanpa markdown dan tanpa penjelasan apapun.
2. Jika pengguna meminta "grafik", "chart", "diagram", "visualisasi", "rekap", atau "tren", buatlah kueri agregasi data yang relevan (menggunakan GROUP BY, COUNT, SUM, AVG, dll.) yang menghasilkan minimal 1 kolom kategori/label dan 1 kolom angka/nilai numerik agar dapat langsung divisualisasikan menjadi grafik oleh antarmuka.
3. Hasilkan query SQL yang valid dan dapat langsung dieksekusi.`,
				],
				["human", "{question}"],
			]);

			const sqlChain = prompt.pipe(model);
			const sqlResponse = await sqlChain.invoke({ question: userMessage });
			sqlQuery = sqlResponse.content.trim().replace(/```sql|```/g, "");

			try {
				rows = await db.all(sqlQuery);
				answer = `Query berhasil dijalankan dan menghasilkan ${rows.length} baris.`;
			} catch (err) {
				answer = `Gagal eksekusi SQL: \`${sqlQuery}\`. Error: ${err.message}`;
			}
		}

		if (resolvedMode === "rag") {
			sqlQuery = null;
			rows = null;
		}

		// Simpan respon AI
		await db.run(
			"INSERT INTO chat_history (role, content, conversation_id, result_json, sql_query, mode) VALUES ('assistant', ?, ?, ?, ?, ?)",
			[
				answer,
				conversationId,
				rows ? JSON.stringify(rows) : (sources.length ? JSON.stringify({ sources }) : null),
				sqlQuery,
				resolvedMode,
			],
		);

		// Estimasi Token Usage
		const estimatedTokens = Math.round(
			(userMessage.length + answer.length) / 4,
		);
		await db.run(
			"INSERT INTO token_usage (total_tokens, api_key_id) VALUES (?, ?)",
			estimatedTokens,
			API_KEY_ID,
		);

		if (isStream) {
			res.write(
				`data: ${JSON.stringify({ done: true, answer, conversationId, sqlQuery, rows, sources })}\n\n`,
			);
			res.end();
		} else {
			res.json({ answer, conversationId, sqlQuery, rows, sources });
		}
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({ error: error.message });
		} else {
			res.write(`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`);
			res.end();
		}
	}
});

// API Bandingkan Dokumen (Document Compare)
app.post("/api/compare-documents", upload.any(), async (req, res) => {
	try {
		const isStream =
			req.body.stream === "true" ||
			req.body.stream === true ||
			req.headers.accept?.includes("text/event-stream");
		const privacyMode =
			req.body.privacyMode !== "false" && req.body.privacyMode !== false;
		const focusInstruction = req.body.focus
			? `FOKUS ANALISIS KHUSUS:\n${req.body.focus}`
			: "";
		const conversationId = req.body.conversationId || randomUUID();

		let docAContent = "";
		let docATitle = req.body.titleA || "Dokumen A";
		let docBContent = "";
		let docBTitle = req.body.titleB || "Dokumen B";

		// Ekstraksi file dari multipart jika diunggah
		if (Array.isArray(req.files)) {
			for (const file of req.files) {
				if (file.fieldname === "docA" || file.fieldname === "fileA") {
					docATitle = file.originalname;
					docAContent = await extractDocumentText(file);
				} else if (file.fieldname === "docB" || file.fieldname === "fileB") {
					docBTitle = file.originalname;
					docBContent = await extractDocumentText(file);
				}
			}
		}

		// Ekstraksi dari ID dokumen SQLite jika dipilih
		if (!docAContent && req.body.docIdA && req.body.docIdA !== "custom") {
			const dA = await db.get(
				"SELECT title, content FROM documents WHERE id = ?",
				req.body.docIdA,
			);
			if (dA) {
				docATitle = dA.title;
				docAContent = dA.content;
			}
		}
		if (!docBContent && req.body.docIdB && req.body.docIdB !== "custom") {
			const dB = await db.get(
				"SELECT title, content FROM documents WHERE id = ?",
				req.body.docIdB,
			);
			if (dB) {
				docBTitle = dB.title;
				docBContent = dB.content;
			}
		}

		// Raw text fallback
		if (!docAContent && req.body.textA) {
			docAContent = req.body.textA;
		}
		if (!docBContent && req.body.textB) {
			docBContent = req.body.textB;
		}

		if (!docAContent || !docBContent) {
			return res.status(400).json({
				error:
					"Harap berikan 2 dokumen untuk dibandingkan (Dokumen A dan Dokumen B).",
			});
		}

		// Pangkas bila melebihi kapasitas konteks demi kecepatan
		const maxChars = 24000;
		if (docAContent.length > maxChars)
			docAContent =
				docAContent.slice(0, maxChars) +
				"\n...[Dipotong untuk efisiensi analisis]...";
		if (docBContent.length > maxChars)
			docBContent =
				docBContent.slice(0, maxChars) +
				"\n...[Dipotong untuk efisiensi analisis]...";

		// PII Masking untuk Privasi Data
		let mappingTable = {};
		let maskedA = docAContent;
		let maskedB = docBContent;
		let detectedTypes = [];
		let totalMasked = 0;

		if (privacyMode) {
			const resA = maskSensitiveData(docAContent);
			const resB = maskSensitiveData(docBContent);
			maskedA = resA.maskedText;
			maskedB = resB.maskedText;
			mappingTable = { ...resA.mappingTable, ...resB.mappingTable };
			detectedTypes = Array.from(new Set([...resA.types, ...resB.types]));
			totalMasked = Object.keys(mappingTable).length;
		}

		if (isStream) {
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders?.();
		}

		const comparePrompt = ChatPromptTemplate.fromMessages([
			[
				"system",
				`Anda adalah auditor dokumen senior, analis hukum, dan konsultan kepatuhan regulasi industri. Tugas Anda adalah membandingkan dua dokumen secara objektif, mendalam, dan terstruktur, SERTA MEMBERIKAN MASUKAN & REKOMENDASI BERDASARKAN KEBIJAKAN, REGULASI PEMERINTAH, DAN STANDAR TERBARU YANG BERLAKU DI DUNIA NYATA / INTERNET.

Format Jawaban WAJIB menggunakan struktur Markdown profesional berikut:
### 1. 📌 Ringkasan Eksekutif Perbandingan
(Jelaskan esensi perbedaan utama antara Dokumen A dan Dokumen B dalam 2-3 kalimat lugas).

### 2. 📊 Matriks Perbandingan Detail
Buat tabel markdown terstruktur:
| Aspek / Klausul | Dokumen A: {docATitle} | Dokumen B: {docBTitle} | Status Perubahan | Implikasi / Catatan |
|---|---|---|---|---|
(Gunakan status: DITAMBAHKAN, DIHAPUS, DIUBAH, atau IDENTIK).

### 3. 🌐 Masukan Kebijakan & Regulasi Terkini (External Policy & Regulatory Insights)
- **Tinjauan Kepatuhan Terhadap Kebijakan Baru:** Bandingkan klausul kedua dokumen dengan regulasi terbaru yang relevan di Indonesia / standar internasional (misalnya: UU Perlindungan Data Pribadi / UU PDP, UU Ketenagakerjaan / Cipta Kerja, aturan perpajakan terbaru, regulasi OJK/Perbankan, standar K3, atau standar keamanan industri terkini).
- **Peringatan Klausul Usang (Outdated) / Celah Hukum:** Berikan masukan kritis jika ada klausul di dokumen yang bertentangan dengan kebijakan/undang-undang baru atau tidak lagi memenuhi standar pasar saat ini.

### 4. ⚖️ Analisis Risiko & Kepatuhan
- Sebutkan klausul/data yang berpotensi menimbulkan risiko hukum, kerugian finansial, atau celah sengketa operasional.
- Perhatikan perubahan angka nominal, tanggal, denda, atau batasan tanggung jawab.

### 5. 💡 Kesimpulan & Rekomendasi Tindakan AI
- Rekomendasi langkah konkret dan saran penyesuaian klausul agar selaras dengan standar dan kebijakan terbaru.`,
			],
			[
				"human",
				`=== DOKUMEN A: {docATitle} ===
{docAContent}

=== DOKUMEN B: {docBTitle} ===
{docBContent}

{focusInstruction}

Lakukan perbandingan dokumen secara menyeluruh dan sertakan analisis kepatuhan terhadap kebijakan/regulasi eksternal terbaru.`,
			],
		]);

		const chain = comparePrompt.pipe(model);
		let answer = "";

		if (isStream) {
			const streamResult = await chain.stream({
				docATitle,
				docBTitle,
				docAContent: maskedA,
				docBContent: maskedB,
				focusInstruction,
			});

			for await (const chunk of streamResult) {
				const textChunk =
					typeof chunk.content === "string"
						? chunk.content
						: chunk.content?.[0]?.text || "";
				if (textChunk) {
					answer += textChunk;
					res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
				}
			}
		} else {
			const resp = await chain.invoke({
				docATitle,
				docBTitle,
				docAContent: maskedA,
				docBContent: maskedB,
				focusInstruction,
			});
			answer = resp.content || "";
		}

		if (privacyMode && totalMasked > 0) {
			answer = unmaskSensitiveData(answer, mappingTable);
		}

		if (req.body.saveHistory !== false && req.body.saveHistory !== "false") {
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('user', ?, ?, 'compare')",
				[`Bandingkan: ${docATitle} vs ${docBTitle}`, conversationId],
			);
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('assistant', ?, ?, 'compare')",
				[answer, conversationId],
			);
		}

		const estimatedTokens = Math.round(
			(docAContent.length + docBContent.length + answer.length) / 4,
		);
		await db.run(
			"INSERT INTO token_usage (total_tokens, api_key_id) VALUES (?, ?)",
			estimatedTokens,
			API_KEY_ID,
		);

		const privacyInfo = {
			isProtected: privacyMode,
			maskedCount: totalMasked,
			detectedTypes,
		};

		if (isStream) {
			res.write(
				`data: ${JSON.stringify({ done: true, answer, conversationId, privacy: privacyInfo, docATitle, docBTitle })}\n\n`,
			);
			res.end();
		} else {
			res.json({
				answer,
				conversationId,
				privacy: privacyInfo,
				docATitle,
				docBTitle,
			});
		}
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({ error: error.message });
		} else {
			res.write(
				`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`,
			);
			res.end();
		}
	}
});

// API Feedback & Audit Input Eksternal
app.post("/api/external-feedback", upload.any(), async (req, res) => {
	try {
		const isStream =
			req.body.stream === "true" ||
			req.body.stream === true ||
			req.headers.accept?.includes("text/event-stream");
		const privacyMode =
			req.body.privacyMode !== "false" && req.body.privacyMode !== false;
		const criteriaInstruction = req.body.criteria
			? `KRITERIA AUDIT KHUSUS:\n${req.body.criteria}`
			: "";
		const conversationId = req.body.conversationId || randomUUID();

		let inputContent = req.body.content || req.body.inputContent || "";
		let inputTitle = req.body.title || "Input Eksternal";
		let referenceContent = "";
		let referenceTitle = "Basis Dokumen Acuan";

		if (Array.isArray(req.files)) {
			for (const file of req.files) {
				if (
					file.fieldname === "externalFile" ||
					file.fieldname === "document"
				) {
					inputTitle = file.originalname;
					inputContent = await extractDocumentText(file);
				} else if (file.fieldname === "referenceFile") {
					referenceTitle = file.originalname;
					referenceContent = await extractDocumentText(file);
				}
			}
		}

		if (!referenceContent && req.body.referenceDocId) {
			if (req.body.referenceDocId === "all") {
				const allDocs = await db.all(
					"SELECT title, content FROM documents LIMIT 5",
				);
				referenceContent = allDocs
					.map((d) => `[${d.title}]:\n${d.content}`)
					.join("\n\n");
				referenceTitle = "Semua Dokumen Knowledge Base";
			} else {
				const refDoc = await db.get(
					"SELECT title, content FROM documents WHERE id = ?",
					req.body.referenceDocId,
				);
				if (refDoc) {
					referenceTitle = refDoc.title;
					referenceContent = refDoc.content;
				}
			}
		} else if (!referenceContent && ragDocs.length > 0) {
			referenceContent = ragDocs
				.slice(0, 6)
				.map((d) => `[${d.metadata?.source || "Doc"}]:\n${d.pageContent}`)
				.join("\n\n");
		}

		if (!inputContent) {
			return res.status(400).json({
				error:
					"Harap berikan teks input eksternal atau unggah file draf yang ingin diaudit.",
			});
		}

		const maxChars = 24000;
		if (inputContent.length > maxChars)
			inputContent =
				inputContent.slice(0, maxChars) +
				"\n...[Dipotong untuk efisiensi]...";
		if (referenceContent.length > maxChars)
			referenceContent =
				referenceContent.slice(0, maxChars) +
				"\n...[Dipotong untuk efisiensi]...";

		// PII Masking
		let mappingTable = {};
		let maskedInput = inputContent;
		let maskedRef = referenceContent;
		let detectedTypes = [];
		let totalMasked = 0;

		if (privacyMode) {
			const resIn = maskSensitiveData(inputContent);
			const resRef = maskSensitiveData(referenceContent);
			maskedInput = resIn.maskedText;
			maskedRef = resRef.maskedText;
			mappingTable = { ...resIn.mappingTable, ...resRef.mappingTable };
			detectedTypes = Array.from(new Set([...resIn.types, ...resRef.types]));
			totalMasked = Object.keys(mappingTable).length;
		}

		if (isStream) {
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders?.();
		}

		const feedbackPrompt = ChatPromptTemplate.fromMessages([
			[
				"system",
				`Anda adalah konsultan kepatuhan (compliance officer) dan quality assurance auditor profesional. Tugas Anda adalah mengaudit dan mengevaluasi input eksternal / draf baru berdasarkan dokumen standar referensi.

Format Jawaban WAJIB menggunakan format Markdown berikut:
### 1. 🎯 Skor Kepatuhan & Status Evaluasi
- **Status Evaluasi:** [SESUAI / BUTUH PENYESUAIAN RINGAN / TIDAK SESUAI / KRITIS]
- **Skor Kepatuhan:** [0 - 100]%
- **Ringkasan Penilaian:** (1-2 paragraf evaluasi kesesuaian draf terhadap aturan referensi).

### 2. 🔍 Temuan & Analisis Audit
- **Poin yang Sudah Sesuai (Kelebihan):**
  - ...
- **Penyimpangan, Celah & Risiko (Kekurangan / Anomali):**
  - ...

### 3. ✏️ Rekomendasi & Draf Perbaikan Konkret
(Berikan saran perbaikan poin per poin yang aplikatif atau draf perbaikan kalimat/klausul yang direkomendasikan).`,
			],
			[
				"human",
				`=== DOKUMEN ACUAN / STANDAR REFERENSI ({referenceTitle}) ===
{referenceContent}

=== INPUT EKSTERNAL YANG DIAUDIT ({inputTitle}) ===
{inputContent}

{criteriaInstruction}

Berikan audit, evaluasi kepatuhan, dan feedback konstruktif.`,
			],
		]);

		const chain = feedbackPrompt.pipe(model);
		let answer = "";

		if (isStream) {
			const streamResult = await chain.stream({
				referenceTitle,
				referenceContent: maskedRef,
				inputTitle,
				inputContent: maskedInput,
				criteriaInstruction,
			});

			for await (const chunk of streamResult) {
				const textChunk =
					typeof chunk.content === "string"
						? chunk.content
						: chunk.content?.[0]?.text || "";
				if (textChunk) {
					answer += textChunk;
					res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
				}
			}
		} else {
			const resp = await chain.invoke({
				referenceTitle,
				referenceContent: maskedRef,
				inputTitle,
				inputContent: maskedInput,
				criteriaInstruction,
			});
			answer = resp.content || "";
		}

		if (privacyMode && totalMasked > 0) {
			answer = unmaskSensitiveData(answer, mappingTable);
		}

		if (req.body.saveHistory !== false && req.body.saveHistory !== "false") {
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('user', ?, ?, 'feedback')",
				[
					`Audit Input Eksternal: ${inputTitle} terhadap ${referenceTitle}`,
					conversationId,
				],
			);
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('assistant', ?, ?, 'feedback')",
				[answer, conversationId],
			);
		}

		const estimatedTokens = Math.round(
			(inputContent.length + referenceContent.length + answer.length) / 4,
		);
		await db.run(
			"INSERT INTO token_usage (total_tokens, api_key_id) VALUES (?, ?)",
			estimatedTokens,
			API_KEY_ID,
		);

		const privacyInfo = {
			isProtected: privacyMode,
			maskedCount: totalMasked,
			detectedTypes,
		};

		if (isStream) {
			res.write(
				`data: ${JSON.stringify({ done: true, answer, conversationId, privacy: privacyInfo, inputTitle, referenceTitle })}\n\n`,
			);
			res.end();
		} else {
			res.json({
				answer,
				conversationId,
				privacy: privacyInfo,
				inputTitle,
				referenceTitle,
			});
		}
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({ error: error.message });
		} else {
			res.write(
				`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`,
			);
			res.end();
		}
	}
});

// API Review Dokumen (Document Audit & Risk Review)
app.post("/api/review-document", upload.any(), async (req, res) => {
	try {
		const isStream =
			req.body.stream === "true" ||
			req.body.stream === true ||
			req.headers.accept?.includes("text/event-stream");
		const privacyMode =
			req.body.privacyMode !== "false" && req.body.privacyMode !== false;
		const reviewType = req.body.reviewType || "comprehensive";
		const customFocus = req.body.focus || req.body.customFocus || "";
		const conversationId = req.body.conversationId || randomUUID();

		let docContent = req.body.content || "";
		let docTitle = req.body.title || "Dokumen Review";

		if (Array.isArray(req.files)) {
			for (const file of req.files) {
				if (file.fieldname === "document" || file.fieldname === "file") {
					docTitle = file.originalname;
					docContent = await extractDocumentText(file);
				}
			}
		}

		if (!docContent && req.body.docId && req.body.docId !== "custom") {
			const dbDoc = await db.get(
				"SELECT title, content FROM documents WHERE id = ?",
				req.body.docId,
			);
			if (dbDoc) {
				docTitle = dbDoc.title;
				docContent = dbDoc.content;
			}
		}

		if (!docContent) {
			return res.status(400).json({
				error:
					"Harap pilih dokumen dari Knowledge Base, upload file, atau masukkan teks dokumen yang ingin direview.",
			});
		}

		const maxChars = 28000;
		if (docContent.length > maxChars)
			docContent =
				docContent.slice(0, maxChars) +
				"\n...[Dipotong untuk efisiensi analisis]...";

		// PII Masking
		let mappingTable = {};
		let maskedDoc = docContent;
		let detectedTypes = [];
		let totalMasked = 0;

		if (privacyMode) {
			const resPii = maskSensitiveData(docContent);
			maskedDoc = resPii.maskedText;
			mappingTable = resPii.mappingTable;
			detectedTypes = resPii.types;
			totalMasked = resPii.detectedCount;
		}

		if (isStream) {
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders?.();
		}

		let reviewTypeInstruction = "";
		if (reviewType === "legal_contract") {
			reviewTypeInstruction =
				"FOKUS UTAMA: Audit Hukum Kontrak, Klausul Jebakan, Ketidakseimbangan Hak & Kewajiban, Klausul Pengakhiran, Denda, Force Majeure, Batasan Tanggung Jawab (Liability), dan Potensi Sengketa Hukum.";
		} else if (reviewType === "sop_standard") {
			reviewTypeInstruction =
				"FOKUS UTAMA: Kepatuhan Standar Operasional Prosedur (SOP), Kejelasan Alur Kerja & PIC, Standar Keselamatan (K3/Quality Control), serta Celah Pelaksanaan Operasional.";
		} else if (reviewType === "clarity_grammar") {
			reviewTypeInstruction =
				"FOKUS UTAMA: Keterbacaan, Ambiguitas Kalimat (Multitafsir), Konsistensi Istilah, Ketepatan Struktur Redaksi Bahasa, dan Kejelasan Poin-Poin Dokumen.";
		} else {
			reviewTypeInstruction =
				"FOKUS UTAMA: Review Menyeluruh (Kelengkapan Klausul, Analisis Risiko & Red Flags, Kepatuhan, dan Rekomendasi Perbaikan Konkret).";
		}

		const reviewPrompt = ChatPromptTemplate.fromMessages([
			[
				"system",
				`Anda adalah Senior Legal Counsel, Compliance Officer, dan Auditor Dokumen Profesional. Tugas Anda adalah melakukan audit mendalam, analisis risiko (risk review), evaluasi kelayakan dokumen, SERTA MEMBERIKAN MASUKAN & REKOMENDASI BERDASARKAN KEBIJAKAN, REGULASI PEMERINTAH, DAN STANDAR TERBARU YANG BERLAKU DI LUAR / INTERNET.

TIPE REVIEW: ${reviewTypeInstruction}

Format Jawaban WAJIB menggunakan struktur Markdown profesional berikut:
### 1. 📌 Ringkasan Eksekutif & Skor Kelayakan
- **Skor Kelayakan / Health Score:** [0 - 100]%
- **Status Dokumen:** [AMAN DITANDATANGANI / BUTUH PENYESUAIAN RINGAN / RISIKO TINGGI - BUTUH REVISI BESAR / TIDAK DIREKOMENDASIKAN]
- **Ringkasan Intisari:** (2-3 paragraf ringkasan isi dokumen, tujuan utama, dan penilaian umum).

### 2. 🌐 Masukan Kebijakan & Regulasi Terkini (External Policy & Regulatory Intelligence)
- **Kesesuaian Terhadap Regulasi Terbaru:** Evaluasi apakah klausul dokumen sudah mematuhi kebijakan, undang-undang, atau standar industri terbaru yang berlaku (seperti UU Perlindungan Data Pribadi / PDP, UU Cipta Kerja / Ketenagakerjaan, regulasi OJK/Finansial, perpajakan, atau standar teknis terkait).
- **Peringatan Kebijakan Baru & Klausul Usang:** Identifikasi pasal yang bertentangan dengan hukum baru atau mengandung klausul kadaluarsa yang berpotensi batal demi hukum (*null and void*).

### 3. 🚩 Temuan Kritis & Analisis Risiko ("Red Flags")
(Sajikan tabel temuan klausul yang memberatkan sepihak, jebakan denda, ganti rugi tanpa batas, atau celah operasional/hukum):
| Poin / Klausul | Temuan Masalah & Potensi Risiko | Tingkat Risiko [TINGGI/SEDANG/RENDAH] |
|---|---|---|

### 4. 📋 Pemeriksaan Kelengkapan (Gap Analysis)
- **Klausul/Bagian yang Sudah Baik:** (Poin-poin positif dalam dokumen).
- **Klausul Penting yang Hilang / Terlewat:** (Contoh: Kerahasiaan/NDA, Batasan Tanggung Jawab, Force Majeure, SLA, Arbitrase/Pengadilan jika belum ada).

### 5. 🔍 Ambiguitas & Catatan Teknis/Finansial
- Sebutkan kalimat bermakna ganda, multitafsir, inkonsistensi tanggal, atau nominal angka jika ditemukan.

### 6. 💡 Rekomendasi Revisi & Draf Klausul Perbaikan
(Berikan rekomendasi langkah konkret dan contoh draf klausul pengganti yang lebih seimbang, aman, dan selaras dengan regulasi terbaru).`,
			],
			[
				"human",
				`=== DOKUMEN YANG DIREVIEW: {docTitle} ===
{docContent}

${customFocus ? `CATATAN FOKUS TAMBAHAN DARI PENGGUNA:\n${customFocus}` : ""}

Lakukan review dan audit dokumen secara menyeluruh dan berikan laporan lengkap beserta masukan kebijakan terbaru.`,
			],
		]);

		const chain = reviewPrompt.pipe(model);
		let answer = "";

		if (isStream) {
			const streamResult = await chain.stream({
				docTitle,
				docContent: maskedDoc,
			});

			for await (const chunk of streamResult) {
				const textChunk =
					typeof chunk.content === "string"
						? chunk.content
						: chunk.content?.[0]?.text || "";
				if (textChunk) {
					answer += textChunk;
					res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
				}
			}
		} else {
			const resp = await chain.invoke({
				docTitle,
				docContent: maskedDoc,
			});
			answer = resp.content || "";
		}

		if (privacyMode && totalMasked > 0) {
			answer = unmaskSensitiveData(answer, mappingTable);
		}

		if (req.body.saveHistory !== false && req.body.saveHistory !== "false") {
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('user', ?, ?, 'review')",
				[`Review Dokumen: ${docTitle}`, conversationId],
			);
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('assistant', ?, ?, 'review')",
				[answer, conversationId],
			);
		}

		const estimatedTokens = Math.round(
			(docContent.length + answer.length) / 4,
		);
		await db.run(
			"INSERT INTO token_usage (total_tokens, api_key_id) VALUES (?, ?)",
			estimatedTokens,
			API_KEY_ID,
		);

		const privacyInfo = {
			isProtected: privacyMode,
			maskedCount: totalMasked,
			detectedTypes,
		};

		if (isStream) {
			res.write(
				`data: ${JSON.stringify({ done: true, answer, conversationId, privacy: privacyInfo, docTitle })}\n\n`,
			);
			res.end();
		} else {
			res.json({
				answer,
				conversationId,
				privacy: privacyInfo,
				docTitle,
			});
		}
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({ error: error.message });
		} else {
			res.write(
				`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`,
			);
			res.end();
		}
	}
});

// API Resume & Notulensi Rapat (Meeting Minutes, Audio & Live Transcripts)
app.post("/api/meeting-resume", upload.any(), async (req, res) => {
	try {
		const isStream =
			req.body.stream === "true" ||
			req.body.stream === true ||
			req.headers.accept?.includes("text/event-stream");
		const privacyMode =
			req.body.privacyMode !== "false" && req.body.privacyMode !== false;
		const meetingTopic =
			req.body.topic ||
			req.body.meetingTopic ||
			"Rapat Koordinasi & Operasional";
		const customNotes = req.body.notes || req.body.customNotes || "";
		const conversationId = req.body.conversationId || randomUUID();
		let meetingContent =
			req.body.transcript ||
			req.body.content ||
			req.body.text ||
			req.body.meetingContent ||
			"";
		let sourceTitle = meetingTopic;
		let audioFile = null;

		let supportDocContent = "";
		let supportDocTitle = "";

		if (Array.isArray(req.files)) {
			for (const file of req.files) {
				const ext = (
					file.originalname.split(".").pop() || ""
				).toLowerCase();
				const isAudioOrVideo =
					[
						"mp3",
						"m4a",
						"wav",
						"ogg",
						"webm",
						"mp4",
						"aac",
						"flac",
					].includes(ext) ||
					file.mimetype.startsWith("audio/") ||
					file.mimetype.startsWith("video/");
				if (isAudioOrVideo) {
					audioFile = file;
					sourceTitle = file.originalname;
				} else {
					try {
						const docText = await extractDocumentText(file);
						if (docText) {
							supportDocTitle = file.originalname;
							supportDocContent += `\n\n[DOKUMEN PENDUKUNG / ACUAN RAPAT: ${file.originalname}]\n${docText}\n`;
						}
					} catch (err) {
						console.warn(`Gagal mengekstrak dokumen pendukung ${file.originalname}:`, err.message);
					}
				}
			}
		}

		if (req.body.docId && req.body.docId !== "custom" && req.body.docId !== "") {
			const dbDoc = await db.get(
				"SELECT title, content FROM documents WHERE id = ?",
				req.body.docId,
			);
			if (dbDoc) {
				supportDocTitle = supportDocTitle ? `${supportDocTitle}, ${dbDoc.title}` : dbDoc.title;
				supportDocContent += `\n\n[DOKUMEN PENDUKUNG DARI KNOWLEDGE BASE: ${dbDoc.title}]\n${dbDoc.content}\n`;
			}
		}

		if (supportDocContent) {
			if (meetingContent) {
				meetingContent = `${meetingContent}\n\n=== DOKUMEN PENDUKUNG RAPAT ===${supportDocContent}`;
			} else if (!audioFile) {
				meetingContent = supportDocContent.trim();
			}
		}

		if (!meetingContent && customNotes) {
			meetingContent = customNotes;
		}

		if (!meetingContent && !audioFile) {
			return res.status(400).json({
				error:
					"Harap berikan transkrip percakapan rapat, catatan teks, dokumen pendukung, atau unggah file rekaman audio/video (.mp3, .wav, .m4a, .mp4, dll).",
			});
		}

		if (isStream) {
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders?.();
		}

		let answer = "";
		let mappingTable = {};
		let totalMasked = 0;
		let detectedTypes = [];

		if (audioFile) {
			// Analisis Audio Multimodal via Gemini API
			const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
			let mimeType = audioFile.mimetype;
			if (!mimeType || mimeType === "application/octet-stream") {
				if (audioFile.originalname.endsWith(".mp3")) mimeType = "audio/mp3";
				else if (audioFile.originalname.endsWith(".wav"))
					mimeType = "audio/wav";
				else if (audioFile.originalname.endsWith(".m4a"))
					mimeType = "audio/mp4";
				else mimeType = "audio/webm";
			}

			const systemInstruction = `Anda adalah Notulis Rapat Eksekutif dan Corporate Secretary Profesional. Dengarkan dan analisis rekaman suara/audio rapat ini${supportDocContent ? " serta jadikan dokumen pendukung yang dilampirkan sebagai konteks acuan" : ""}, lalu susun NOTULENSI RESMI (MINUTES OF MEETING / MoM) yang komprehensif, terstruktur, dan siap dibagikan ke seluruh tim.
${supportDocContent ? `\nDOKUMEN PENDUKUNG / ACUAN:\n${supportDocContent.slice(0, 20000)}\n` : ""}
${customNotes ? `\nCATATAN TAMBAHAN DARI PENGGUNA:\n${customNotes}\n` : ""}
Format Notulensi WAJIB menggunakan struktur Markdown profesional berikut:
### 1. 📌 Informasi & Ringkasan Eksekutif Rapat
- **Topik / Agenda Rapat:** ${meetingTopic}
- **Sumber Rekaman:** ${sourceTitle}${supportDocTitle ? ` | Dokumen Pendukung: ${supportDocTitle}` : ""}
- **Ringkasan Intisari Rapat:** (2-3 paragraf padat mengenai latar belakang, bahasan utama, dan hasil akhir pertemuan).

### 2. 🗣️ Poin-Poin Diskusi Kunci & Pembahasan
- Sajikan poin-poin ide, argumen penting, atau evaluasi yang dibahas oleh para pembicara secara runtut dan jelas.

### 3. 🎯 Keputusan Utama yang Disepakati (Key Decisions)
- Sebutkan semua poin kesepakatan final atau keputusan manajemen yang diambil dalam rapat ini.

### 4. ✅ Matriks Tindak Lanjut & Action Items (PIC & Deadline)
(Sajikan tabel aksi terstruktur):
| No | Tindakan / Tugas yang Harus Dikerjakan | PIC (Penanggung Jawab) | Tenggat Waktu (Deadline) | Status / Prioritas |
|---|---|---|---|---|
(Isi tabel dengan tugas konkret, orang/divisi yang bertanggung jawab, dan tenggat waktunya).

### 5. ⚠️ Isu Tertunda, Kendala & Rencana Tindak Lanjut
- Hal-hal yang belum selesai dan perlu dibahas pada pertemuan berikutnya.

### 6. 🌐 Masukan Kebijakan / Kepatuhan Terkait
- Masukan ringkas jika ada pembahasan rapat yang bersinggungan dengan regulasi eksternal atau SOP perusahaan.`;

			try {
				const response = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							contents: [
								{
									parts: [
										{
											inlineData: {
												mimeType: mimeType,
												data: audioFile.buffer.toString(
													"base64",
												),
											},
										},
										{
											text: `Tolong dengarkan rekaman suara rapat ini dan buatkan Notulensi Rapat (Minutes of Meeting) formal sesuai format instruksi.${customNotes ? `\nCatatan Tambahan Peserta: ${customNotes}` : ""}`,
										},
									],
								},
							],
							systemInstruction: {
								parts: [{ text: systemInstruction }],
							},
						}),
					},
				);

				const jsonResp = await response.json();
				if (!response.ok) {
					throw new Error(
						jsonResp.error?.message ||
							`Gagal menganalisis rekaman audio: HTTP ${response.status}`,
					);
				}

				answer =
					jsonResp.candidates?.[0]?.content?.parts?.[0]?.text || "";
				if (!answer) {
					throw new Error(
						"AI tidak menghasilkan teks notulen dari rekaman suara.",
					);
				}

				if (isStream) {
					res.write(`data: ${JSON.stringify({ chunk: answer })}\n\n`);
				}
			} catch (audioErr) {
				console.error("Audio processing error:", audioErr);
				throw new Error(
					`Gagal memproses rekaman suara: ${audioErr.message}`,
				);
			}
		} else {
			// Pemrosesan Transkrip Teks / Live Listening Transcripts
			const maxChars = 28000;
			if (meetingContent.length > maxChars)
				meetingContent =
					meetingContent.slice(0, maxChars) +
					"\n...[Dipotong untuk efisiensi analisis]...";

			let maskedContent = meetingContent;
			if (privacyMode) {
				const resPii = maskSensitiveData(meetingContent);
				maskedContent = resPii.maskedText;
				mappingTable = resPii.mappingTable;
				detectedTypes = resPii.types;
				totalMasked = resPii.detectedCount;
			}

			const momPrompt = ChatPromptTemplate.fromMessages([
				[
					"system",
					`Anda adalah Notulis Rapat Eksekutif dan Corporate Secretary Profesional. Tugas Anda adalah mengubah transkrip percakapan langsung / catatan rapat menjadi NOTULENSI RESMI (MINUTES OF MEETING / MoM) yang sangat terstruktur, profesional, dan akurat.

Format Notulensi WAJIB menggunakan struktur Markdown profesional berikut:
### 1. 📌 Informasi & Ringkasan Eksekutif Rapat
- **Topik / Agenda Rapat:** {meetingTopic}
- **Ringkasan Intisari Rapat:** (2-3 paragraf padat mengenai latar belakang, dinamika bahasan, dan hasil akhir pertemuan).

### 2. 🗣️ Poin-Poin Diskusi Kunci & Pembahasan
- Sajikan poin-poin ide, argumen penting, atau evaluasi yang dibahas secara runtut dan jelas.

### 3. 🎯 Keputusan Utama yang Disepakati (Key Decisions)
- Sebutkan semua poin kesepakatan final yang disetujui dalam rapat.

### 4. ✅ Matriks Tindak Lanjut & Action Items (PIC & Deadline)
Buat tabel markdown terstruktur:
| No | Tindakan / Tugas yang Harus Dikerjakan | PIC (Penanggung Jawab) | Tenggat Waktu (Deadline) | Status / Prioritas |
|---|---|---|---|---|
(Isi tabel dengan tugas konkret, nama orang/divisi penanggung jawab, dan tenggat waktunya).

### 5. ⚠️ Isu Tertunda, Kendala & Rencana Tindak Lanjut
- Hal-hal yang belum selesai dan perlu difollow-up pada rapat berikutnya.

### 6. 🌐 Masukan Kebijakan / Kepatuhan Terkait
- Masukan jika ada poin pembahasan yang bersinggungan dengan regulasi eksternal, SOP kerja, atau standar operasional.`,
				],
				[
					"human",
					`=== TOPIK RAPAT: {meetingTopic} ===
=== CATATAN / TRANSKRIP PERCAKAPAN RAPAT ===
{meetingContent}

${customNotes ? `CATATAN TAMBAHAN DARI PENGGUNA:\n${customNotes}` : ""}

Susun Notulensi Rapat (Minutes of Meeting) formal dan terstruktur.`,
				],
			]);

			const chain = momPrompt.pipe(model);

			if (isStream) {
				const streamResult = await chain.stream({
					meetingTopic,
					meetingContent: maskedContent,
				});

				for await (const chunk of streamResult) {
					const textChunk =
						typeof chunk.content === "string"
							? chunk.content
							: chunk.content?.[0]?.text || "";
					if (textChunk) {
						answer += textChunk;
						res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
					}
				}
			} else {
				const resp = await chain.invoke({
					meetingTopic,
					meetingContent: maskedContent,
				});
				answer = resp.content || "";
			}

			if (privacyMode && totalMasked > 0) {
				answer = unmaskSensitiveData(answer, mappingTable);
			}
		}

		if (req.body.saveHistory !== false && req.body.saveHistory !== "false") {
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('user', ?, ?, 'meeting')",
				[`Notulensi Rapat: ${meetingTopic}`, conversationId],
			);
			await db.run(
				"INSERT INTO chat_history (role, content, conversation_id, mode) VALUES ('assistant', ?, ?, 'meeting')",
				[answer, conversationId],
			);
		}

		const estimatedTokens = Math.round(
			((meetingContent.length || 1000) + answer.length) / 4,
		);
		await db.run(
			"INSERT INTO token_usage (total_tokens, api_key_id) VALUES (?, ?)",
			estimatedTokens,
			API_KEY_ID,
		);

		const privacyInfo = {
			isProtected: privacyMode,
			maskedCount: totalMasked,
			detectedTypes,
		};

		if (isStream) {
			res.write(
				`data: ${JSON.stringify({ done: true, answer, conversationId, privacy: privacyInfo, meetingTopic })}\n\n`,
			);
			res.end();
		} else {
			res.json({
				answer,
				conversationId,
				privacy: privacyInfo,
				meetingTopic,
			});
		}
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({ error: error.message });
		} else {
			res.write(
				`data: ${JSON.stringify({ error: error.message, done: true })}\n\n`,
			);
			res.end();
		}
	}
});

// API Get History
app.get("/api/history", async (req, res) => {
	const history = req.query.conversationId
		? await db.all(
				"SELECT role, content, result_json AS resultJson, sql_query AS sqlQuery, COALESCE(mode, 'rag') AS mode, created_at FROM chat_history WHERE conversation_id = ? ORDER BY id ASC",
				req.query.conversationId,
			)
		: await db.all(
				"SELECT role, content, result_json AS resultJson, sql_query AS sqlQuery, COALESCE(mode, 'rag') AS mode, created_at FROM chat_history ORDER BY id ASC",
			);
	res.json(history);
});

app.get("/api/sessions", async (req, res) => {
	const sessions = await db.all(`
		SELECT conversation_id AS id,
		       MIN(id) AS first_message_id,
		       MIN(content) AS title,
		       MAX(created_at) AS updated_at
		FROM chat_history
		WHERE conversation_id IS NOT NULL
		GROUP BY conversation_id
		ORDER BY first_message_id DESC
		LIMIT 50
	`);
	res.json(sessions);
});

// API Get Usage Token
app.get("/api/tokens", async (req, res) => {
	const usage = await getTokenUsage();
	res.json({
		total_tokens: usage.total,
		usage,
		limits: { daily: DAILY_TOKEN_LIMIT, monthly: MONTHLY_TOKEN_LIMIT },
	});
});

// ==========================================
// ARSITEKTUR INTEGRASI: INGESTION PIPELINE
// ==========================================

// 1. Power BI API Ingestion Endpoint
app.post("/api/ingest/powerbi", async (req, res) => {
	try {
		const { datasetName, reportTitle, metrics, tables, summaryText, metadata } = req.body;
		if (!datasetName && !reportTitle) {
			return res.status(400).json({ error: "Nama dataset atau judul laporan Power BI diperlukan." });
		}

		const title = `[Power BI] ${reportTitle || datasetName}`;
		let formattedContent = `# LAPORAN POWER BI: ${reportTitle || datasetName}\n`;
		formattedContent += `Waktu Sinkronisasi: ${new Date().toLocaleString("id-ID")}\n\n`;

		if (summaryText) {
			formattedContent += `### Ringkasan Eksekutif:\n${summaryText}\n\n`;
		}

		if (Array.isArray(metrics) && metrics.length > 0) {
			formattedContent += `### Metrik & KPI Utama:\n`;
			for (const m of metrics) {
				formattedContent += `- **${m.name || m.label}**: ${m.value} ${m.unit || ""} (Target: ${m.target || "-"}, Status: ${m.status || "OK"})\n`;
			}
			formattedContent += "\n";
		}

		if (Array.isArray(tables) && tables.length > 0) {
			formattedContent += `### Data Tabular:\n`;
			for (const t of tables) {
				formattedContent += `#### Tabel: ${t.tableName || "Data"}\n`;
				if (Array.isArray(t.rows) && t.rows.length > 0) {
					const headers = Object.keys(t.rows[0]);
					formattedContent += `| ${headers.join(" | ")} |\n`;
					formattedContent += `| ${headers.map(() => "---").join(" | ")} |\n`;
					for (const row of t.rows.slice(0, 50)) {
						formattedContent += `| ${headers.map((h) => String(row[h] ?? "")).join(" | ")} |\n`;
					}
					formattedContent += "\n";
				}
			}
		}

		// Simpan ke SQLite documents
		const result = await db.run(
			"INSERT INTO documents (title, content) VALUES (?, ?)",
			title,
			formattedContent,
		);
		const docId = result.lastID;

		// Ingest ke Hybrid Vector Store & Qdrant
		if (hybridVectorStore) {
			await hybridVectorStore.ingestDocument({
				docId,
				source: title,
				content: formattedContent,
				metadata: {
					type: "powerbi_telemetry",
					datasetName: datasetName || reportTitle,
					...(metadata || {}),
				},
			});
		}
		await rebuildVectorStore();

		res.status(201).json({
			success: true,
			docId,
			title,
			message: "Data Power BI berhasil di-ingest ke Knowledge Base dan Vector Store.",
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// 2. Batch Document Ingestion Endpoint
app.post("/api/ingest/batch", async (req, res) => {
	try {
		const { documents: batchDocs } = req.body;
		if (!Array.isArray(batchDocs) || batchDocs.length === 0) {
			return res.status(400).json({ error: "Array dokumen diperlukan." });
		}

		const results = [];
		for (const doc of batchDocs) {
			if (!doc.title || !doc.content) continue;
			const r = await db.run(
				"INSERT INTO documents (title, content) VALUES (?, ?)",
				doc.title,
				doc.content,
			);
			if (hybridVectorStore) {
				await hybridVectorStore.ingestDocument({
					docId: r.lastID,
					source: doc.title,
					content: doc.content,
					sections: doc.sections || [],
					metadata: doc.metadata || {},
				});
			}
			results.push({ id: r.lastID, title: doc.title });
		}
		await rebuildVectorStore();

		res.status(201).json({
			success: true,
			count: results.length,
			documents: results,
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// ==========================================
// ARSITEKTUR: ORCHESTRATOR & TOOL PLUGINS
// ==========================================

// 1. Tool Plugin: Draft Memo / Nota Dinas Korporasi PLN
app.post("/api/tools/draft-memo", async (req, res) => {
	try {
		const {
			perihal,
			tujuan,
			latarBelakang,
			poinKeputusan,
			urgensi = "Biasa",
			dokumenRujukan,
			privacyMode = true,
		} = req.body;

		if (!perihal || !tujuan) {
			return res.status(400).json({ error: "Perihal dan Tujuan Nota Dinas wajib diisi." });
		}

		let promptInput = `PERIHAL: ${perihal}
TUJUAN/KEPADA: ${tujuan}
URGENSI/SIFAT: ${urgensi}
LATAR BELAKANG: ${latarBelakang || "-"}
POIN KEPUTUSAN / PERTIMBANGAN: ${poinKeputusan || "-"}
DOKUMEN RUJUKAN: ${dokumenRujukan || "Pedoman Tata Kelola Korporat PT PLN Indonesia Power Renewables"}`;

		let mappingTable = {};
		if (privacyMode) {
			const resInput = maskSensitiveData(promptInput);
			promptInput = resInput.maskedText;
			mappingTable = resInput.mappingTable;
		}

		const memoPrompt = ChatPromptTemplate.fromMessages([
			[
				"system",
				`Anda adalah Sekretaris Perusahaan & Analis Legal Senior di PT PLN Indonesia Power Renewables.
Tugas Anda adalah menyusun DRAFT NOTA DINAS RESMI yang elegan, profesional, berbobot hukum, dan sesuai dengan Tata Naskah Dinas PLN.

Gunakan struktur standar berikut:
\`\`\`
PT PLN INDONESIA POWER RENEWABLES
KANTOR PUSAT - JAKARTA
-----------------------------------------------------------------------------
                              NOTA DINAS
                       Nomor: ND-XXX/IP-REN/SEC/${new Date().getFullYear()}

Kepada       : [Tujuan]
Dari         : Divisi Terkait / Pemohon
Tanggal      : ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
Sifat        : [Sifat Dokumen]
Lampiran     : 1 (Satu) Berkas
Perihal      : [Perihal]
-----------------------------------------------------------------------------

1. DASAR / RUJUKAN:
   (Sebutkan dasar regulasi, RKAP, atau referensi relevan)

2. LATAR BELAKANG & ANALISIS PERMASALAHAN:
   (Paparkan urgensi, situasi operasional/bisnis, dan fakta lapangan)

3. PERTIMBANGAN BISNIS, TEKNIS, & FINANSIAL:
   (Paparkan analisis dampak finansial, mitigasi risiko, dan kepatuhan)

4. KESIMPULAN & REKOMENDASI DISPOSISI:
   (Berikan poin keputusan konkret yang dimohonkan persetujuannya)

Demikian disampaikan, atas arahan dan persetujuan Bapak/Ibu diucapkan terima kasih.


[Nama Pejabat / Kepala Divisi]
Jabatan Penandatangan
\`\`\``,
			],
			["human", "Susunkan Draft Nota Dinas berdasarkan data berikut:\n{input}"],
		]);

		const chain = memoPrompt.pipe(model);
		const result = await chain.invoke({ input: promptInput });
		let finalContent = result.content || "";

		if (privacyMode && Object.keys(mappingTable).length > 0) {
			finalContent = unmaskSensitiveData(finalContent, mappingTable);
		}

		res.json({
			success: true,
			draftNotaDinas: finalContent,
			metadata: { perihal, tujuan, generatedAt: new Date().toISOString() },
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// 2. Tool Plugin: Compliance Review & Policy Feedback Loop
app.post("/api/tools/compliance-review", async (req, res) => {
	try {
		const { documentText, policyFocus = "Umum", privacyMode = true } = req.body;
		if (!documentText) {
			return res.status(400).json({ error: "Teks dokumen yang akan direview wajib disertakan." });
		}

		let maskedText = documentText;
		let mappingTable = {};
		if (privacyMode) {
			const resMask = maskSensitiveData(documentText);
			maskedText = resMask.maskedText;
			mappingTable = resMask.mappingTable;
		}

		const compliancePrompt = ChatPromptTemplate.fromMessages([
			[
				"system",
				`Anda adalah Chief Compliance Officer (CCO) & Legal Auditor di PT PLN Indonesia Power Renewables.
Tugas Anda adalah melakukan audit kepatuhan (*Compliance Review*) dan memberikan masukan kebijakan (*Policy Feedback Loop*) terhadap dokumen atau kontrak yang diunggah.

Analisis dokumen terhadap:
1. Regulasi Transisi Energi & Permen ESDM terkait tarif dan operasional EBT.
2. UU Perlindungan Data Pribadi (UU PDP No. 27/2022).
3. Good Corporate Governance (GCG) & Standar Kepatuhan Finansial PLN.
4. Mitigasi Risiko Klausul Kontrak (Liabilitas, Batas Denda/Penalty Cap, Force Majeure).

Berikan output dengan format:
### 1. 🛡️ Skor Kepatuhan & Status Kesiapan
- Skor Kepatuhan: [0-100%]
- Status: [SESUAI / CATATAN MINOR / RISIKO TINGGI / TIDAK MEMENUHI]

### 2. ⚠️ Temuan Kritis & Red Flags
(Tuliskan poin-poin klausul yang berisiko merugikan korporasi)

### 3. 🌐 Ulasan Keselarasan Regulasi Eksternal
(Sebutkan pasal/undang-undang yang menjadi rujukan)

### 4. 💡 Rekomendasi Revisi & Policy Feedback Loop
(Klausul alternatif yang disarankan untuk ditambahkan/diubah)`,
			],
			["human", "FOKUS AUDIT: {focus}\n\nISI DOKUMEN:\n{doc}"],
		]);

		const chain = compliancePrompt.pipe(model);
		const result = await chain.invoke({ focus: policyFocus, doc: maskedText.slice(0, 35000) });
		let finalReview = result.content || "";

		if (privacyMode && Object.keys(mappingTable).length > 0) {
			finalReview = unmaskSensitiveData(finalReview, mappingTable);
		}

		res.json({
			success: true,
			reviewResult: finalReview,
			auditedAt: new Date().toISOString(),
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

// 3. Tool Plugin: Corporate & Financial Analysis
app.post("/api/tools/corporate-analysis", async (req, res) => {
	try {
		const { aspect = "all", tahun = 2025 } = req.body;

		// Ambil data tabular dari SQLite
		const kpis = await db.all("SELECT * FROM corporate_kpis WHERE tahun = ? ORDER BY kategori, id ASC", tahun);
		const financial = await db.all("SELECT * FROM financial_performance WHERE tahun = ? ORDER BY id ASC", tahun);
		const projects = await db.all("SELECT * FROM renewable_projects ORDER BY kapasitas_mw DESC");

		const prompt = ChatPromptTemplate.fromMessages([
			[
				"system",
				`Anda adalah Analis Keuangan dan Kinerja Korporat Senior PT PLN Indonesia Power Renewables.
Sajikan analisis eksekutif mendalam mencakup:
1. Ringkasan Kinerja Finansial (Pertumbuhan Pendapatan, EBITDA Margin, Efisiensi OPEX/CAPEX, Net Margin).
2. Evaluasi KPI Korporat & ESG (Capaian Target vs Realisasi, Reduksi Emisi CO2, Keandalan Pembangkit).
3. Analisis Portofolio Proyek EBT (Kapasitas Terpasang, LCOE per Pembangkit, Nilai Investasi).
4. Rekomendasi Strategis untuk Kuartal/Tahun Mendatang.`,
			],
			[
				"human",
				`DATA KEUANGAN ${tahun}:\n${JSON.stringify(financial, null, 2)}\n\nDATA KPI ${tahun}:\n${JSON.stringify(kpis, null, 2)}\n\nPORTOFOLIO PROYEK EBT:\n${JSON.stringify(projects, null, 2)}`,
			],
		]);

		const chain = prompt.pipe(model);
		const result = await chain.invoke({});

		res.json({
			success: true,
			tahun,
			analysis: result.content,
			data: { financial, kpis, projects },
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

app.use((error, req, res, next) => {
	if (error instanceof multer.MulterError) {
		return res.status(400).json({
			error:
				error.code === "LIMIT_FILE_SIZE"
					? "Ukuran file terlalu besar. Maksimal 20 MB."
					: error.message,
		});
	}
	res.status(500).json({ error: error.message || "Kesalahan server." });
});

async function getTokenUsage() {
	const result = await db.get(
		`
		SELECT
			COALESCE(SUM(total_tokens), 0) AS total,
			COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN total_tokens ELSE 0 END), 0) AS daily,
			COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN total_tokens ELSE 0 END), 0) AS monthly
		FROM token_usage
		WHERE api_key_id = ?
	`,
		API_KEY_ID,
	);
	return {
		total: Number(result.total),
		daily: Number(result.daily),
		monthly: Number(result.monthly),
	};
}

const PORT = process.env.PORT || 3006;
app.listen(PORT, async () => {
	await init();
	console.log(`Server aktif di http://localhost:${PORT}`);
});
