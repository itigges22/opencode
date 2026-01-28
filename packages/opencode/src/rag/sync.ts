import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "../project/instance"
import { Guardrails } from "./guardrails"
import z from "zod"

export namespace RagSync {
  const log = Log.create({ service: "rag-sync" })

  // Configuration for the RAG API
  export interface Config {
    enabled: boolean
    baseUrl: string
    apiKey: string
    autoSync: boolean
    syncOnOpen: boolean
  }

  // Sync status tracking
  export interface SyncStatus {
    projectId: string
    state: "idle" | "scanning" | "uploading" | "indexing" | "complete" | "error"
    progress: {
      filesScanned: number
      filesTotal: number
      bytesUploaded: number
      bytesTotal: number
      linesOfCode: number
    }
    lastSync?: number
    error?: string
  }

  export const Event = {
    SyncStarted: BusEvent.define(
      "rag.sync.started",
      z.object({
        projectId: z.string(),
        directory: z.string(),
      }),
    ),
    SyncProgress: BusEvent.define(
      "rag.sync.progress",
      z.object({
        projectId: z.string(),
        state: z.string(),
        filesScanned: z.number(),
        filesTotal: z.number(),
        bytesUploaded: z.number(),
        bytesTotal: z.number(),
        linesOfCode: z.number(),
      }),
    ),
    SyncComplete: BusEvent.define(
      "rag.sync.complete",
      z.object({
        projectId: z.string(),
        filesIndexed: z.number(),
        linesOfCode: z.number(),
        duration: z.number(),
      }),
    ),
    SyncError: BusEvent.define(
      "rag.sync.error",
      z.object({
        projectId: z.string(),
        error: z.string(),
      }),
    ),
  }

  export const SyncError = NamedError.create(
    "RagSyncError",
    z.object({
      projectId: z.string(),
      message: z.string(),
    }),
  )

  export const LimitExceededError = NamedError.create(
    "RagLimitExceededError",
    z.object({
      projectId: z.string(),
      limit: z.string(),
      current: z.number(),
      max: z.number(),
    }),
  )

  // File patterns to ignore during sync
  const IGNORE_PATTERNS = [
    /node_modules/,
    /\.git/,
    /\.hg/,
    /\.svn/,
    /dist/,
    /build/,
    /target/,
    /\.next/,
    /\.nuxt/,
    /\.cache/,
    /\.venv/,
    /venv/,
    /\.env/,
    /__pycache__/,
    /\.pyc$/,
    /\.pyo$/,
    /\.class$/,
    /\.jar$/,
    /\.war$/,
    /\.o$/,
    /\.a$/,
    /\.so$/,
    /\.dylib$/,
    /\.dll$/,
    /\.exe$/,
    /\.bin$/,
    /\.png$/,
    /\.jpg$/,
    /\.jpeg$/,
    /\.gif$/,
    /\.ico$/,
    /\.svg$/,
    /\.woff$/,
    /\.woff2$/,
    /\.ttf$/,
    /\.eot$/,
    /\.mp3$/,
    /\.mp4$/,
    /\.avi$/,
    /\.mov$/,
    /\.pdf$/,
    /\.zip$/,
    /\.tar$/,
    /\.gz$/,
    /\.rar$/,
    /\.7z$/,
    /\.DS_Store/,
    /Thumbs\.db/,
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /bun\.lockb$/,
  ]

