import path from "path"
import os from "os"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

export namespace Guardrails {
  const log = Log.create({ service: "guardrails" })

  // Dangerous root paths that should never be opened as projects
  const BLOCKED_PATHS_UNIX = [
    "/",
    "/root",
    "/home",
    "/etc",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/opt",
    "/tmp",
    "/proc",
    "/sys",
    "/dev",
    "/boot",
    "/run",
    "/srv",
    "/mnt",
    "/media",
  ]

  const BLOCKED_PATHS_WINDOWS = [
    "C:\\",
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\Users",
    "C:\\ProgramData",
    "D:\\",
    "E:\\",
  ]

  // Project marker files that indicate a valid project directory
  const PROJECT_MARKERS = [
    ".git",
    ".hg",
    ".svn",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "CMakeLists.txt",
    "Makefile",
    "setup.py",
    "pyproject.toml",
    "requirements.txt",
    "Gemfile",
    "composer.json",
    ".opencode-project", // explicit marker
    "opencode.json",
    "opencode.jsonc",
  ]

  // Size limits for sync
  export const LIMITS = {
    maxFiles: 10000,
    maxLinesOfCode: 500000,
    maxSizeMB: 100,
    projectTTLHours: 24,
  }

  export const DangerousPathError = NamedError.create(
    "DangerousPathError",
    z.object({
      path: z.string(),
      reason: z.string(),
    }),
  )

  export const NoProjectMarkerError = NamedError.create(
    "NoProjectMarkerError",
    z.object({
      path: z.string(),
      markers: z.array(z.string()),
    }),
  )

  /**
   * Normalize a path for comparison (resolve symlinks, normalize case on Windows)
   */
  function normalizePath(p: string): string {
    try {
      const resolved = path.resolve(p)
      // On Windows, normalize to lowercase for comparison
      if (process.platform === "win32") {
        return resolved.toLowerCase()
      }
      return resolved
    } catch {
      return p
    }
  }

  /**
   * Check if a path is a blocked system directory
   */
  export function isBlockedPath(targetPath: string): { blocked: boolean; reason?: string } {
    const normalized = normalizePath(targetPath)
    const blockedPaths = process.platform === "win32" ? BLOCKED_PATHS_WINDOWS : BLOCKED_PATHS_UNIX

    for (const blocked of blockedPaths) {
      const normalizedBlocked = normalizePath(blocked)

      // Exact match
      if (normalized === normalizedBlocked) {
        return {
          blocked: true,
          reason: `Cannot open "${targetPath}" - this is a protected system directory`,
        }
      }

      // Check if it's a direct child of blocked root paths (like /home/user is ok, /home is not)
      if (blocked === "/" && normalized === "/") {
        return {
          blocked: true,
          reason: `Cannot open filesystem root "/"`,
        }
      }
    }

    // Special check for home directory root
    const homeDir = os.homedir()
    if (normalized === normalizePath(homeDir)) {
      return {
        blocked: true,
        reason: `Cannot open home directory "${homeDir}" directly - please open a specific project folder`,
      }
    }

    return { blocked: false }
  }

  /**
   * Check if a directory has valid project markers
   */
  export async function hasProjectMarker(directory: string): Promise<{ valid: boolean; marker?: string }> {
    for (const marker of PROJECT_MARKERS) {
      const markerPath = path.join(directory, marker)
      try {
        const file = Bun.file(markerPath)
        if (await file.exists()) {
          return { valid: true, marker }
        }
      } catch {
        // Continue checking other markers
      }
    }

    // Also check parent directories for .git (worktree support)
    let current = directory
    const root = path.parse(current).root
    while (current !== root) {
      const gitPath = path.join(current, ".git")
      try {
        const file = Bun.file(gitPath)
        if (await file.exists()) {
          return { valid: true, marker: ".git (parent)" }
        }
      } catch {
        // Continue
      }
      current = path.dirname(current)
    }

    return { valid: false }
  }

  /**
   * Validate a directory for use as a project
   * Throws an error if the directory is not safe to use
   */
  export async function validateProjectDirectory(directory: string): Promise<void> {
    log.info("validating project directory", { directory })

    // Check for blocked paths
    const blockCheck = isBlockedPath(directory)
    if (blockCheck.blocked) {
      log.warn("blocked path detected", { directory, reason: blockCheck.reason })
      throw new DangerousPathError({
        path: directory,
        reason: blockCheck.reason!,
      })
    }

    // Check for project markers
    const markerCheck = await hasProjectMarker(directory)
    if (!markerCheck.valid) {
      log.warn("no project marker found", { directory })
      throw new NoProjectMarkerError({
        path: directory,
        markers: PROJECT_MARKERS,
      })
    }

    log.info("project directory validated", { directory, marker: markerCheck.marker })
  }

  /**
   * Get a user-friendly message about why a directory was rejected
   */
  export function getBlockedPathMessage(error: unknown): string {
    if (DangerousPathError.isInstance(error)) {
      return error.data.reason
    }
    if (NoProjectMarkerError.isInstance(error)) {
      return [
        `Directory "${error.data.path}" does not appear to be a project.`,
        "",
        "Please open a directory containing one of these project markers:",
        ...error.data.markers.slice(0, 5).map((m) => `  - ${m}`),
        "  ...",
        "",
        "Or create an empty .opencode-project file to mark it as a project.",
      ].join("\n")
    }
    return "Unknown error validating project directory"
  }
}
