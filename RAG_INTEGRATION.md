# RAG Integration for OpenCode

This fork of OpenCode adds Retrieval-Augmented Generation (RAG) capabilities for enhanced code context during AI interactions.

## Features

### Project Guardrails
- **Blocked Paths Protection**: Prevents opening dangerous system directories (`/`, `/root`, `/home`, `C:\`, etc.)
- **Project Marker Validation**: Requires a valid project marker (`.git`, `package.json`, `Cargo.toml`, etc.) to ensure only legitimate project directories are opened
- **Size Limits**: Configurable limits on files (10k), lines of code (500k), and total size (100MB)

### Automatic Codebase Sync
- Syncs your project codebase to a RAG API on first open
- Background sync with progress tracking
- Smart file filtering (ignores `node_modules`, `.git`, build artifacts, binaries)
- Supports 50+ programming language file extensions

### CLI Commands

```bash
# Sync project with RAG API
opencode sync

# Check sync status
opencode sync --status

# Force re-sync
opencode sync --force
```

## Configuration

### Environment Variables

```bash
# Required
RAG_API_URL=http://your-rag-api:8001
RAG_API_KEY=your-api-key

# Optional
RAG_API_ENABLED=true          # Enable RAG integration (default: auto-detect from URL)
RAG_AUTO_SYNC=true            # Auto-sync on changes (default: true)
RAG_SYNC_ON_OPEN=true         # Sync when project opens (default: true)
OPENCODE_DISABLE_GUARDRAILS=true  # Disable path safety checks (not recommended)
```

### opencode.json Configuration

```json
{
  "rag": {
    "enabled": true,
    "url": "http://localhost:8001",
    "api_key": "your-api-key",
    "auto_sync": true,
    "sync_on_open": true
  }
}
```

## RAG API Requirements

Your RAG API must implement these endpoints:

### POST `/api/v1/projects/{project_id}/sync`

Upload project files for indexing.

**Request:**
```json
{
  "files": [
    {
      "path": "src/main.ts",
      "content": "...",
      "size": 1234,
      "lines": 50
    }
  ]
}
```

**Response:**
```json
{
  "chunks_indexed": 150
}
```

### GET `/api/v1/projects/{project_id}/status`

Check project sync status.

**Response:**
```json
{
  "last_indexed": "2024-01-15T10:30:00Z",
  "chunk_count": 150
}
```

## Project Structure

```
packages/opencode/src/rag/
├── index.ts          # Module exports
├── guardrails.ts     # Path validation and safety checks
└── sync.ts           # Codebase sync functionality
```

## Supported File Types

The sync process includes files with these extensions:
- **JavaScript/TypeScript**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
- **Python**: `.py`, `.pyw`
- **Go**: `.go`
- **Rust**: `.rs`
- **Java/Kotlin**: `.java`, `.kt`, `.kts`, `.scala`
- **C/C++**: `.c`, `.cpp`, `.h`, `.hpp`
- **Web**: `.html`, `.css`, `.scss`, `.vue`, `.svelte`
- **Config**: `.json`, `.yaml`, `.toml`, `.xml`
- **Documentation**: `.md`, `.mdx`, `.rst`
- And 40+ more...

## Ignored Paths

The sync automatically skips:
- `node_modules/`, `.git/`, `dist/`, `build/`
- Binary files (`.exe`, `.dll`, `.so`, etc.)
- Media files (`.png`, `.jpg`, `.mp4`, etc.)
- Lock files (`package-lock.json`, `yarn.lock`, etc.)
- Cache directories (`.cache/`, `__pycache__/`, etc.)

## Events

The RAG sync emits events for UI integration:

- `rag.sync.started` - Sync initiated
- `rag.sync.progress` - Progress updates (files scanned, bytes uploaded)
- `rag.sync.complete` - Sync finished successfully
- `rag.sync.error` - Sync failed

## Limits

Default limits (configurable in code):
- **Max Files**: 10,000
- **Max Lines of Code**: 500,000
- **Max Size**: 100 MB
- **Project TTL**: 24 hours (re-sync after)
