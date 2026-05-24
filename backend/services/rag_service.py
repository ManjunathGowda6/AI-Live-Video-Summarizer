import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

class RAGService:
    def __init__(self):
        # Using a lightweight sentence embedding model
        # For production, can use OpenAI or more robust HuggingFace models
        try:
            self.model = SentenceTransformer('all-MiniLM-L6-v2') 
        except:
            self.model = None
            
        self.dimension = 384 # embedding size for MiniLM
        self.index = faiss.IndexFlatL2(self.dimension)
        self.chunks = []
        
    def add_to_index(self, text: str):
        if not self.model: return
        embed = self.model.encode([text])
        self.index.add(np.array(embed).astype('float32'))
        self.chunks.append(text)
        
    def query(self, question: str, k: int = 3):
        if not self.model or self.index.ntotal == 0: return []
        
        embed = self.model.encode([question])
        distances, indices = self.index.search(np.array(embed).astype('float32'), k)
        
        results = []
        for i in indices[0]:
            if i != -1 and i < len(self.chunks):
                results.append(self.chunks[i])
        return results

rag_system = RAGService()