  // Supported code file extensions
  const CODE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".pyw",
    ".go",
    ".rs",
    ".rb",
    ".java",
    ".kt",
    ".kts",
    ".scala",
    ".c",
    ".cpp",
    ".cc",
    ".cxx",
    ".h",
    ".hpp",
    ".hxx",
    ".cs",
    ".fs",
    ".fsx",
    ".php",
    ".swift",
    ".m",
    ".mm",
    ".pl",
    ".pm",
    ".lua",
    ".r",
    ".R",
    ".jl",
    ".ex",
    ".exs",
    ".erl",
    ".hrl",
    ".clj",
    ".cljs",
    ".cljc",
    ".hs",
    ".lhs",
    ".ml",
    ".mli",
    ".nim",
    ".zig",
    ".v",
    ".vhdl",
    ".vhd",
    ".sv",
    ".svh",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".psm1",
    ".bat",
    ".cmd",
    ".awk",
    ".sed",
    ".vim",
    ".el",
    ".lisp",
    ".scm",
    ".rkt",
    ".dart",
    ".groovy",
    ".gradle",
    ".tf",
    ".hcl",
    ".yaml",
    ".yml",
    ".json",
    ".jsonc",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".styl",
    ".vue",
    ".svelte",
    ".astro",
    ".md",
    ".mdx",
    ".rst",
    ".txt",
    ".ini",
    ".cfg",
    ".conf",
    ".toml",
    ".env.example",
    ".gitignore",
    ".dockerignore",
    "Dockerfile",
    "Makefile",
    "CMakeLists.txt",
  ])

  function shouldIgnore(filePath: string): boolean {
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(filePath)) return true
    }
    return false
  }

  function isCodeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    const basename = path.basename(filePath)
    return CODE_EXTENSIONS.has(ext) || CODE_EXTENSIONS.has(basename)
  }

  interface FileInfo {
    path: string
    relativePath: string
    size: number
    lines: number
    content: string
  }

  /**
   * Scan a directory for code files
   */
  async function scanDirectory(
    directory: string,
    onProgress?: (scanned: number) => void,
  ): Promise<{ files: FileInfo[]; totalSize: number; totalLines: number }> {
    const files: FileInfo[] = []
    let totalSize = 0
    let totalLines = 0
    let scanned = 0

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(directory, fullPath)

        if (shouldIgnore(relativePath)) continue

        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && isCodeFile(fullPath)) {
          try {
            const stat = await fs.stat(fullPath)
            const content = await fs.readFile(fullPath, "utf-8")
            const lines = content.split("\n").length

            // Check limits
            if (files.length >= Guardrails.LIMITS.maxFiles) {
              throw new LimitExceededError({
                projectId: directory,
                limit: "files",
                current: files.length,
                max: Guardrails.LIMITS.maxFiles,
              })
            }

            if (totalLines + lines > Guardrails.LIMITS.maxLinesOfCode) {
              throw new LimitExceededError({
                projectId: directory,
                limit: "lines of code",
                current: totalLines + lines,
                max: Guardrails.LIMITS.maxLinesOfCode,
              })
            }

            if ((totalSize + stat.size) / (1024 * 1024) > Guardrails.LIMITS.maxSizeMB) {
              throw new LimitExceededError({
                projectId: directory,
                limit: "size (MB)",
                current: Math.round((totalSize + stat.size) / (1024 * 1024)),
                max: Guardrails.LIMITS.maxSizeMB,
              })
            }

            files.push({
              path: fullPath,
              relativePath,
              size: stat.size,
              lines,
              content,
            })

            totalSize += stat.size
            totalLines += lines
            scanned++

            if (onProgress) onProgress(scanned)
          } catch (err) {
            if (LimitExceededError.isInstance(err)) throw err
            // Skip files we can't read
            log.warn("skipping file", { path: fullPath, error: String(err) })
          }
        }
      }
    }

    await walk(directory)
    return { files, totalSize, totalLines }
  }

  /**
   * Sync a project to the RAG API
   */
  export async function syncProject(
    config: Config,
    projectId: string,
    directory: string,
  ): Promise<{ filesIndexed: number; linesOfCode: number }> {
    if (!config.enabled) {
      log.info("RAG sync disabled")
      return { filesIndexed: 0, linesOfCode: 0 }
    }

    const startTime = Date.now()
    log.info("starting RAG sync", { projectId, directory })

    Bus.publish(Event.SyncStarted, { projectId, directory })

    const status: SyncStatus = {
      projectId,
      state: "scanning",
      progress: {
        filesScanned: 0,
        filesTotal: 0,
        bytesUploaded: 0,
        bytesTotal: 0,
        linesOfCode: 0,
      },
    }

    try {
      // Scan directory
      const { files, totalSize, totalLines } = await scanDirectory(directory, (scanned) => {
        status.progress.filesScanned = scanned
        Bus.publish(Event.SyncProgress, {
          projectId,
          state: "scanning",
          ...status.progress,
        })
      })

      status.progress.filesTotal = files.length
      status.progress.bytesTotal = totalSize
      status.progress.linesOfCode = totalLines
      status.state = "uploading"

      log.info("scan complete", {
        files: files.length,
        size: Math.round(totalSize / 1024) + "KB",
        lines: totalLines,
      })

      // Upload to RAG API
      const response = await fetch(`${config.baseUrl}/api/v1/projects/${projectId}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          files: files.map((f) => ({
            path: f.relativePath,
            content: f.content,
            size: f.size,
            lines: f.lines,
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new SyncError({
          projectId,
          message: `RAG API error: ${response.status} - ${error}`,
        })
      }

      const result = (await response.json()) as { chunks_indexed: number }

      status.state = "complete"
      status.lastSync = Date.now()
      status.progress.bytesUploaded = totalSize

      const duration = Date.now() - startTime
      log.info("sync complete", {
        projectId,
        files: files.length,
        lines: totalLines,
        chunks: result.chunks_indexed,
        duration: duration + "ms",
      })

      Bus.publish(Event.SyncComplete, {
        projectId,
        filesIndexed: files.length,
        linesOfCode: totalLines,
        duration,
      })

      return { filesIndexed: files.length, linesOfCode: totalLines }
    } catch (err) {
      status.state = "error"
      status.error = err instanceof Error ? err.message : String(err)

      log.error("sync failed", { projectId, error: status.error })

      Bus.publish(Event.SyncError, {
        projectId,
        error: status.error,
      })

      throw err
    }
  }

  /**
   * Check if a project needs to be synced
   */
  export async function needsSync(config: Config, projectId: string): Promise<boolean> {
    if (!config.enabled) return false

    try {
      const response = await fetch(`${config.baseUrl}/api/v1/projects/${projectId}/status`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      })

      if (!response.ok) {
        if (response.status === 404) return true // Project doesn't exist yet
        return false
      }

      const status = (await response.json()) as { last_indexed?: string; chunk_count: number }

      if (!status.last_indexed) return true
      if (status.chunk_count === 0) return true

      // Check if last sync is older than TTL
      const lastIndexed = new Date(status.last_indexed).getTime()
      const ttlMs = Guardrails.LIMITS.projectTTLHours * 60 * 60 * 1000
      return Date.now() - lastIndexed > ttlMs
    } catch {
      return true
    }
  }

  /**
   * Get the current config from environment or settings
   */
  export function getConfig(): Config {
    return {
      enabled: process.env.RAG_API_ENABLED === "true" || !!process.env.RAG_API_URL,
      baseUrl: process.env.RAG_API_URL || "http://localhost:8001",
      apiKey: process.env.RAG_API_KEY || "",
      autoSync: process.env.RAG_AUTO_SYNC !== "false",
      syncOnOpen: process.env.RAG_SYNC_ON_OPEN !== "false",
    }
  }

  /**
   * Initialize sync for the current project (called on project open)
   */
  export async function initSync(): Promise<void> {
    const config = getConfig()
    if (!config.enabled || !config.syncOnOpen) return

    const projectId = Instance.project.id
    const directory = Instance.worktree

    log.info("checking if sync needed", { projectId, directory })

    if (await needsSync(config, projectId)) {
      log.info("sync needed, starting background sync")
      // Run sync in background
      syncProject(config, projectId, directory).catch((err) => {
        log.error("background sync failed", { error: String(err) })
      })
    }
  }
}
