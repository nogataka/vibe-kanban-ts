# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
```bash
# Install all dependencies (frontend + backend)
npm run install:all

# Start development servers with hot reload (frontend + backend)
npm run dev

# Individual dev servers
npm run frontend:dev    # Frontend only (port 3000)
npm run backend:dev     # Backend only (port auto-assigned)

# Build production version
npm run build
```

### Testing & Validation
```bash
# Run all checks (frontend + backend)
npm run check

# Frontend specific
cd frontend && npm run lint          # Lint TypeScript/React code
cd frontend && npm run format:check  # Check formatting
cd frontend && npx tsc --noEmit     # TypeScript type checking

# Backend specific  
cd backend && npm run lint           # Lint TypeScript code
cd backend && npm run format:check   # Check formatting
cd backend && npm run typecheck      # TypeScript type checking
cd backend && npm run check          # Run all checks
```

### Database Operations
```bash
# Database migrations are automatically applied on backend startup
# SQLite database is created in data/ directory
# Database file: data/vibe-kanban.db
```

## Architecture Overview

### Tech Stack
- **Backend**: Node.js with Express, TypeScript, Knex.js for database
- **Frontend**: React 18 + TypeScript + Vite, Tailwind CSS, shadcn/ui components  
- **Database**: SQLite with Knex migrations
- **MCP Server**: Built-in Model Context Protocol server for AI agent integration

### Project Structure
```
backend/           # TypeScript/Express backend
├── src/
│   ├── routes/      # API routes (tasks, projects, auth, etc.)
│   ├── services/    # Business logic (deployment, database, worktree)
│   ├── executors/   # AI agent integrations (Claude, OpenAI, Gemini)
│   ├── middleware/  # Express middleware
│   ├── mcp/         # MCP server implementation
│   └── utils/       # Utilities (logger, browser, etc.)

frontend/          # React application
├── src/
│   ├── components/  # React components (TaskCard, ProjectCard, etc.)
│   ├── pages/      # Route pages
│   ├── hooks/      # Custom React hooks (useEventSourceManager, etc.)
│   └── lib/        # API client, utilities

shared/types.ts    # Shared TypeScript types
```

### Key Architectural Patterns

1. **Event Streaming**: Server-Sent Events (SSE) for real-time updates
   - Process logs stream to frontend via `/api/events/processes/:id/logs`
   - Task diffs stream via `/api/events/task-attempts/:id/diff`

2. **Git Worktree Management**: Each task execution gets isolated git worktree
   - Managed by `WorktreeManager` service
   - Automatic cleanup of orphaned worktrees

3. **Executor Pattern**: Pluggable AI agent executors
   - Each executor (Claude, Gemini, etc.) implements common interface
   - Actions: `coding_agent_initial`, `coding_agent_follow_up`, `script`

4. **MCP Integration**: Vibe Kanban acts as MCP server
   - Tools: `list_projects`, `list_tasks`, `create_task`, `update_task`, etc.
   - AI agents can manage tasks via MCP protocol

### API Patterns

- REST endpoints under `/api/*`
- Frontend dev server proxies to backend (configured in vite.config.ts)
- Authentication via GitHub OAuth (device flow)
- All database queries using Knex.js query builder

### Development Workflow

1. **Backend changes first**: When modifying both frontend and backend, start with backend
2. **Database migrations**: Handled automatically by Knex.js on startup
3. **Component patterns**: Follow existing patterns in `frontend/src/components/`
4. **Type safety**: Ensure TypeScript types are consistent between backend and frontend

### Testing Strategy

- **Backend tests**: TypeScript compilation and linting
- **Frontend tests**: TypeScript compilation and linting
- **Type checking**: Run `npm run check` to validate both frontend and backend
- **CI/CD**: GitHub Actions workflow in `.github/workflows/test.yml`

### Environment Variables

Build-time (set when building):
- `GITHUB_CLIENT_ID`: GitHub OAuth app ID (default: Bloop AI's app)
- `POSTHOG_API_KEY`: Analytics key (optional)

Runtime:
- `BACKEND_PORT`: Backend server port (default: auto-assign)
- `FRONTEND_PORT`: Frontend dev port (default: 3000)
- `HOST`: Backend host (default: 127.0.0.1)
- `DISABLE_WORKTREE_ORPHAN_CLEANUP`: Debug flag for worktrees