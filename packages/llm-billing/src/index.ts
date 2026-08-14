/**
 * DeepSeek account-balance and remaining-task estimator, as a standalone host
 * plugin. It resolves the DeepSeek endpoint and API key from its own config and
 * the credential/environment seams, folds per-model billed-token usage across
 * reachable sessions, prices the historical average with the peak/off-peak
 * table, and exposes both through the `billing` Remote (`getBalance` and
 * `getEstimate`).
 * @module @deepseek-ai/dsh-llm-billing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { DeepSeekBalanceGateway, fetchDeepSeekBalance } from './balance.ts'
import {
  computeModelEstimates,
  DEFAULT_MODEL_PRICING,
  DEFAULT_PEAK_HOURS,
  foldSessionUsage,
  mergeSessionUsage,
  resolveBilling,
} from './billing.ts'
import type { BillingConfig, BillingConfigModel, PerModelUsage } from './billing.ts'
import type { DeepSeekBalance, DeepSeekBillingEstimate } from './types.ts'

export { DeepSeekBalanceGateway, fetchDeepSeekBalance, parseDeepSeekBalance } from './balance.ts'
export {
  computeModelEstimates,
  DEFAULT_MODEL_PRICING,
  DEFAULT_PEAK_HOURS,
  foldSessionUsage,
  isPeak,
  mergeSessionUsage,
  resolveBilling,
} from './billing.ts'
export type {
  BillingConfig,
  BillingConfigModel,
  DeepSeekModelPricing,
  DeepSeekTokenPrice,
  ModelUsage,
  PeakHourWindow,
  PerModelUsage,
  ResolvedBilling,
} from './billing.ts'
export type * from './types.ts'

export const name = 'llm-billing'

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'
/** Public API default; deployments may point elsewhere via $DEEPSEEK_BASE_URL. */
export const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** One advisory display row; requests are never restricted to this list. */
export interface BillingModel {
  /** Wire model id, e.g. `deepseek-v4-flash`. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
}

const DEFAULT_MODELS: BillingModel[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
]

/**
 * Plugin config. Every field is optional: the API key resolves per call from
 * {@link Config.apiKeyEnv} (credentials seam, then environment), the endpoint
 * falls back to `$DEEPSEEK_BASE_URL` then the public API, and the pricing
 * table and peak-hour windows fall back to the published DeepSeek rates.
 */
export interface Config {
  /** Credential reference (environment-variable name); defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; defaults to `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com`. */
  baseURL?: string
  /** Advisory display rows, in presentation order; defaults to V4 Flash and V4 Pro. */
  models?: BillingModel[]
  /** Pricing table and peak-hour windows; omission uses the published defaults. */
  billing?: BillingConfig
}

const billingModel: z<BillingModel> = z.object({
  id: z.string().required(),
  name: z.string(),
})

const tokenPrice: z<BillingConfigModel['peak']> = z.object({
  cacheHitInput: z.number().min(0),
  cacheMissInput: z.number().min(0),
  output: z.number().min(0),
})

const billingConfig: z<BillingConfig> = z.object({
  peakHours: z.array(z.object({
    start: z.number().step(1).min(0).max(23),
    end: z.number().step(1).min(0).max(24),
  })).default(DEFAULT_PEAK_HOURS),
  models: z.array(z.object({
    model: z.string().required(),
    peak: tokenPrice,
    offPeak: tokenPrice,
  })).default(DEFAULT_MODEL_PRICING),
})

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  models: z.array(billingModel).default(DEFAULT_MODELS),
  billing: billingConfig,
})

/**
 * Fold per-model billed-token usage across every reachable session: live
 * sessions first, then persisted sessions not already seen (a flushed live
 * session must not double-count). Sessions without a persistence backend still
 * contribute their live usage.
 * @param ctx - plugin context carrying the SessionStore and optional persistence.
 * @returns per-model usage aggregated across sessions.
 */
async function collectModelUsage(ctx: Context): Promise<PerModelUsage> {
  const merged: PerModelUsage = new Map()
  const seen = new Set<string>()
  const sessions = ctx.get('sessions')
  if (sessions !== undefined) {
    for (const session of sessions.list()) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      mergeSessionUsage(merged, foldSessionUsage(session.events))
    }
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined) {
    for (const header of await persistence.list()) {
      if (seen.has(header.id)) continue
      seen.add(header.id)
      const inspection = await persistence.inspect(header.id)
      mergeSessionUsage(merged, foldSessionUsage(inspection.events))
    }
  }
  return merged
}

/**
 * Register the `billing` Remote under the `billing` namespace.
 * @param ctx - owning plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const baseURL = (): string => config.baseURL
    ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
    ?? PUBLIC_BASE_URL
  const apiKeyRef = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)

  const resolveApiKey = async (): Promise<string> => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(apiKeyRef)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-billing', apiKeyRef)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(apiKeyRef)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-billing', apiKeyRef)
      }
    }
    throw new LlmError(
      `llm-billing: no API key; store ${apiKeyRef} through the credentials service or export it`,
      'MISSING_CREDENTIAL',
    )
  }

  const fetchBalance = async (): Promise<DeepSeekBalance> => {
    const apiKey = await resolveApiKey()
    return fetchDeepSeekBalance(baseURL(), apiKey)
  }

  const fetchEstimate = async (): Promise<DeepSeekBillingEstimate> => {
    const balance = await fetchBalance()
    const usage = await collectModelUsage(ctx)
    const billing = resolveBilling(config.billing)
    const catalog = (config.models ?? DEFAULT_MODELS).map(model => ({ id: model.id, name: model.name ?? model.id }))
    return { balance, models: computeModelEstimates(balance, usage, billing, new Date(), catalog) }
  }

  new DeepSeekBalanceGateway(ctx, { fetchBalance, fetchEstimate })
}
