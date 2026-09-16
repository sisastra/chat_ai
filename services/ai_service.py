"""
FastAPI Microservice: Dense Vector Embedding & Reranking Service
Sesuai Arsitektur: BAAI/bge-small-en-v1.5 & BAAI/bge-reranker-base
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import uvicorn

app = FastAPI(
    title="Renewables AI - Embedding & Reranker Service",
    version="1.0.0",
    description="FastAPI Microservice for Dense Embeddings and Re-ranking in Enterprise RAG",
)

# Inisialisasi Model Embedding & Reranker
embedding_model = None
reranker_model = None

try:
    from sentence_transformers import SentenceTransformer, CrossEncoder
    EMBED_MODEL_NAME = os.getenv("EMBED_MODEL_NAME", "BAAI/bge-small-en-v1.5")
    RERANK_MODEL_NAME = os.getenv("RERANK_MODEL_NAME", "BAAI/bge-reranker-base")
    
    print(f"[AI Service] Loading Embedding Model: {EMBED_MODEL_NAME}...")
    embedding_model = SentenceTransformer(EMBED_MODEL_NAME)
    
    print(f"[AI Service] Loading Reranker Model: {RERANK_MODEL_NAME}...")
    reranker_model = CrossEncoder(RERANK_MODEL_NAME)
    print("[AI Service] Models loaded successfully.")
except Exception as e:
    print(f"[AI Service] Warning: PyTorch / Sentence-Transformers not installed or failed to load ({e}).")
    print("[AI Service] Fallback heuristic embedding mode active.")


class EmbeddingRequest(BaseModel):
    input: Optional[str] = None
    texts: Optional[List[str]] = None


class RerankRequest(BaseModel):
    query: str
    passages: List[str]
    top_k: Optional[int] = None


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "embedding_model": EMBED_MODEL_NAME if embedding_model else "heuristic_fallback",
        "reranker_model": RERANK_MODEL_NAME if reranker_model else "heuristic_fallback",
    }


@app.post("/embeddings")
def get_embeddings(req: EmbeddingRequest):
    texts_to_embed = req.texts or ([req.input] if req.input else [])
    if not texts_to_embed:
        raise HTTPException(status_code=400, detail="Input text or texts array required.")

    if embedding_model:
        embeddings = embedding_model.encode(texts_to_embed, normalize_embeddings=True).tolist()
        return {"embeddings": embeddings, "dimension": len(embeddings[0]) if embeddings else 384}
    
    # Fallback jika model belum diunduh (Deterministic Semantic Hash Normalization)
    dim = 384
    embeddings = []
    for text in texts_to_embed:
        vector = [0.0] * dim
        words = text.lower().split()
        for w in words:
            h = abs(hash(w)) % dim
            vector[h] += 1.0
        norm = sum(v * v for v in vector) ** 0.5 or 1.0
        embeddings.append([round(v / norm, 6) for v in vector])

    return {"embeddings": embeddings, "dimension": dim, "mode": "fallback"}


@app.post("/rerank")
def rerank_passages(req: RerankRequest):
    if not req.query or not req.passages:
        raise HTTPException(status_code=400, detail="Query and passages are required.")

    if reranker_model:
        pairs = [[req.query, passage] for passage in req.passages]
        scores = reranker_model.predict(pairs).tolist()
        return {"scores": scores, "count": len(scores)}

    # Fallback Reranking: Term overlap scoring
    q_words = set(req.query.lower().split())
    scores = []
    for passage in req.passages:
        p_words = set(passage.lower().split())
        overlap = len(q_words.intersection(p_words))
        score = overlap / max(len(q_words), 1)
        scores.append(round(score, 4))

    return {"scores": scores, "count": len(scores), "mode": "fallback"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
