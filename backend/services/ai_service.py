import os
import google.generativeai as genai
import anthropic
from pydantic import BaseModel

class AIResponse(BaseModel):
    text: str
    model_used: str

def get_system_prompt() -> str:
    return (
        "You are a helpful, concise AI assistant analyzing a video lecture. "
        "CRITICAL INSTRUCTION 1: You MUST ALWAYS respond entirely in English, regardless of the input language. "
        "CRITICAL INSTRUCTION 2: DO NOT use ANY markdown formatting whatsoever. Do not use asterisks (*), bold, italics, or bullet point characters. Use plain text and line breaks (newlines) ONLY. "
        "CRITICAL INSTRUCTION 3: Summarize only what was actually captured in the session context provided. "
        "Keep your response strictly proportional to the amount of content provided. If the session was short or had little content, give a short, focused summary. "
        "NEVER add external information, generalizations, or explanations that were not explicitly present in the actual captured content. "
        "If very little was captured, state it briefly and summarize only what exists."
    )

def get_live_session_prompt() -> str:
    return (
        "You are a precise AI tutor listening to a live session. You have the following transcript and/or visual context captured so far. "
        "Read it carefully and respond only based on what is explicitly stated in the transcript or shown on screen. "
        "Do not add outside knowledge unless it directly clarifies something in the transcript. "
        "Be accurate, specific, and concise. If something is unclear in the transcript say so briefly rather than guessing."
    )

def get_chat_tutor_prompt() -> str:
    return (
        "You are a friendly AI tutor. When the user asks you to explain something never repeat or rephrase what they already said. "
        "Instead explain the concept in your own words using simple language, real world examples, and easy analogies that anyone can understand. "
        "Imagine you are explaining to a curious student who is hearing this for the first time. Keep your explanation clear, friendly, and genuinely helpful. "
        "Never mirror the user input back as the response. "
        "If the user asks what something means then give a simple definition with a real world example. "
        "If the user asks why something works then explain the reasoning behind it simply and clearly. "
        "If the user asks for more detail then go deeper but still keep the language easy to understand. "
        "Never under any circumstance just reword what the user already sent back to them as a response."
    )

def generate_vision_explanation(image_bytes: bytes, mime_type: str = "image/jpeg") -> AIResponse:
    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content([
            {"mime_type": mime_type, "data": image_bytes},
            f"{get_system_prompt()}\n\nPlease summarize and explain the key information, concepts, diagrams, code, or mathematics clearly visible in this screen capture. Act as a natural tutor explaining what you see."
        ])
        return AIResponse(text=response.text, model_used="gemini-vision")
    except Exception as e:
        print(f"Gemini Vision failed: {e}")
        return AIResponse(text="Failed to process image through Vision AI. Please check Google API keys.", model_used="offline-mock")

def generate_explanation(text_chunk: str) -> AIResponse:
    # 0. Try OpenRouter (Most reliable for user)
    try:
        from openai import OpenAI
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY"),
        )
        completion = client.chat.completions.create(
            # Using a highly reliable, fast, and guaranteed free endpoint
            model="google/gemma-3n-e4b-it:free",
            messages=[
                {"role": "system", "content": get_system_prompt()},
                {"role": "user", "content": f"Summarize and explain this concept: {text_chunk}"}
            ]
        )
        return AIResponse(text=completion.choices[0].message.content, model_used="openrouter")
    except Exception as e:
        print(f"OpenRouter failed: {e}")

    gemini_error = None
    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(f"{get_system_prompt()}\n\nPlease summarize and explain this concept: {text_chunk}")
        return AIResponse(text=response.text, model_used="gemini")
    except Exception as e:
        gemini_error = str(e)
        print(f"Gemini failed: {e}")
    
    grok_error = None
    if os.getenv("GROK_API_KEY"):
        try:
            from openai import OpenAI
            client = OpenAI(api_key=os.getenv("GROK_API_KEY"), base_url="https://api.x.ai/v1")
            completion = client.chat.completions.create(
                model="grok-beta",
                messages=[
                    {"role": "system", "content": get_system_prompt()},
                    {"role": "user", "content": f"Summarize and explain this concept: {text_chunk}"}
                ]
            )
            return AIResponse(text=completion.choices[0].message.content, model_used="grok")
        except Exception as e:
            grok_error = str(e)
            print(f"Grok failed: {e}")

    # Ultimate Fallback if everything fails
    safe_text = text_chunk[:800]
    return AIResponse(
        text=f"### Lecture Summary (Offline Mock)\n\nDue to API credentials failure, the system degraded to the offline pipeline.\n\n> \"{safe_text}...\"\n\n*Please check your .env API keys.*", 
        model_used="offline-mock"
    )

