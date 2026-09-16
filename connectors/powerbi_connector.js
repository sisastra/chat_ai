/**
 * Power BI & ERP Webhook / REST Connector
 * Memungkinkan Power BI Report, Power Automate, atau API Aplikasi Lain mengirim telemetri langsung ke AI.
 */

export class PowerBIConnector {
	constructor(config = {}) {
		this.ingestEndpoint = config.ingestEndpoint || "http://localhost:3006/api/ingest/powerbi";
	}

	/**
	 * Mengirim laporan / dataset dari Power BI ke AI Ingestion Pipeline
	 */
	async sendReportToAI({
		datasetName,
		reportTitle,
		summaryText = "",
		metrics = [],
		tables = [],
		metadata = {},
	}) {
		try {
			const response = await fetch(this.ingestEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					datasetName,
					reportTitle,
					summaryText,
					metrics,
					tables,
					metadata,
				}),
			});
			return await response.json();
		} catch (error) {
			console.error(`[PowerBI Connector] Gagal sinkronisasi data:`, error.message);
			throw error;
		}
	}
}
