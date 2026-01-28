import z from "zod"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { Provider as SDK } from "ai"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { lazy } from "@/util/lazy"

/**
 * Self-hosted LLM provider for users running their own llama.cpp/vLLM/etc servers
 * Configured via opencode.json or environment variables
 */
export namespace SelfHosted {
  const log = Log.create({ service: "selfhosted" })

  export const ProviderConfig = z.object({
    name: z.string().default("Self-Hosted LLM"),
    baseURL: z.string().describe("Base URL of the self-hosted LLM API (e.g., http://192.168.1.52:31144/v1)"),
    apiKey: z.string().optional().describe("API key for authentication"),
    models: z.array(z.object({
      id: z.string().describe("Model ID as recognized by the server"),
      name: z.string().optional().describe("Display name for the model"),
      contextLength: z.number().optional().default(8192),
      maxOutput: z.number().optional().default(4096),
    })).optional(),
  })

  export type ProviderConfig = z.infer<typeof ProviderConfig>

  /**
   * Get self-hosted provider configuration from config or environment
   */
  export const getConfig = lazy(async (): Promise<ProviderConfig | null> => {
    const config = await Config.get()

    // Check for selfhosted config in opencode.json
    const selfhosted = config.provider?.["selfhosted"]
    if (selfhosted?.options) {
      try {
        return ProviderConfig.parse(selfhosted.options)
      } catch (e) {
        log.warn("invalid selfhosted config", { error: String(e) })
      }
    }

    // Check environment variables
    const baseURL = process.env.SELFHOSTED_API_URL || process.env.RAG_API_URL
    if (baseURL) {
      return {
        name: process.env.SELFHOSTED_NAME || "Self-Hosted LLM",
        baseURL: baseURL.endsWith("/v1") ? baseURL : `${baseURL}/v1`,
        apiKey: process.env.SELFHOSTED_API_KEY || process.env.RAG_API_KEY,
        models: [{
          id: process.env.SELFHOSTED_MODEL_ID || "qwen3",
          name: process.env.SELFHOSTED_MODEL_NAME || "Qwen3-14B",
          contextLength: parseInt(process.env.SELFHOSTED_CONTEXT_LENGTH || "8192"),
          maxOutput: parseInt(process.env.SELFHOSTED_MAX_OUTPUT || "4096"),
        }],
      }
    }

    return null
  })

  /**
   * Create the AI SDK provider instance
   */
  export async function createProvider(): Promise<SDK | null> {
    const config = await getConfig()
    if (!config) {
      log.info("no selfhosted config found")
      return null
    }

    log.info("creating selfhosted provider", {
      name: config.name,
      baseURL: config.baseURL,
      models: config.models?.map(m => m.id)
    })

    return createOpenAICompatible({
      name: "selfhosted",
      baseURL: config.baseURL,
      apiKey: config.apiKey || "no-key",
      headers: {
        "HTTP-Referer": "https://opencode.ai/",
      },
    })
  }

  /**
   * Get model definitions for the self-hosted provider
   */
  export async function getModels(): Promise<Record<string, any>> {
    const config = await getConfig()
    if (!config?.models) return {}

    const models: Record<string, any> = {}
    for (const model of config.models) {
      models[model.id] = {
        id: model.id,
        name: model.name || model.id,
        family: "selfhosted",
        release_date: new Date().toISOString().split("T")[0],
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        cost: {
          input: 0,
          output: 0,
        },
        limit: {
          context: model.contextLength || 8192,
          output: model.maxOutput || 4096,
        },
        options: {},
      }
    }
    return models
  }

  /**
   * Get provider info for the models registry
   */
  export async function getProviderInfo(): Promise<any | null> {
    const config = await getConfig()
    if (!config) return null

    return {
      id: "selfhosted",
      name: config.name,
      api: config.baseURL,
      npm: "@ai-sdk/openai-compatible",
      env: ["SELFHOSTED_API_KEY", "RAG_API_KEY"],
      models: await getModels(),
    }
  }
}
