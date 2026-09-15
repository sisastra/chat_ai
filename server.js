import express from "express";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import {
	ChatGoogleGenerativeAI,
	GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));
const DAILY_TOKEN_LIMIT = Number(process.env.DAILY_TOKEN_LIMIT || 10000);
const MONTHLY_TOKEN_LIMIT = Number(process.env.MONTHLY_TOKEN_LIMIT || 100000);
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
let ragDocs = [];

// Inisialisasi model Gemini Flash yang masih tersedia di API.
const model = new ChatGoogleGenerativeAI({
	modelName: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
	apiKey: process.env.GEMINI_API_KEY,
	temperature: 0.1,
});

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
			`Vector Store Gemini tidak tersedia, memakai retrieval lokal: ${error.message}`,
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
					`PDF "${fileName}" tidak berisi teks yang dapat dibaca. Gunakan PDF searchable atau file .txt/.md/.csv/.json.`,
				);
			}
			return content;
		} catch (error) {
			throw new Error(
				`Gagal membaca PDF "${fileName}". Pastikan file bukan hasil scan gambar dan memiliki teks yang bisa dibaca.`,
			);
		}
	}

	const content = file.buffer.toString("utf8").trim();
	if (!content) {
		throw new Error(`Dokumen "${fileName}" kosong atau tidak bisa dibaca.`);
	}
	return content;
}

app.post("/api/documents", upload.single("document"), async (req, res) => {
	try {
		if (!req.file) {
			return res
				.status(400)
				.json({ error: "Pilih file dokumen terlebih dahulu." });
		}
		const extension = (
			req.file.originalname.split(".").pop() || ""
		).toLowerCase();
		const supportedExtensions = ["txt", "md", "csv", "json", "pdf"];
		if (!supportedExtensions.includes(extension)) {
			return res.status(400).json({
				error: "Format yang didukung: .pdf, .txt, .md, .csv, dan .json.",
			});
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

// API Chat Endpoint
app.post("/api/chat", async (req, res) => {
	try {
		const { message, mode, question, documentId, docId, stream: clientStream } = req.body;
		const isStream =
			clientStream === true ||
			req.headers.accept?.includes("text/event-stream");
		const rawMode = String(mode ?? "").toLowerCase();
		const userMessage = message ?? question ?? "";
		const resolvedMode = rawMode === "sql" ? "sql" : "rag";
		const selectedDocId = documentId || docId || null;
		const conversationId = req.body.conversationId || randomUUID();
		const usage = await getTokenUsage();
		const requestReserve = Math.ceil(String(userMessage).length / 4) + 1000;
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

		// Simpan input user
		await db.run(
			"INSERT INTO chat_history (role, content, conversation_id) VALUES ('user', ?, ?)",
			[userMessage, conversationId],
		);

		let answer = "";
		let rows = null;
		let sqlQuery = null;
		let sources = [];

		if (resolvedMode === "rag") {
			// MODE RAG (Cek Dokumen)
			if (ragDocs.length === 0) {
				answer =
					"Belum ada dokumen yang diunggah ke knowledge base. Silakan unggah dokumen (.pdf, .txt, .md, .csv, .json) terlebih dahulu melalui panel Dokumen RAG di atas.";
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

					if (isSpecificDoc) {
						const numericId = Number(selectedDocId);
						const docChunks = ragDocs.filter(
							(d) => d.metadata.docId === numericId,
						);

						if (docChunks.length === 0) {
							contextDocs = ragDocs.slice(0, 6);
						} else if (docChunks.length <= 8) {
							// LANGSUNG MEMORI: Skip ekstra network roundtrip ke embeddings API
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

					const prompt = ChatPromptTemplate.fromMessages([
						[
							"system",
							"Anda adalah asisten AI yang cerdas, teliti, dan ramah yang bertugas menganalisis dokumen. Jawab pertanyaan pengguna HANYA dalam bahasa natural (Bahasa Indonesia) berdasarkan dokumen yang diberikan. DILARANG KERAS menghasilkan kueri SQL, perintah SELECT/database, atau format kode database apapun.",
						],
						[
							"human",
							"Konteks Dokumen:\n<context>\n{context}\n</context>\n\nPertanyaan Pengguna: {input}\n\nJawablah berdasarkan isi dokumen di atas secara jelas, informatif, dan terstruktur:",
						],
					]);

					const chain = prompt.pipe(model);

					if (isStream) {
						const streamResponse = await chain.stream({
							context: formattedContext,
							input: userMessage,
						});
						for await (const chunk of streamResponse) {
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
						const response = await chain.invoke({
							context: formattedContext,
							input: userMessage,
						});
						answer = response.content || "";
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
