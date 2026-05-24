from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import chat, upload

app = FastAPI(title="Smart Lecture & Meeting Assistant API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])

@app.get("/")
def read_root():
    return {"message": "Welcome to Smart Lecture Assistant API"}
