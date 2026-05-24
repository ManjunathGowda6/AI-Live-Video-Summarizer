import os
import uuid
import json
import datetime
import tempfile
import asyncio
from fastapi import APIRouter, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse
from database import supabase
from services.ai_service import stream_explanation_async
from services.rag_service import rag_system

router = APIRouter()

# In-memory store for routing the file path to the SSE endpoint.
# In production, use Redis or a DB with a shared volume.
_uploaded_files = {}

@router.post("/")
async def upload_file(file: UploadFile = File(...), user_id: str = "11111111-2222-3333-4444-555555555555"):
    session_id = str(uuid.uuid4())
    
    try:
        # 1. Create Session
        supabase.table('sessions').insert({
            "id": session_id,
            "user_id": user_id,
            "mode": "upload",
            "created_at": datetime.datetime.utcnow().isoformat()
        }).execute()
        
        # 2. Save file temporarily (using streaming to save memory)
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file.filename}")
        content = await file.read()
        temp_file.write(content)
        temp_file.close()
        
        # 3. Store path mapping for the streaming endpoint
        _uploaded_files[session_id] = temp_file.name
        
        return {"status": "success", "session_id": session_id, "message": "File is ready for processing."}
    except Exception as e:
        return {"status": "error", "message": f"Upload failed: {str(e)}"}

@router.get("/stream/{session_id}")
async def stream_processing(session_id: str):
    file_path = _uploaded_files.get(session_id)
    if not file_path:
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'text': 'File not found or already processed'})}\n\n"]),
            media_type="text/event-stream"
        )
        
    async def event_generator():
        q = asyncio.Queue()
        full_transcript = []
        
        def run_transcription(loop):
            try:
                from faster_whisper import WhisperModel
                import os
                model_size = os.getenv("WHISPER_MODEL", "tiny")
                
                # We skip moviepy explicitly here: Whisper natively processes the video file using FFmpeg beneath.
                model = WhisperModel(model_size, device="cpu", compute_type="int8")
                
                # vad_filter=True drastically cuts silence chunks directly speeding this up
                segments, _ = model.transcribe(file_path, beam_size=2, vad_filter=True)
                
                word_count = 0
                ai_triggered = False
                first_chunk_buffer = []

                for segment in segments:
                    text = segment.text.strip()
                    if text:
                        full_transcript.append(text)
                        
                        # Send transcript live updates
                        asyncio.run_coroutine_threadsafe(
                            q.put({"type": "transcript", "text": text + " "}), loop
                        )
                        
                        if not ai_triggered:
                            first_chunk_buffer.append(text)
                            word_count += len(text.split())
                            
                            # Trigger early initial AI as soon as ~40 words are available
                            if word_count >= 40:
                                ai_triggered = True
                                initial_text = " ".join(first_chunk_buffer)
                                asyncio.run_coroutine_threadsafe(
                                    run_initial_ai_analysis(initial_text, loop, q), loop
                                )
                
            except Exception as e:
                asyncio.run_coroutine_threadsafe(
                    q.put({"type": "error", "text": f"Transcription error: {str(e)}"}), loop
                )
            finally:
                asyncio.run_coroutine_threadsafe(
                    q.put({"type": "transcription_done"}), loop
                )

        async def run_initial_ai_analysis(text_chunk, loop, queue):
            prompt = f"Based on this opening segment of a lecture, provide a quick initial insight or context of what is being discussed. Do not wait for the rest. Segment: {text_chunk}"
            try:
                async for token in stream_explanation_async(prompt):
                    await queue.put({"type": "initial_summary", "text": token})
            except Exception as e:
                 await queue.put({"type": "initial_summary", "text": " [AI Error]"})
            finally:
                 await queue.put({"type": "initial_summary_done", "text": ""})

        async def run_final_ai_analysis(full_text, loop, queue):
            prompt = f"Summarize this entirely complete lecture and extract key points: {full_text}"
            try:
                async for token in stream_explanation_async(prompt):
                    await queue.put({"type": "final_summary", "text": token})
            except Exception as e:
                 pass
            finally:
                 await queue.put({"type": "final_summary_done", "text": ""})

        # Start transcription thread
        loop = asyncio.get_running_loop()
        import threading
        threading.Thread(target=run_transcription, args=(loop,), daemon=True).start()
        
        # State trackers
        transcription_finished = False
        final_summary_started = False
        final_summary_finished = False
        
        while True:
            msg = await q.get()
            
            if msg["type"] == "transcription_done":
                transcription_finished = True
                full_text = " ".join(full_transcript)
                
                if not full_text.strip():
                    full_text = "No speech detected in this video clip."
                    
                try:
                    # Cache transcript in Supabase
                    supabase.table('transcripts').insert({
                        "session_id": session_id,
                        "text": full_text
                    }).execute()
                    
                    # Add to RAG
                    rag_system.add_to_index(full_text)
                except Exception as e:
                    print(f"Error caching transcript: {e}")
                
                # Kick off final analysis
                asyncio.create_task(run_final_ai_analysis(full_text, loop, q))
                continue
                
            if msg["type"] == "final_summary_done":
                # Save the final text to summaries
                try:
                    summary_text = getattr(q, '_final_summary_store', 'Analysis complete.') # Optional, tracking tokens
                    supabase.table('summaries').insert({
                         "id": str(uuid.uuid4()),
                         "session_id": session_id,
                         "summary_text": summary_text,
                         "key_points": [], 
                         "explanation": ""
                    }).execute()
                except:
                    pass
                
                # Cleanup Temp File
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except:
                        pass
                
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                break
            
            if msg["type"] == "final_summary":
                 # Keep track to save at end
                 if not hasattr(q, '_final_summary_store'): q._final_summary_store = ""
                 q._final_summary_store += msg["text"]
                 
            yield f"data: {json.dumps(msg)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/summary/{session_id}")
async def get_summary(session_id: str):
    response = supabase.table('summaries').select("*").eq('session_id', session_id).execute()
    if response.data:
        return {"status": "success", "data": response.data[0]}
    return {"status": "pending", "message": "Summary not ready yet"}

@router.get("/history/{user_id}")
async def get_history(user_id: str = "11111111-2222-3333-4444-555555555555"):
    response = supabase.table('sessions').select("*, summaries(summary_text)").order('created_at', desc=True).limit(50).execute()
    return {"status": "success", "data": response.data}
