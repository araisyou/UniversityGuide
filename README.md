# Live2D 学校案内 デジタルサイネージ

## 概要
- Live2D を用いた学校案内システムです。
- 学校内の情報を AI が適切に回答します。
- デモ版のため、一部機能の実装や実際の学校の情報とは異なっています。
- 

## 前提
- Node.js 18+ / npm
- Docker
- VOICEVOX エンジン（docker-compose で自動起動）
- Gemini（API キーを server/.env に設定）

## Web (Vite) の起動
```bash
npm install
npm run build
npm run serve  # Vite preview (5000)
```

## Server (FastAPI + VOICEVOX) の起動
1. server/.env に Gemini API キーを記入:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
2. server ディレクトリへ移動し、Docker Compose を起動:
   ```bash
   cd server
   docker compose up -d --build
   ```
   - app: FastAPI (port 8000)
   - voicevox: VOICEVOX engine (port 50021)

## 停止
```bash
cd server
docker compose down
```

## 補足
- docker が動いていない場合は Docker Desktop を起動してください。
- web 側は `http://localhost:5000`、API は `http://localhost:8000` を利用します。
