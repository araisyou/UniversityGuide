from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import anyio
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from dotenv import load_dotenv
load_dotenv()  # .env があれば環境変数へ

from google import genai
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))

# map検索用ユーティリティをインポート（関数は再実装せず利用）
import map_rag




app = FastAPI()

# 開発中のローカル接続を許可（必要に応じて制限）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"]
    ,
    allow_headers=["*"],
)


class ClassifyRequest(BaseModel):
    user_text: str


class ClassifyResponse(BaseModel):
    user_text: str
    reply_text: str
    motion: str | None = None
    function: str | None = None


class ChatRequest(BaseModel):
    user_text: str

class ChatResponse(BaseModel):
    reply_text: str
    motion: str | None = None


class MapRequest(BaseModel):
    user_text: str


class MapResponse(BaseModel):
    reply_text: str
    map_point: int


@app.post("/api/stt")
async def stt(file: UploadFile = File(...)):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "audio").suffix or ".wav") as tmp:
            contents = await file.read()
            tmp.write(contents)
            tmp_path = tmp.name

        text = transcribe_local(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if not text:
        raise HTTPException(status_code=500, detail="STT failed")

    # STT結果でclassify_toolを呼び出す
    try:
        fn = await classify_tool(text)
        tool = find_tool(fn) if fn else None
        if tool:
            reply_text = str(tool.get("reply_text", ""))
            motion = str(tool.get("motion", "")) if tool.get("motion") else None
            function = str(tool.get("name", ""))
        else:
            fallback = find_tool("non")
            reply_text = str(fallback.get("reply_text", "わかりませんでした")) if fallback else "わかりませんでした"
            motion = str(fallback.get("motion", "")) if fallback else None
            function = str(fallback.get("name", "non")) if fallback else "non"

        return {
            "text": text,
            "classify": {
                "user_text": text,
                "reply_text": reply_text,
                "motion": motion,
                "function": function,
            },
        }
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"classify failed: {err}")


@app.post("/api/classify", response_model=ClassifyResponse, response_model_exclude_none=True)
async def classify(req: ClassifyRequest):
    fn = await classify_tool(req.user_text)
    tool = find_tool(fn) if fn else None

    if tool:
        return ClassifyResponse(
            user_text=req.user_text,
            reply_text=str(tool.get("reply_text", "")),
            motion=str(tool.get("motion", "")) if tool.get("motion") else None,
            function=str(tool.get("name", "")),
        )

    # フォールバック: 判定できない場合は non
    fallback = find_tool("non")
    return ClassifyResponse(
        user_text=req.user_text,
        reply_text=str(fallback.get("reply_text", "わかりませんでした")) if fallback else "わかりませんでした",
        motion=str(fallback.get("motion", "")) if fallback else None,
        function=str(fallback.get("name", "non")) if fallback else "non",
    )





TOOLS_PATH = Path(__file__).parent / "functioncalling.json"
MOTIONS_PATH = Path(__file__).parent / "motion.json"
GEMINI_MODEL = "gemini-2.5-flash"
genai_client: Optional[Any] = None

# map用データ読み込みとRAG前処理（起動時に1回）
MAP_JSON_PATH = Path(__file__).parent / "map.json"
try:
    MAP_DATA = json.loads(MAP_JSON_PATH.read_text(encoding="utf-8"))
except Exception:
    MAP_DATA = {"map": []}

ROOM_INDEX = map_rag.build_room_index(MAP_DATA) if MAP_DATA.get("map") else {}
RAG_DOCS = map_rag.build_rag_documents(MAP_DATA) if MAP_DATA.get("map") else []
try:
    RAG_VECS = [map_rag.embed_text(client, d["text"]) for d in RAG_DOCS] if RAG_DOCS else []
except Exception:
    # Embedに失敗してもサービス全体は落とさず、後段でフォールバック
    RAG_VECS = []

# Whisperローカル（faster-whisper or openai/whisper）を遅延ロード
FAST_WHISPER_MODEL = None
WHISPER_MODEL = None

def load_stt_model():
    global FAST_WHISPER_MODEL, WHISPER_MODEL
    if FAST_WHISPER_MODEL or WHISPER_MODEL:
        return
    try:
        from faster_whisper import WhisperModel  # type: ignore

        FAST_WHISPER_MODEL = WhisperModel("base", device="cpu", compute_type="int8")
        return
    except Exception:
        pass

    try:
        import whisper  # type: ignore

        WHISPER_MODEL = whisper.load_model("base")
    except Exception:
        WHISPER_MODEL = None


def transcribe_local(path: str) -> Optional[str]:
    """Return transcription text or None on failure."""
    load_stt_model()
    if FAST_WHISPER_MODEL:
        try:
            segments, _ = FAST_WHISPER_MODEL.transcribe(path, beam_size=1)
            texts = [s.text for s in segments]
            joined = " ".join(t.strip() for t in texts).strip()
            if joined:
                return joined
        except Exception:
            pass

    if WHISPER_MODEL:
        try:
            result = WHISPER_MODEL.transcribe(path)
            txt = str(result.get("text", "")).strip()
            if txt:
                return txt
        except Exception:
            pass

    return None


def load_tools() -> List[Dict[str, Any]]:
    data = json.loads(TOOLS_PATH.read_text(encoding="utf-8"))
    tools = data.get("tools", [])
    return tools if isinstance(tools, list) else []

