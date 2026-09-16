/**
 * Enterprise Hybrid Vector Store & Ingestion Pipeline
 * Sesuai Arsitektur: Dense Vector (BGE/Private Embedding) + Sparse Vector (TF-IDF/BM25) + Qdrant + Adjacent Chunk Query + Reranking
 */

import { randomUUID } from "node:crypto";

export class HybridVectorStore {
	constructor(options = {}) {
		this.qdrantUrl = options.qdrantUrl || process.env.QDRANT_URL || null;
		this.collectionName = options.collectionName || process.env.QDRANT_COLLECTION || "pln_renewables_kb";
		this.embeddingUrl = options.embeddingUrl || process.env.FASTAPI_EMBEDDING_URL || process.env.EMBEDDING_API_URL || null;
		this.rerankerUrl = options.rerankerUrl || process.env.RERANKER_API_URL || null;
		this.vectorDimension = options.vectorDimension || 384; // Default BGE-small-en/id dimension
		this.db = options.db || null; // SQLite DB instance for persistent chunks & metadata
		this.inMemoryChunks = [];
		this.initialized = false;
		this.warnedEmbedding = false;
		this.warnedQdrant = false;
		this.isQdrantOnline = false;
	}

	async init() {
		if (this.initialized) return;

		// 1. Inisialisasi SQLite chunks table jika belum ada
		if (this.db) {
			await this.db.exec(`
				CREATE TABLE IF NOT EXISTS rag_chunks_hybrid (
					id TEXT PRIMARY KEY,
					doc_id INTEGER,
					source TEXT,
					section_title TEXT,
					chunk_index INTEGER,
					total_chunks INTEGER,
					content TEXT,
					metadata_json TEXT,
					sparse_terms_json TEXT,
					dense_vector_json TEXT,
					created_at DATETIME DEFAULT CURRENT_TIMESTAMP
				);
			`);

			// Load existing chunks into cache for ultra-fast BM25 & Adjacent retrieval
			const rows = await this.db.all("SELECT * FROM rag_chunks_hybrid ORDER BY doc_id, chunk_index ASC");
			this.inMemoryChunks = rows.map((r) => ({
				id: r.id,
				docId: r.doc_id,
				source: r.source,
				sectionTitle: r.section_title,
				chunkIndex: r.chunk_index,
				totalChunks: r.total_chunks,
				content: r.content,
				metadata: JSON.parse(r.metadata_json || "{}"),
				sparseTerms: JSON.parse(r.sparse_terms_json || "{}"),
				denseVector: r.dense_vector_json ? JSON.parse(r.dense_vector_json) : null,
			}));
		}

		// 2. Cek koneksi Qdrant jika URL disediakan
		if (this.qdrantUrl) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 1500);
				const checkRes = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`, { signal: controller.signal });
				clearTimeout(timeoutId);

				if (checkRes.status === 404) {
					await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`, {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							vectors: {
								size: this.vectorDimension,
								distance: "Cosine",
							},
						}),
					});
				}
				this.isQdrantOnline = true;
				console.log(`[Vector Store] Terhubung ke Qdrant Cluster di ${this.qdrantUrl}`);
			} catch (err) {
				this.isQdrantOnline = false;
				if (!this.warnedQdrant) {
					console.log(`[Vector Store] Mode Aktif: Hybrid SQLite & In-Memory (Stand-Alone Siap).`);
					this.warnedQdrant = true;
				}
			}
		}

		this.initialized = true;
	}

	/**
	 * Menghasilkan Sparse Vector (TF-IDF / Term Frequency)
	 */
	computeSparseVector(text) {
		const terms = {};
		if (!text) return terms;
		const tokens = text
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 2);

		const totalTokens = tokens.length || 1;
		for (const token of tokens) {
			terms[token] = (terms[token] || 0) + 1;
		}

		// Normalize term frequency
		for (const term in terms) {
			terms[term] = Number((terms[term] / totalTokens).toFixed(4));
		}
		return terms;
	}

	/**
	 * Menghasilkan Dense Vector Embedding (via FastAPI BGE, Private vLLM, atau fallback)
	 */
	async computeDenseVector(text) {
		if (this.embeddingUrl) {
			try {
				const response = await fetch(this.embeddingUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ input: text, texts: [text] }),
				});
				if (response.ok) {
					const data = await response.json();
					if (Array.isArray(data.embedding)) return data.embedding;
					if (Array.isArray(data.data?.[0]?.embedding)) return data.data[0].embedding;
					if (Array.isArray(data.embeddings?.[0])) return data.embeddings[0];
				}
			} catch (err) {
				if (!this.warnedEmbedding) {
					console.log(`[Embedding API] Service ${this.embeddingUrl} offline. Menggunakan Hybrid Semantic Vector bawaan.`);
					this.warnedEmbedding = true;
				}
			}
		}

		// Fallback Dense Embedding: Normalized Semantic Hash Feature Vector
		const vector = new Array(this.vectorDimension).fill(0);
		const words = text.toLowerCase().split(/\W+/).filter(Boolean);
		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			let hash = 0;
			for (let j = 0; j < word.length; j++) {
				hash = (hash << 5) - hash + word.charCodeAt(j);
				hash |= 0;
			}
			const idx = Math.abs(hash) % this.vectorDimension;
			vector[idx] += 1.0;
		}
		// L2 Normalization
		const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
		return vector.map((v) => Number((v / norm).toFixed(6)));
	}

	/**
	 * Ingestion Pipeline: Ekstraksi Dokumen -> Section Extraction -> Chunking -> Metadata -> Vector Storage
	 */
	async ingestDocument({ docId, source, content, sections = [], metadata = {} }) {
		await this.init();

		// Jika sections tidak disertakan, buat otomatis berdasarkan heading/paragraf
		const extractedSections = sections.length > 0 ? sections : this.extractSections(content);
		const chunksToInsert = [];

		let globalChunkIdx = 0;
		for (const sec of extractedSections) {
			const secChunks = this.splitIntoChunks(sec.text, 500, 100);
			for (let i = 0; i < secChunks.length; i++) {
				const chunkText = secChunks[i];
				const chunkId = randomUUID();
				const sparseTerms = this.computeSparseVector(chunkText);
				const denseVector = await this.computeDenseVector(chunkText);

				const chunkMetadata = {
					...metadata,
					docId,
					source,
					sectionTitle: sec.title || "Umum",
					chunkIndex: globalChunkIdx,
					charCount: chunkText.length,
					wordCount: chunkText.split(/\s+/).length,
					createdAt: new Date().toISOString(),
				};

				chunksToInsert.push({
					id: chunkId,
					docId,
					source,
					sectionTitle: sec.title || "Umum",
					chunkIndex: globalChunkIdx,
					content: chunkText,
					metadata: chunkMetadata,
					sparseTerms,
					denseVector,
				});

				globalChunkIdx++;
			}
		}

		// Set total chunks untuk setiap chunk metadata
		for (const chunk of chunksToInsert) {
			chunk.totalChunks = chunksToInsert.length;
			chunk.metadata.totalChunks = chunksToInsert.length;
		}

		// Simpan ke SQLite
		if (this.db) {
			for (const c of chunksToInsert) {
				await this.db.run(
					`INSERT OR REPLACE INTO rag_chunks_hybrid 
					(id, doc_id, source, section_title, chunk_index, total_chunks, content, metadata_json, sparse_terms_json, dense_vector_json)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						c.id,
						c.docId,
						c.source,
						c.sectionTitle,
						c.chunkIndex,
						c.totalChunks,
						c.content,
						JSON.stringify(c.metadata),
						JSON.stringify(c.sparseTerms),
						JSON.stringify(c.denseVector),
					],
				);
			}
		}

		// Upsert ke Qdrant jika terhubung
		if (this.qdrantUrl && this.isQdrantOnline) {
			try {
				const points = chunksToInsert.map((c) => ({
					id: c.id,
					vector: c.denseVector,
					payload: {
						docId: c.docId,
						source: c.source,
						sectionTitle: c.sectionTitle,
						chunkIndex: c.chunkIndex,
						content: c.content,
						metadata: c.metadata,
						sparseTerms: c.sparseTerms,
					},
				}));

				await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ points }),
				});
			} catch (err) {
				// Silent fallback to SQLite
			}
		}

		// Update in-memory cache
		this.inMemoryChunks.push(...chunksToInsert);
		return chunksToInsert;
	}

	/**
	 * Ekstraksi Seksi Dokumen berdasarkan Heading Markdown/Format
	 */
	extractSections(text) {
		if (!text) return [{ title: "Utama", text: "" }];
		const lines = text.split("\n");
		const sections = [];
		let currentTitle = "Pendahuluan";
		let currentLines = [];

		for (const line of lines) {
			if (line.match(/^#{1,4}\s+(.+)$/) || line.match(/^[A-Z0-9.\s]{4,40}:$/)) {
				if (currentLines.length > 0) {
					sections.push({ title: currentTitle, text: currentLines.join("\n").trim() });
					currentLines = [];
				}
				currentTitle = line.replace(/^#{1,4}\s+/, "").replace(/:$/, "").trim();
			} else {
				currentLines.push(line);
			}
		}

		if (currentLines.length > 0) {
			sections.push({ title: currentTitle, text: currentLines.join("\n").trim() });
		}

		return sections.length > 0 ? sections : [{ title: "Utama", text }];
	}

	/**
	 * Pemotong Teks Menjadi Chunks dengan Overlap
	 */
	splitIntoChunks(text, chunkSize = 500, overlap = 100) {
		if (!text) return [];
		if (text.length <= chunkSize) return [text];

		const chunks = [];
		let start = 0;
		while (start < text.length) {
			let end = start + chunkSize;
			if (end < text.length) {
				// Cari batas kalimat terdekat
				const nextPeriod = text.indexOf(". ", end - 50);
				const nextNewline = text.indexOf("\n", end - 50);
				if (nextPeriod !== -1 && nextPeriod < end + 50) {
					end = nextPeriod + 1;
				} else if (nextNewline !== -1 && nextNewline < end + 50) {
					end = nextNewline + 1;
				}
			}
			chunks.push(text.slice(start, end).trim());
			start = end - overlap;
			if (start >= text.length - overlap) break;
		}
		return chunks;
	}

	/**
	 * Cosine Similarity Perhitungan
	 */
	cosineSimilarity(vecA, vecB) {
		if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
		let dot = 0;
		let normA = 0;
		let normB = 0;
		for (let i = 0; i < vecA.length; i++) {
			dot += vecA[i] * vecB[i];
			normA += vecA[i] * vecA[i];
			normB += vecB[i] * vecB[i];
		}
		if (normA === 0 || normB === 0) return 0;
		return dot / (Math.sqrt(normA) * Math.sqrt(normB));
	}

	/**
	 * BM25 / Sparse Keyword Matching Score
	 */
	computeBM25Score(queryTerms, docTerms) {
		let score = 0;
		for (const term in queryTerms) {
			if (docTerms[term]) {
				score += queryTerms[term] * (docTerms[term] * 2.0);
			}
		}
		return score;
	}

	/**
	 * Hybrid Search: Cosine Similarity + BM25 + Query Adjacent Chunks + Reranking
	 */
	async search({ query, filterDocId = null, topK = 4, includeAdjacent = true }) {
		await this.init();
		if (this.inMemoryChunks.length === 0) return [];

		const queryDense = await this.computeDenseVector(query);
		const querySparse = this.computeSparseVector(query);

		// 1. Cari kandidat (Top K x 2) dengan Hybrid Score (Cosine + BM25)
		const scoredChunks = [];
		for (const chunk of this.inMemoryChunks) {
			if (filterDocId && Number(chunk.docId) !== Number(filterDocId)) {
				continue;
			}

			const denseScore = this.cosineSimilarity(queryDense, chunk.denseVector);
			const sparseScore = this.computeBM25Score(querySparse, chunk.sparseTerms);
			// Hybrid Score = 70% Dense Semantic + 30% Sparse BM25
			const hybridScore = denseScore * 0.7 + sparseScore * 0.3;

			scoredChunks.push({
				...chunk,
				score: hybridScore,
				denseScore,
				sparseScore,
			});
		}

		// Urutkan berdasarkan score tertinggi
		scoredChunks.sort((a, b) => b.score - a.score);
		const topCandidates = scoredChunks.slice(0, topK * 2);

		if (topCandidates.length === 0) return [];

		// 2. Query Adjacent Chunks (Ambil potongan sebelum dan sesudah untuk konteks yang utuh)
		let expandedChunks = [...topCandidates];
		if (includeAdjacent) {
			const chunkMap = new Map();
			for (const c of this.inMemoryChunks) {
				chunkMap.set(`${c.docId}_${c.chunkIndex}`, c);
			}

			const enrichedSet = new Set();
			for (const candidate of topCandidates) {
				enrichedSet.add(`${candidate.docId}_${candidate.chunkIndex}`);

				// Ambil chunk sebelumnya (index - 1)
				const prevKey = `${candidate.docId}_${candidate.chunkIndex - 1}`;
				if (candidate.chunkIndex > 0 && chunkMap.has(prevKey) && !enrichedSet.has(prevKey)) {
					const prevChunk = chunkMap.get(prevKey);
					expandedChunks.push({ ...prevChunk, isAdjacent: true, score: candidate.score * 0.85 });
					enrichedSet.add(prevKey);
				}

				// Ambil chunk setelahnya (index + 1)
				const nextKey = `${candidate.docId}_${candidate.chunkIndex + 1}`;
				if (chunkMap.has(nextKey) && !enrichedSet.has(nextKey)) {
					const nextChunk = chunkMap.get(nextKey);
					expandedChunks.push({ ...nextChunk, isAdjacent: true, score: candidate.score * 0.85 });
					enrichedSet.add(nextKey);
				}
			}
		}

		// 3. Reranking (via FastAPI BGE Reranker API jika aktif, atau fallback sorting)
		let finalRanked = expandedChunks;
		if (this.rerankerUrl) {
			try {
				const rerankResp = await fetch(this.rerankerUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						query,
						passages: expandedChunks.map((c) => c.content),
					}),
				});
				if (rerankResp.ok) {
					const rerankData = await rerankResp.json();
					if (Array.isArray(rerankData.scores)) {
						finalRanked = expandedChunks.map((c, i) => ({
							...c,
							rerankScore: rerankData.scores[i] || c.score,
						})).sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
					}
				}
			} catch (err) {
				console.warn(`[Reranker] Gagal memanggil ${this.rerankerUrl}:`, err.message);
			}
		}

		// Ambil Top-K hasil akhir
		return finalRanked.slice(0, topK * (includeAdjacent ? 2 : 1));
	}
}
