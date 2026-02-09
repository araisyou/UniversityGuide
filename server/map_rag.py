import os
import re
import json
import math
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from google import genai

from dotenv import load_dotenv
load_dotenv()  # .env があれば環境変数へ

# -----------------------------
# Normalization
# -----------------------------
def normalize_text(s: str) -> str:
    # 全角数字/英字などを半角へ、記号ゆれもある程度統一
    s = unicodedata.normalize("NFKC", s)
    # 余分な空白を整理
    s = re.sub(r"\s+", " ", s).strip()
    return s

def extract_room_number(s: str) -> Optional[str]:
    # 例: "831教室", "８３１教室", "1712教室", "部屋は 812 です" などに対応
    s = normalize_text(s)
    m = re.search(r"(?<!\d)(\d{3,4})(?!\d)", s)
    return m.group(1) if m else None

# -----------------------------
# Build indices + rag docs
# -----------------------------
def build_room_index(map_data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    例: "811" -> {"building_id": 8, "floor": 1, "room_name": "811教室"}
    """
    idx: Dict[str, Dict[str, Any]] = {}

    for b in map_data["map"]:
        bid = b["id"]
        for f in b.get("floors", []):
            level = f["level"]
            for r in f.get("rooms", []):
                # aliasesが無い場合も name から数字だけは拾えるようにする
                aliases = [a.strip() for a in r.get("aliases", []) if a and a.strip()]
                # name内の数字も補助キーに（"811教室" -> "811"）
                num = extract_room_number(normalize_text(r["name"]))
                if num:
                    aliases.append(num)

                for a in set(aliases):
                    idx[a] = {
                        "type": "room",
                        "building_id": bid,
                        "floor": level,
                        "room_name": r["name"],
                        "building_name": b["name"],
                    }
    return idx

def build_rag_documents(map_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    RAGに入れる“テキスト”を作る（aliasesは必須じゃないので使わない方針でもOK）
    """
    docs: List[Dict[str, Any]] = []

    for b in map_data["map"]:
        bid = b["id"]
        bname = b["name"]
        bdesc = b.get("description", "")

        # 建物説明ドキュメント
        docs.append({
            "id": f"building:{bid}",
            "building_id": bid,
            "floor": None,
            "entity_type": "building",
            "text": f"建物: {bname}\n説明: {bdesc}"
        })

        # 階・部屋ドキュメント（短いが、構造情報が入るので意味検索に乗りやすい）
        for f in b.get("floors", []):
            level = f["level"]
            for r in f.get("rooms", []):
                rname = r["name"]
                docs.append({
                    "id": f"room:{bid}:{level}:{rname}",
                    "building_id": bid,
                    "floor": level,
                    "entity_type": "room",
                    "text": f"場所: {bname} {level}階\n部屋/施設: {rname}\n建物説明: {bdesc}"
                })

    return docs

# -----------------------------
# Embedding + search
# -----------------------------
def embed_text(client: genai.Client, text: str) -> np.ndarray:
    # Gemini Embeddings doc: client.models.embed_content(model="gemini-embedding-001", contents="...")
    res = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text
    )
    # res.embeddings は pydantic object; 一般にベクトルは res.embeddings[0].values の形式
    # ドキュメントの例は print(result.embeddings) だけなので、両対応で安全に取る
    emb0 = res.embeddings[0]
    vec = getattr(emb0, "values", emb0)
    return np.array(vec, dtype=np.float32)

def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return -1.0
    return float(np.dot(a, b) / denom)

def rag_search(client: genai.Client, query: str, docs: List[Dict[str, Any]], doc_vecs: List[np.ndarray], top_k: int = 3):
    qv = embed_text(client, query)
    scored = []
    for d, v in zip(docs, doc_vecs):
        scored.append((cosine_sim(qv, v), d))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]

# -----------------------------
# Response builder
# -----------------------------
def make_reply_from_hit(hit: Dict[str, Any]) -> Dict[str, Any]:
    bid = hit["building_id"]
    floor = hit.get("floor")
    bname = hit.get("building_name") or ""
    room_name = hit.get("room_name")

    if hit.get("type") == "room" and floor is not None:
        # 例: "8号館の3階になります。場所はここです。"
        return {"reply_text": f"{bname}の{floor}階になります。場所はここです。", "map_point": bid}

    # fallback
    return {"reply_text": f"{bname}になります。場所はここです。", "map_point": bid}

def make_reply_from_rag_best(doc: Dict[str, Any]) -> Dict[str, Any]:
    bid = doc["building_id"]
    floor = doc.get("floor")
    if doc["entity_type"] == "room" and floor is not None:
        return {"reply_text": f"{bid}号館の{floor}階になります。場所はここです。", "map_point": bid}
    return {"reply_text": f"{bid}号館になります。場所はここです。", "map_point": bid}

NOTFOUND_REPLY = {"reply_text": "すみません、その場所は見当たりませんでした。別の言い方で教えてください。", "map_point": None}

# RAGの拒否しきい値（最初はこのくらいから。あとでログ見て調整）
RAG_SCORE_THRESHOLD = 0.75

def should_reject_rag(top_scored, score_threshold=RAG_SCORE_THRESHOLD) -> bool:
    """
    top_scored: [(score, doc), ...] score降順
    """
    best_score = top_scored[0][0]
    if best_score < score_threshold:
        return True

    return False


# -----------------------------
# Demo main
# -----------------------------
def main():
    

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    # map.json を読む（上のJSONをこのファイル名で保存してね）
    with open("map.json", "r", encoding="utf-8") as f:
        map_data = json.load(f)

    room_index = build_room_index(map_data)

    docs = build_rag_documents(map_data)
    # デモなので毎回embed（本番はキャッシュ推奨）
    doc_vecs = [embed_text(client, d["text"]) for d in docs]

    tests = [
        "8号館はどこ？",      # 存在しない想定
        "1712教室どこですか",   # 存在する
        "化学室はどこ？",        # 存在しない想定
        "図書館ってどこ？",      # 存在する
        "コピー機どこ？",        # 存在する（説明に含まれる）
        "情報センターはどこ？"   # 存在する
    ]

    for q in tests:
        qn = normalize_text(q)
        num = extract_room_number(qn)

        # 1) 数字がある => 辞書で確定。無ければNotFoundで終了（RAGへ回さない）
        if num:
            if num in room_index:
                hit = room_index[num]
                out = make_reply_from_hit(hit)
                print("\n[DICT HIT]", q, "->", out)
            else:
                print("\n[DICT MISS]", q, "->", NOTFOUND_REPLY)
            continue

        # 2) 数字がない => RAG
        top = rag_search(client, qn, docs, doc_vecs, top_k=3)

        if should_reject_rag(top):
            print("\n[RAG REJECT]", q, f"(best={top[0][0]:.3f})", "->", NOTFOUND_REPLY)
            continue

        best_score, best_doc = top[0]
        out = make_reply_from_rag_best(best_doc)
        print("\n[RAG HIT]", q, f"(score={best_score:.3f})", "->", out)

if __name__ == "__main__":
    main()