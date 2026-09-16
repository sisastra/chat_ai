/**
 * Enterprise Database Connector & ETL Ingestion Pipeline
 * Berfungsi menghubungkan database eksternal (PostgreSQL, MySQL, SQL Server, Oracle, SQLite)
 * untuk diekstrak, dibuatkan metadata, dan diindeks ke dalam Vector Store / Knowledge Base AI.
 */

export class EnterpriseDBConnector {
	constructor(config = {}) {
		this.type = config.type || "sqlite"; // postgres | mysql | mssql | oracle | sqlite
		this.connectionString = config.connectionString || process.env.EXTERNAL_DB_URL || null;
		this.apiEndpoint = config.apiEndpoint || "http://localhost:3006/api/ingest/batch";
	}

	/**
	 * Transformasi hasil kueri SQL menjadi dokumen terstruktur yang siap di-ingest ke AI
	 */
	transformRowsToDocument({ title, category, rows, description = "" }) {
		if (!Array.isArray(rows) || rows.length === 0) {
			return null;
		}

		const headers = Object.keys(rows[0]);
		let content = `# LAPORAN TABULAR TERINTEGRASI: ${title}\n`;
		content += `Kategori: ${category || "Umum"}\n`;
		content += `Waktu Sinkronisasi: ${new Date().toLocaleString("id-ID")}\n`;
		if (description) {
			content += `Deskripsi: ${description}\n\n`;
		}

		content += `### Data Terstruktur (${rows.length} Baris Data):\n`;
		content += `| ${headers.join(" | ")} |\n`;
		content += `| ${headers.map(() => "---").join(" | ")} |\n`;

		for (const row of rows) {
			content += `| ${headers.map((h) => String(row[h] ?? "")).join(" | ")} |\n`;
		}

		return {
			title: `[DB ${this.type.toUpperCase()}] ${title}`,
			content,
			metadata: {
				sourceType: "database_etl",
				dbType: this.type,
				rowCount: rows.length,
				syncedAt: new Date().toISOString(),
			},
		};
	}

	/**
	 * Kirim dokumen hasil ekstraksi database ke Ingestion Pipeline AI
	 */
	async pushToAIKnowledgeBase(documents) {
		const payloadDocs = Array.isArray(documents) ? documents : [documents];
		try {
			const res = await fetch(this.apiEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ documents: payloadDocs }),
			});
			return await res.json();
		} catch (error) {
			console.error(`[DB Connector] Gagal mengirim data ke AI:`, error.message);
			throw error;
		}
	}
}