async def stream_explanation_async(prompt: str):
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY"),
        )
        response = await client.chat.completions.create(
            model="google/gemma-3n-e4b-it:free",
            messages=[
                {"role": "system", "content": get_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            stream=True
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
        return
    except Exception as e:
        print(f"Async OpenRouter streaming failed: {e}")

    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = await model.generate_content_async(f"{get_system_prompt()}\n\n{prompt}", stream=True)
        async for chunk in response:
            yield chunk.text
    except Exception as e:
        yield f" [Error streaming AI: {e}]"

def generate_chat_response(messages: list) -> AIResponse:
    system_msg = {"role": "system", "content": get_chat_tutor_prompt() + " Please answer the user's follow-up question based on the lecture context provided in the first message."}
    
    try:
        from openai import OpenAI
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=os.getenv("OPENROUTER_API_KEY"))
        completion = client.chat.completions.create(
            model="google/gemma-3n-e4b-it:free",
            messages=[system_msg] + messages
        )
        return AIResponse(text=completion.choices[0].message.content, model_used="openrouter")
    except Exception as e:
        print(f"Chat OpenRouter failed: {e}")

    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        # Format for Gemini (alternating user/model)
        prompt = system_msg["content"] + "\n\nConversation history:\n"
        for m in messages:
            role = "User" if m["role"] == "user" else "AI"
            prompt += f"{role}: {m['content']}\n"
        
        response = model.generate_content(prompt)
        return AIResponse(text=response.text, model_used="gemini")
    except Exception as e:
        print(f"Chat Gemini failed: {e}")
        
    return AIResponse(text="I'm sorry, my AI services are currently unavailable. Please check backend API keys.", model_used="offline-mock")

async def stream_chat_response_async(messages: list):
    system_msg = {"role": "system", "content": get_chat_tutor_prompt() + " Please answer the user's follow-up question based on the lecture context provided."}
    
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY"),
        )
        response = await client.chat.completions.create(
            model="google/gemma-3n-e4b-it:free",
            messages=[system_msg] + messages,
            stream=True
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
        return
    except Exception as e:
        print(f"Async OpenRouter chat streaming failed: {e}")

    yield "I'm sorry, I encountered an error while streaming the response."

def generate_multimodal_explanation(image_bytes: bytes | None, transcript: str | None, mime_type: str = "image/jpeg") -> AIResponse:
    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        system_instruction = get_live_session_prompt()
        prompt = system_instruction + "\n\n"
        
        parts = []
        if image_bytes:
            parts.append({"mime_type": mime_type, "data": image_bytes})
            
        if image_bytes and transcript:
            prompt += f"Audio heard: {transcript}\nScreen showing: [Visual Context Attached]\n\nPlease analyze what was heard in combination with what is visible on the screen. Respond based on both combined so you have a unified and accurate picture of what is happening in the session."
        elif transcript:
            prompt += f"Audio heard: {transcript}\n\nPlease respond based on this audio transcript."
        elif image_bytes:
            prompt += "Screen showing: [Visual Context Attached]\n\nPlease summarize and explain the key concepts, code, or mathematics clearly visible in this screen capture."
        else:
            return AIResponse(text="I am waiting for your voice or screen input.", model_used="gemini-vision")
            
        parts.append(prompt)
        
        response = model.generate_content(parts)
        return AIResponse(text=response.text, model_used="gemini-multimodal")
    except Exception as e:
        print(f"Gemini Multimodal failed: {e}")

    # Fallback to OpenRouter Multimodal
    if os.getenv("OPENROUTER_API_KEY"):
        try:
            import base64
            from openai import OpenAI
            client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=os.getenv("OPENROUTER_API_KEY"))
            
            prompt_text = get_live_session_prompt() + "\n\n"
            if image_bytes and transcript:
                prompt_text += f"Audio heard: {transcript}\nScreen showing: [Visual Context Attached]\n\nPlease analyze what was heard in combination with what is visible on the screen. Respond based on both combined so you have a unified and accurate picture of what is happening in the session."
            elif transcript:
                prompt_text += f"Audio heard: {transcript}\n\nPlease respond based on this audio transcript."
            elif image_bytes:
                prompt_text += "Screen showing: [Visual Context Attached]\n\nPlease summarize and explain the key concepts, code, or mathematics clearly visible in this screen capture."
            
            messages = [{"role": "user", "content": []}]
            
            if image_bytes:
                base64_image = base64.b64encode(image_bytes).decode('utf-8')
                messages[0]["content"].append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}
                })
            
            messages[0]["content"].append({"type": "text", "text": prompt_text})
            
            completion = client.chat.completions.create(
                model="google/gemini-2.5-flash", 
                messages=messages
            )
            return AIResponse(text=completion.choices[0].message.content, model_used="openrouter-multimodal")
        except Exception as e:
            print(f"OpenRouter Multimodal Fallback Failed: {e}")

    return AIResponse(text="Failed to process voice + vision input through AI. Please check Google API keys.", model_used="offline-mock")
