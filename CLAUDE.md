# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose
A TypeScript/Node.js port of the original Rust-based Vibe Kanban backend, providing a task management system for orchestrating AI coding agents. The project maintains full API compatibility with the original while leveraging the JavaScript ecosystem.

## Commands

### Initial Setup
```bash
# Install all dependencies (root, frontend, backend)
npm run install:all
```

### Development
```bash
# Start both servers (frontend:3000, backend:3001)
npm run dev

# Individual servers
npm run backend:dev    # Backend only (port 3001)
npm run frontend:dev   # Frontend only (port 3000)
```

### Quality Checks (Run after making changes)
```bash
# Type checking (both frontend and backend)
npm run check

# Backend-specific checks
cd backend && npm run lint && npm run format:check && npm run typecheck

# Frontend-specific checks  
cd frontend && npm run lint && npm run format:check
```

### Build & Production
```bash
# Full build (backend + frontend)
npm run build

# NPX package for distribution
npm run build:npx
npm run test:npm
```

### Database Management
```bash
cd backend
npm run db:migrate    # Run migrations
npm run db:reset      # Reset database (removes vibe-kanban.db)
```

### Cleanup
```bash
cd backend
npm run clean         # Remove dist directory
npm run clean:logs    # Remove log files
npm run clean:all     # Clean everything
```

## Architecture

### Tech Stack
- **Backend**: Node.js + TypeScript + Express
- **Database**: SQLite with better-sqlite3
- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Real-time**: WebSocket (ws) for event streaming
- **Process Management**: Simple-git for worktree management

### Directory Structure
```
vibe-kanban/
├── backend/              # TypeScript backend (移植先)
│   ├── index.ts          # Entry point
│   ├── server/           # Express API server & routes
│   ├── db/               # Database models & migrations
│   ├── services/         # Core business logic
│   ├── executors/        # AI agent execution engines
│   ├── deployment/       # Task deployment management
│   ├── local-deployment/ # Local execution handlers
│   └── utils/            # Shared utilities
├── frontend/             # React UI (修正禁止)
├── crates/               # Original Rust implementation (参照用)
└── shared/               # Shared TypeScript types
```

### Core Services
- **DatabaseService** (`backend/db/`): SQLite connection management, CRUD operations
- **DeploymentService** (`backend/deployment/`): Task execution and process lifecycle
- **WorktreeManager** (`backend/services/`): Git worktree operations for isolated environments
- **EventService** (`backend/services/`): WebSocket-based real-time event distribution
- **MCPServer** (`backend/services/`): Model Context Protocol server implementation

### API Endpoints
- `GET/POST /api/projects` - Project CRUD
- `GET/POST /api/tasks` - Task management
- `GET/POST /api/task-attempts` - Execution attempts tracking
- `GET /api/execution-processes` - Process monitoring
- `GET/POST /api/templates` - Task templates
- `GET /api/events/stream` - SSE for log streaming
- WebSocket endpoints for real-time updates

## Code Style & Conventions

### TypeScript Conventions
- **Strict mode**: Disabled (`"strict": false` in tsconfig)
- **File naming**: camelCase for files, PascalCase for components/classes
- **Exports**: Named exports preferred over default exports
- **Async/Await**: Preferred over raw promises

### Formatting Rules (Prettier)
- Semi-colons: Required
- Single quotes for strings
- Print width: 100 characters
- Tab width: 2 spaces
- Trailing comma: None

### Linting Rules (ESLint)
- Unused variables: Error (except those prefixed with `_`)
- Explicit any: Warning (not error)
- Console statements: Allowed
- Module boundary types: Disabled

## Migration Context

### Rust to TypeScript Port Guidelines
1. **Exact Feature Parity**: Replicate Rust functionality completely (unless language constraints prevent it)
2. **Directory Mirroring**: Maintain identical structure to Rust version where possible
3. **API Compatibility**: 95%+ compatibility with original endpoints
4. **Reference Table**: Check `/RUST_TO_REACT_FILES_TABLE.md` for file mappings

### Port Configuration
- Frontend: 3000 (development)
- Backend: 3001 (development)
- Configuration: `/.dev-ports.json`

## Critical Constraints

### DO NOT Modify
- **Frontend directory** (`/frontend`): Read-only, no modifications allowed
- **node_modules**: Never reference or read (too large)
- **Crates directory**: Reference only for understanding Rust implementation

### ALWAYS Do
- **Check Rust version**: Compare with `crates/` when implementing features
- **Maintain API compatibility**: Preserve exact endpoint signatures
- **Follow existing patterns**: Match code style in neighboring files
- **Wait for instructions**: Don't add features without explicit request

### NEVER Do
- Create "simple" or "lite" versions of features
- Add new endpoints without corresponding Rust implementation
- Modify database schema without migration
- Introduce breaking API changes

## Database

### SQLite Schema
- Database location: `backend/data/vibe-kanban.db`
- Migration reference: `crates/db/migrations/` (for schema understanding)
- Schema management: Manual (no auto-migrations in TypeScript version)

### Key Tables
- `projects`: Project configurations
- `tasks`: Task definitions and status
- `task_attempts`: Execution history
- `execution_processes`: Active process tracking
- `templates`: Reusable task templates

## Testing Status
- **Unit tests**: Not implemented
- **Integration tests**: Not implemented
- **E2E tests**: Not implemented
- Running `npm test` will error (no test configuration)

## Environment Variables

Runtime configuration (see `.env.example`):
```bash
PORT=3001                    # Backend server port
BACKEND_PORT=3001            # Alternative backend port config
FRONTEND_PORT=3000           # Frontend dev server port
HOST=127.0.0.1               # Server host
GITHUB_CLIENT_ID=...         # GitHub OAuth (build-time)
POSTHOG_API_KEY=...          # Analytics (optional)
DISABLE_WORKTREE_ORPHAN_CLEANUP=1  # Debug flag
```

## Current Implementation Status

### ✅ Implemented
- Core CRUD APIs (projects, tasks, templates)
- SSE log streaming
- WebSocket event system
- Database layer with SQLite
- Frontend integration
- Basic error handling

### ⏳ Not Yet Implemented
- Full AI engine integration (executors)
- GitHub authentication flow
- File watching system
- Complete MCP server functionality
- Comprehensive error recovery

## Development Workflow

1. Make changes to backend code
2. Run `cd backend && npm run typecheck` to verify types
3. Run `cd backend && npm run lint` to check linting
4. Run `cd backend && npm run format` to format code
5. Test with `npm run dev` to verify functionality
6. Frontend automatically hot-reloads; backend requires restart

## Debugging Tips
- Backend logs: Check console output and `*.log` files
- Database issues: Inspect `backend/data/vibe-kanban.db` with SQLite viewer
- API testing: Use tools like curl or Postman against port 3001
- WebSocket debugging: Browser DevTools Network tab
- Process issues: Set `DISABLE_WORKTREE_ORPHAN_CLEANUP=1` to debug worktree problems