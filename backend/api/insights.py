# backend/api/insights.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

class InsightRequest(BaseModel):
    query: str

@router.post("/insights")
def copilot_insight(req: InsightRequest):
    try:
        # For now — mock response (replace with Gemini/OpenAI call later)
        return {
            "query": req.query,
            "response": f"🧠 Copilot is not connected yet. You asked: '{req.query}'"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
