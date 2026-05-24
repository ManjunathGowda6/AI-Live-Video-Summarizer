import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

if not url or not key:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")

supabase: Client = create_client(url, key)

# Ensure the mock MVP user exists to satisfy foreign key constraints
try:
    supabase.table('users').upsert({
        "id": "00000000-0000-0000-0000-000000000000",
        "email": "defaultuser@example.com"
    }).execute()
except Exception as e:
    print(f"Warning: Could not create default user. Proceeding anyway. {e}")
