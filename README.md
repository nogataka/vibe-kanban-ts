## Overview

AI coding agents are increasingly writing the world's code and human engineers now spend the majority of their time planning, reviewing, and orchestrating tasks. Vibe Kanban streamlines this process, enabling you to:

- Easily switch between different coding agents
- Orchestrate the execution of multiple coding agents in parallel or in sequence
- Quickly review work and start dev servers
- Track the status of tasks that your coding agents are working on
- Centralise configuration of coding agent MCP configs

You can watch a video overview [here](https://youtu.be/TFT3KnZOOAk).

## TypeScript/Node.js Version

This is the TypeScript/Node.js implementation of Vibe Kanban, providing full compatibility with the original Rust version while leveraging the JavaScript ecosystem.

## Installation

Make sure you have authenticated with your favourite coding agent. A full list of supported coding agents can be found in the [docs](https://vibekanban.com/). Then in your terminal run:

```bash
npx vibe-kanban
```

## Documentation

Please head to the [website](https://vibekanban.com) for the latest documentation and user guides.

## Support

Please open an issue on this repo if you find any bugs or have any feature requests.

## Contributing

We would prefer that ideas and changes are raised with the core team via GitHub issues, where we can discuss implementation details and alignment with the existing roadmap. Please do not open PRs without first discussing your proposal with the team.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (>=18)
- [npm](https://www.npmjs.com/) (>=9) or [pnpm](https://pnpm.io/) (>=8)

### Project Structure

```
vibe-kanban/
├── backend/         # Node.js/TypeScript backend
│   ├── server/      # Express API server
│   ├── db/          # Database layer (SQLite)
│   ├── services/    # Business logic
│   ├── executors/   # AI engine integration
│   ├── deployment/  # Deployment management
│   └── utils/       # Shared utilities
├── frontend/        # React UI
└── shared/          # Shared TypeScript types
```

### Installation

Install all dependencies:
```bash
npm run install:all
```

### Running the Development Server

Start both frontend and backend in development mode:
```bash
npm run dev
```

This will start:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

Individual servers:
```bash
npm run frontend:dev  # Frontend only
npm run backend:dev   # Backend only
```

### Building

Build both frontend and backend:
```bash
npm run build
```

### Testing & Quality

```bash
# Type checking
npm run check          # Check both frontend and backend
npm run backend:check  # Backend only
npm run frontend:check # Frontend only

# Linting & Formatting (backend)
cd backend
npm run lint           # ESLint
npm run format         # Prettier format
npm run format:check   # Prettier check
npm run typecheck      # TypeScript check
```

### Database Management

```bash
cd backend
npm run db:migrate     # Run migrations
npm run db:reset       # Reset database
```

### Environment Variables

The following environment variables can be configured:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GITHUB_CLIENT_ID` | Build-time | `Ov23li9bxz3kKfPOIsGm` | GitHub OAuth app client ID for authentication |
| `POSTHOG_API_KEY` | Build-time | Empty | PostHog analytics API key (disables analytics if empty) |
| `POSTHOG_API_ENDPOINT` | Build-time | Empty | PostHog analytics endpoint (disables analytics if empty) |
| `PORT` | Runtime | `3001` | Backend server port |
| `BACKEND_PORT` | Runtime | `3001` | Alternative backend server port |
| `FRONTEND_PORT` | Runtime | `3000` | Frontend development server port |
| `HOST` | Runtime | `127.0.0.1` | Backend server host |
| `DISABLE_WORKTREE_ORPHAN_CLEANUP` | Runtime | Not set | Disable git worktree cleanup (for debugging) |

### Port Configuration

Development ports are configured in `.dev-ports.json`:
```json
{
  "frontend": 3000,
  "backend": 3001
}
```

### API Compatibility

This TypeScript/Node.js version maintains 95%+ API compatibility with the original Rust implementation. See `API_COMPARISON_FINAL.md` for detailed compatibility information.

### Custom GitHub OAuth App (Optional)

By default, Vibe Kanban uses Bloop AI's GitHub OAuth app for authentication. To use your own GitHub app for self-hosting or custom branding:

1. Create a GitHub OAuth App at [GitHub Developer Settings](https://github.com/settings/developers)
2. Enable "Device Flow" in the app settings
3. Set scopes to include `user:email,repo`
4. Set the environment variable:
   ```bash
   GITHUB_CLIENT_ID=your_client_id_here npm run build
   ```

## Migration from Rust Version

This TypeScript/Node.js implementation is designed to be a drop-in replacement for the Rust version. All data formats, API endpoints, and frontend interactions remain compatible. Simply stop the Rust server and start the Node.js server to switch implementations.

## Performance Considerations

While the TypeScript/Node.js version may have slightly different performance characteristics compared to the Rust version, it offers:
- Easier deployment and maintenance
- Broader ecosystem compatibility
- Simplified development workflow
- Full feature parity

## License

See the LICENSE file for details.

This project is a React port of [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban),
originally licensed under Apache License 2.0.  
Additional modifications © 2025 nogataka.