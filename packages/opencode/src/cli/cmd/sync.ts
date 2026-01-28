import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Instance } from "../../project/instance"
import { RagSync } from "../../rag/sync"
import { Bus } from "../../bus"

export const SyncCommand = cmd({
  command: "sync",
  describe: "Sync project codebase with RAG API for enhanced context",
  builder: (yargs: Argv) => {
    return yargs
      .option("status", {
        alias: ["s"],
        describe: "Show sync status without syncing",
        type: "boolean",
      })
      .option("force", {
        alias: ["f"],
        describe: "Force sync even if recently synced",
        type: "boolean",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const config = RagSync.getConfig()

      if (!config.enabled) {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + " RAG sync is not enabled")
        UI.println()
        UI.println("To enable RAG sync, set the following environment variables:")
        UI.println("  RAG_API_URL=http://your-rag-api:8001")
        UI.println("  RAG_API_KEY=your-api-key")
        UI.println("  RAG_API_ENABLED=true")
        return
      }

      const projectId = Instance.project.id
      const directory = Instance.worktree

      UI.println(UI.Style.TEXT_INFO_BOLD + "~" + UI.Style.TEXT_NORMAL + ` Project: ${projectId}`)
      UI.println(UI.Style.TEXT_DIM + `  Directory: ${directory}`)
      UI.println()

      if (args.status) {
        // Just show status
        const needsSync = await RagSync.needsSync(config, projectId)
        if (needsSync) {
          UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + " Sync needed")
        } else {
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓" + UI.Style.TEXT_NORMAL + " Up to date")
        }
        return
      }

      // Check if sync is needed
      if (!args.force) {
        const needsSync = await RagSync.needsSync(config, projectId)
        if (!needsSync) {
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓" + UI.Style.TEXT_NORMAL + " Already synced (use --force to re-sync)")
          return
        }
      }

      // Subscribe to sync events for progress display
      let lastState = ""
      const unsubscribe = Bus.subscribe(RagSync.Event.SyncProgress, (event) => {
        const { state, filesScanned, filesTotal, linesOfCode } = event.properties
        if (state !== lastState) {
          lastState = state
          UI.println()
        }

        const progress =
          filesTotal > 0 ? ` [${filesScanned}/${filesTotal}]` : filesScanned > 0 ? ` [${filesScanned} files]` : ""

        const loc = linesOfCode > 0 ? ` ${(linesOfCode / 1000).toFixed(1)}k LOC` : ""

        process.stdout.write(`\r${UI.Style.TEXT_INFO_BOLD}~${UI.Style.TEXT_NORMAL} ${state}...${progress}${loc}`)
      })

      try {
        UI.println(UI.Style.TEXT_INFO_BOLD + "~" + UI.Style.TEXT_NORMAL + " Starting sync...")

        const result = await RagSync.syncProject(config, projectId, directory)

        UI.println()
        UI.println()
        UI.println(
          UI.Style.TEXT_SUCCESS_BOLD +
            "✓" +
            UI.Style.TEXT_NORMAL +
            ` Synced ${result.filesIndexed} files (${(result.linesOfCode / 1000).toFixed(1)}k lines of code)`,
        )
      } catch (err) {
        UI.println()
        UI.println()
        UI.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      } finally {
        unsubscribe()
      }
    })
  },
})