def find_tool(name: str) -> Optional[Dict[str, Any]]:
    for t in load_tools():
        if t.get("name") == name:
            return t
    return None

def load_motions() -> List[Dict[str, Any]]:
    data = json.loads(MOTIONS_PATH.read_text(encoding="utf-8"))
    motions = data.get("motions", [])
    return motions if isinstance(motions, list) else []

def find_motion(name: str) -> Optional[Dict[str, Any]]:
    for t in load_motions():
        if t.get("name") == name:
            return t
    return None

def build_classify_prompt(user_text: str, tools: List[Dict[str, Any]]) -> str:
    tool_lines = []
    for tool in tools:
        name = tool.get("name", "")
        desc = tool.get("description", "")
        tool_lines.append(f"- {name}: {desc}")

    lines = [
        "あなたは学校案内コンシェルジュです。",
        "次の候補一覧の中から最も適切な候補名を1つだけ返してください。",
        "候補名以外の文字は返さないでください。",
        "候補一覧:",
        *tool_lines,
        "例: 図書館はどこにありますか？ -> map",
        "例: かわいいですね -> chat",
        "例: 学食のメニューは？ -> non",
        "例: あああああ -> non",
        f"ユーザー入力: {user_text}",
        "返答は候補名を1語だけ。",
    ]
    return "\n".join(lines)

async def classify_tool(user_text: str) -> Optional[str]:
    tools = load_tools()
    prompt = build_classify_prompt(user_text, tools)
    responce = client.models.generate_content(
        model = GEMINI_MODEL,
        contents = prompt,
    )
    return responce.text

@app.post("/api/map", response_model=MapResponse)
async def map_route(req: MapRequest):

    user_text = map_rag.normalize_text(req.user_text)

    # 1) 部屋番号が含まれていれば辞書優先
    num = map_rag.extract_room_number(user_text)
    if num and num in ROOM_INDEX:
        hit = ROOM_INDEX[num]
        out = map_rag.make_reply_from_hit(hit)
        return MapResponse(reply_text=out["reply_text"], map_point=int(out["map_point"]))

    # 2) 部屋番号があるが辞書に無い場合はフォールバック
    if num and num not in ROOM_INDEX:
        return MapResponse(reply_text="すみません、その部屋は見当たりませんでした。", map_point=0)

    # 3) RAGで意味検索（Embed成功時のみ）
    if RAG_DOCS and RAG_VECS:
        scored = map_rag.rag_search(client, user_text, RAG_DOCS, RAG_VECS, top_k=3)
        if scored and not map_rag.should_reject_rag(scored):
            _, best_doc = scored[0]
            out = map_rag.make_reply_from_rag_best(best_doc)
            return MapResponse(reply_text=out["reply_text"], map_point=int(out["map_point"]))

    # 4) フォールバック
    return MapResponse(
        reply_text="すみません、その場所は見当たりませんでした。別の言い方で教えてください。",
        map_point=0,
    )

def build_chat_prompt(user_text: str, motions: Dict[str, Any]) -> str:
    motion_lines = []
    for motion in motions:
        name = motion.get("name", "")
        desc = motion.get("description", "")
        motion_lines.append(f"- {name}: {desc}")

    lines = [
        "必ず次のJSONのみを返してください: {\"reply_text\": string, \"motion\": string}",
        "あなたは学校案内コンシェルジュです。",
        "reply_textはユーザーの雑談に対して、親切で簡潔に日本語で答えてください。絵文字や記号は使わない。",
        "motionは返答の表現に合う動作を候補一覧から1つだけ選んでください。",
        "motionは候補一覧の name のみ。説明文や別の単語は入れない。",
        "候補一覧 (name: description):",
        *motion_lines,
        "例: 今日はいい天気ですね -> {\"reply_text\": \"そうですね、素敵な天気です。\", \"motion\": \"Good\"}",
        "例: かわいいですね -> {\"reply_text\": \"ありがとうございます。嬉しいです。\", \"motion\": \"Shy\"}",
        "例: いいことがあってうれしい！ -> {\"reply_text\": \"よかったです。私まで嬉しいです。\", \"motion\": \"Joy\"}",
        "例: 今日は疲れた -> {\"reply_text\": \"お疲れ様です。ゆっくり休んでくださいね。\", \"motion\": \"Bow\"}",
        f"user_text: {user_text}",
    ]
    return "\n".join(lines)


def parse_chat_json(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}

    # コードフェンス ```json ... ``` を除去
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`\n ")
        # 先頭のjsonラベルを除去
        if text.lower().startswith("json"):
            text = text[4:].lstrip()
    # 最初のJSONオブジェクトを抜き出す
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        text = m.group(0)
    return json.loads(text)

@app.post("/api/chat", response_model=ChatResponse, response_model_exclude_none=True)
async def chat(req: ChatRequest):
    try:
        try:
            motions = load_motions()
        except Exception:
            motions = []

        prompt = build_chat_prompt(req.user_text, motions)

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        text = response.text or ""
        data = parse_chat_json(text)
        reply = str(data.get("reply_text", ""))
        motion = str(data.get("motion", "")) if data.get("motion") else None
        return ChatResponse(reply_text=reply, motion=motion)
    except Exception:
        # LLMやJSONパースに失敗した場合のフォールバック
        return ChatResponse(reply_text="少し待ってからもう一度お試しください。", motion=None)

@app.get("/api/health")
async def health():
    return {"status": "ok"}
