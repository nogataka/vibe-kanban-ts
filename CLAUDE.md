# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose
Rust版からTypeScript/Node.js版へのバックエンド完全移植

## Commands

### Development
```bash
# Install all dependencies (root, frontend, backend)
npm run install:all

# Start development servers (frontend:3000, backend:3001)
npm run dev

# Backend development only
npm run backend:dev

# Frontend development only  
npm run frontend:dev
```

### Build & Check
```bash
# Type checking
npm run backend:check  # Backend TypeScript check
npm run frontend:check # Frontend TypeScript check
npm run check         # Both

# Build
npm run backend:build  # Backend build (tsc)
npm run build         # Full build (backend + frontend)

# Linting & Formatting (backend)
cd backend
npm run lint          # ESLint
npm run format        # Prettier format
npm run format:check  # Prettier check
npm run typecheck     # TypeScript check
```

### Database
```bash
cd backend
npm run db:migrate    # Run migrations
npm run db:reset      # Reset database
```

## Architecture

### Directory Structure
```
/vibe-kanban
├── crates/           # Rust版 (参照元)
│   ├── server/       # APIサーバー
│   ├── db/          # データベース層
│   ├── services/    # ビジネスロジック
│   ├── executors/   # AI実行エンジン
│   ├── deployment/  # デプロイメント管理
│   ├── local-deployment/ # ローカル実行
│   └── utils/       # 共通ユーティリティ
├── backend/         # TypeScript版 (移植先)
│   ├── server/      # APIサーバー
│   ├── db/          # データベース層
│   ├── services/    # ビジネスロジック
│   ├── executors/   # AI実行エンジン
│   ├── deployment/  # デプロイメント管理
│   ├── local-deployment/ # ローカル実行
│   └── utils/       # 共通ユーティリティ
└── frontend/        # React UI (修正禁止)
```

### Key Services
- **DatabaseService**: SQLite接続管理とCRUD操作
- **DeploymentService**: タスク実行とプロセス管理
- **WorktreeManager**: Git worktree管理
- **EventService**: WebSocketイベント配信
- **MCPServer**: Model Context Protocol実装

### API Endpoints Structure
- `/api/projects` - プロジェクト管理
- `/api/tasks` - タスク管理
- `/api/task-attempts` - タスク実行試行
- `/api/execution-processes` - 実行プロセス
- `/api/templates` - タスクテンプレート
- SSE endpoints for log streaming

## Migration Guidelines

### ファイル対応表
詳細な1対1対応表: `/RUST_TO_REACT_FILES_TABLE.md`

### 移植ルール
1. Rust版の機能を完全に再現（言語制約がある場合を除く）
2. ディレクトリ構造は可能な限りRust版と同一に保つ
3. モデル名はTypeScript慣習に従う（camelCase）

### ポート設定
開発用ポート: `/.dev-ports.json`
- Frontend: 3000
- Backend: 3001

## Important Constraints

### 絶対に守ること
- **フロントエンド修正禁止**: `/frontend` ディレクトリは一切変更しない
- **node_modules参照禁止**: 巨大なため参照しない
- **対比表確認必須**: 修正時は必ずRust版と対比表を確認
- **簡易版作成禁止**: simple版などの限定機能版を勝手に作らない
- **指示待ち厳守**: 明示的な指示なしに新機能追加や大幅な変更をしない

### Database Schema
SQLiteデータベース（`backend/data/vibe-kanban.db`）
- マイグレーションファイルは参照用（`crates/db/migrations/`）
- 実際のスキーマは手動管理

## Current Status
2025年9月1日時点:
- 基本API機能実装済み（プロジェクト、タスク、テンプレート）
- SSEログストリーミング実装済み
- フロントエンド連携動作確認済み
- 未実装: 実AIエンジン統合、GitHub連携、ファイル監視