from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from database import supabase
import uuid
import datetime
from pydantic import BaseModel
from typing import List, Dict
from services.ai_service import generate_explanation, generate_chat_response, stream_chat_response_async, generate_vision_explanation, generate_multimodal_explanation
from fastapi.responses import StreamingResponse

class ChatRequest(BaseModel):
    session_id: str
    messages: List[Dict[str, str]]

router = APIRouter()

@router.post("/start-live-session")
async def start_live_session(user_id: str = "11111111-2222-3333-4444-555555555555"):
    # Generate session ID and store in Supabase
    session_id = str(uuid.uuid4())
    try:
        data = supabase.table('sessions').insert({
            "id": session_id,
            "user_id": user_id,
            "mode": "live",
            "created_at": datetime.datetime.utcnow().isoformat()
        }).execute()
        
        return {"status": "success", "session_id": session_id}
    except Exception as e:
        print(f"Error starting session: {e}")
        return {"status": "error", "message": "Could not start session."}

@router.post("/process-chunk")
async def process_chunk(session_id: str = Form(...), text_chunk: str = Form(...)):
    # Simulating STT already happened on client or previous step if we sent text.
    # If audio is sent, we would pass it to audio_service here.
    
    # 1. Get AI Explanation
    response = generate_explanation(text_chunk)
    
    # 2. Store transcript & explanation in Supabase asynchronously or directly
    try:
        supabase.table('transcripts').insert({
            "session_id": session_id,
           "text": text_chunk
        }).execute()

        # Ideally, explanations are stored in summaries or a separate table
        # We'll just return it for real-time display
    except Exception as e:
        print(f"DB Error: {e}")

    return {
        "status": "success", 
        "explanation": response.text, 
        "model_used": response.model_used
    }


@router.post("/process-vision")
async def process_vision(session_id: str = Form(...), image: UploadFile = File(...)):
    # Read the image bytes
    image_bytes = await image.read()
    
    # Generate Explanation using Vision AI
    response = generate_vision_explanation(image_bytes, image.content_type or "image/jpeg")
    
    try:
        supabase.table('transcripts').insert({
            "session_id": session_id,
           "text": "[Vision Screenshot Analyzed] " + response.text[:100] + "..."
        }).execute()
    except Exception as e:
        print(f"DB Error: {e}")

    return {
        "status": "success", 
        "explanation": response.text, 
        "model_used": response.model_used
    }

@router.post("/ask")
async def ask_question(request: ChatRequest):
    try:
        # 1. Fetch the cached transcript and summary for context!
        transcript_res = supabase.table('transcripts').select("text").eq('session_id', request.session_id).execute()
        summary_res = supabase.table('summaries').select("summary_text").eq('session_id', request.session_id).execute()
        
        context_text = ""
        if transcript_res.data:
             context_text += f"Lecture Transcript:\n{transcript_res.data[0]['text']}\n\n"
        if summary_res.data:
             context_text += f"Lecture Summary:\n{summary_res.data[0]['summary_text']}\n\n"
             
        # Create a fresh message list prepended with the hidden context
        enhanced_messages = []
        if context_text:
             enhanced_messages.append({"role": "user", "content": f"Here is the context of the lecture we are discussing:\n{context_text}\n\nPlease keep this context in mind for my next questions."})
             enhanced_messages.append({"role": "assistant", "content": "I understand the context of the lecture. What is your question?"})
             
        enhanced_messages.extend(request.messages)

        # 2. Return a StreamingResponse directly from the async generator
        return StreamingResponse(
            stream_chat_response_async(enhanced_messages), 
            media_type="text/plain"
        )
    except Exception as e:
        print(f"Error in /ask: {e}")
        return StreamingResponse(iter([f"Error processing request: {str(e)}"]), media_type="text/plain")

@router.post("/process-multimodal")
async def process_multimodal(
    session_id: str = Form(...), 
    image: UploadFile | None = File(None),
    transcript: str | None = Form(None)
):
    image_bytes = await image.read() if image else None
    mime_type = image.content_type if image else "image/jpeg"
    
    response = generate_multimodal_explanation(image_bytes, transcript, mime_type)
    
    # Store transcript if available
    if transcript:
        try:
            supabase.table('transcripts').insert({
                "session_id": session_id,
                "text": f"[Voice] {transcript}"
            }).execute()
        except Exception as e:
            print(f"DB Error inserting transcript: {e}")
            
    # Optional: Log the visual explanation context as well
    if image_bytes and not transcript:
        try:
            supabase.table('transcripts').insert({
                "session_id": session_id,
                "text": f"[Vision Analyzed] {response.text[:100]}..."
            }).execute()
        except Exception as e:
            print(f"DB Error inserting vision event: {e}")

    return {
        "status": "success", 
        "explanation": response.text, 
        "model_used": response.model_used
    }

class SessionEvent(BaseModel):
    type: str
    content: str
    time: int

class SessionSummaryRequest(BaseModel):
    session_id: str
    events: List[SessionEvent]
    ai_explanations: str = ""
    session_length_seconds: int = 0

@router.post("/session-summary")
async def post_session_summary(request: SessionSummaryRequest):
    try:
        print(f"[DEBUG] Received session summary request for session ID: {request.session_id}")
        
        if not request.ai_explanations.strip():
             return {"status": "success", "summary": "No audio or visual events were recorded during this session."}
        
        prompt = (
            f"Here are the AI explanations generated during the live session. Use only these to write a clean and concise final summary. "
            f"Do not add any outside information. Cover all the key points that were explained during the session in simple and clear language proportional to the session length.\n"
            f"This session lasted precisely {request.session_length_seconds} seconds. "
            f"For a 30-second session, write 3 to 4 lines. For a 1-minute session, write 6 to 8 lines. For a 2-minute session, write 10 to 12 lines. "
            f"If there were 3 to 4 mid session explanations write a 4 to 6 line summary. If there were more explanations write a slightly longer summary.\n"
            f"Never write more than what was actually covered in the session.\n\n"
            f"Mid-Session AI Explanations:\n{request.ai_explanations.strip()}"
        )
        
        summary_response = generate_explanation(prompt)
        
        try:
            # Save the final summary out to the standard history summaries table
            supabase.table('summaries').insert({
                 "id": str(uuid.uuid4()),
                 "session_id": request.session_id,
                 "summary_text": summary_response.text,
                 "key_points": [], 
                 "explanation": ""
            }).execute()
        except Exception as e:
            print(f"Failed to record summary in DB: {e}")
            
        return {"status": "success", "summary": summary_response.text}
    except Exception as e:
        print(f"Error generating session summary: {e}")
        return {"status": "error", "message": "Failed to generate summary."}
