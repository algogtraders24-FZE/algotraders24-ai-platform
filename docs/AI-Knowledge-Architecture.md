# AI Knowledge Base (RAG) Foundation

Enterprise knowledge base and the architecture for future Retrieval-Augmented Generation. Mock/in-memory only — no vector DB, no embeddings, no external APIs yet.

## Architecture

Query -> KnowledgeEngine -> Retriever -> SearchService -> ContextBuilder -> (future) Gemini -> answer.

The dashboard talks only to KnowledgeEngine (facade) and the Manager, never to lower services.

## Folder Structure

- services/knowledge — nine services (Engine, Manager, Indexer, Retriever, SearchService, ContextBuilder, CollectionService, DocumentService, EmbeddingService).
- components/knowledge — Card, Grid, Search, Categories, Collections, Details, Metrics, History, Uploader, Sources.
- types/knowledge.ts, config/knowledge.config.ts, data/mock-knowledge.ts, app/dashboard/knowledge/page.tsx.

## Services

- KnowledgeDocumentService — repository over documents (CRUD, filters).
- KnowledgeCollectionService — collections with live document counts.
- KnowledgeEmbeddingService — embedding foundation; mock similarity today.
- KnowledgeIndexer — simulates indexing (status + embedding).
- KnowledgeSearchService — scores documents against a query.
- KnowledgeRetriever — retrieves top docs and records retrieval history.
- KnowledgeContextBuilder — assembles retrieved docs into a context block, capped by config.
- KnowledgeManager — library management: list, filter, upload, re-index.
- KnowledgeEngine — facade: buildKnowledgeContext (RAG entry), metrics, related docs.

## Data Flow

1. User searches or asks a question.
2. Retriever calls SearchService to score documents.
3. Top results are recorded in retrieval history.
4. ContextBuilder concatenates them into a bounded context string.
5. (Future) The context is passed to the Gemini provider to answer.

## Future RAG Integration

buildKnowledgeContext already returns a KnowledgeContext (query + docs + contextText). A future step sends contextText through the existing Prompt Engine and Gemini provider — no UI or type change.

## Future Vector Database

DocumentService and the mock store are separated from consumers. Swapping in a vector DB (Pinecone, Weaviate, pgvector, Qdrant) changes only the document/embedding/search services.

## Future Embedding Pipeline

EmbeddingService.embedDocument is simulated. A real pipeline chunks text, calls an embedding model, and stores vectors. mockSimilarity is replaced by real cosine similarity. The Retriever and ContextBuilder stay unchanged.