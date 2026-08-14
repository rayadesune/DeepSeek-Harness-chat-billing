/**
 * DeepSeek account-balance capability: the `GET /user/balance` transport and
 * the Remote gateway that exposes one snapshot to trusted clients. The fetch
 * takes an already-resolved endpoint and bearer token so the registering
 * plugin stays the one owner of credential policy; the gateway carries only a
 * `fetchBalance` thunk for the same reason.
 * @module @deepseek-ai/dsh-llm-billing/balance
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { DeepSeekBalance, DeepSeekBalanceLine, DeepSeekBillingEstimate } from './types.ts'

/** Map a balance HTTP status to a stable LlmError code. */
function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * Parse and validate the DeepSeek balance response at the wire boundary.
 * @param body - decoded JSON response body.
 * @returns the validated, detached balance snapshot.
 * @throws {@link LlmError} with code `TRANSPORT` when the body is malformed.
 */
export function parseDeepSeekBalance(body: unknown): DeepSeekBalance {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new LlmError('DeepSeek balance response was not a JSON object', 'TRANSPORT')
  }
  const response = body as Record<string, unknown>
  const isAvailable = response['is_available']
  const infos = response['balance_infos']
  if (typeof isAvailable !== 'boolean' || !Array.isArray(infos)) {
    throw new LlmError('DeepSeek balance response is missing is_available or balance_infos', 'TRANSPORT')
  }
  const lines: DeepSeekBalanceLine[] = infos.map((info, index) => {
    if (typeof info !== 'object' || info === null || Array.isArray(info)) {
      throw new LlmError(`DeepSeek balance line ${index} is malformed`, 'TRANSPORT')
    }
    const line = info as Record<string, unknown>
    const currency = line['currency']
    const total = line['total_balance']
    const granted = line['granted_balance']
    const toppedUp = line['topped_up_balance']
    if (typeof currency !== 'string' || currency.length === 0
      || typeof total !== 'string'
      || typeof granted !== 'string'
      || typeof toppedUp !== 'string') {
      throw new LlmError(`DeepSeek balance line ${index} has missing or invalid fields`, 'TRANSPORT')
    }
    return { currency, total, granted, toppedUp }
  })
  return { isAvailable, lines }
}

/**
 * Fetch one account-balance snapshot from `{baseURL}/user/balance`.
 * @param baseURL - resolved endpoint base; `/user/balance` is appended.
 * @param apiKey - resolved bearer token for this endpoint.
 * @param signal - optional cancellation.
 * @returns the validated balance snapshot.
 * @throws {@link LlmError} for transport, HTTP, or malformed-response failures.
 */
export async function fetchDeepSeekBalance(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DeepSeekBalance> {
  let response: Response
  try {
    response = await fetch(`${baseURL}/user/balance`, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
      },
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw new LlmError('DeepSeek balance request aborted by caller', 'ABORTED', { cause: error })
    throw new LlmError(`DeepSeek balance request to ${baseURL} failed`, 'TRANSPORT', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `DeepSeek balance request failed (HTTP ${response.status})`,
      httpErrorCode(response.status),
      { status: response.status },
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error: unknown) {
    throw new LlmError('DeepSeek balance response was not valid JSON', 'TRANSPORT', { cause: error })
  }
  return parseDeepSeekBalance(body)
}

/** Thunks the plugin binds to its own resolution and history access. */
export interface DeepSeekBalanceGatewayOptions {
  /** Fetch one balance snapshot through the plugin's resolved facts. */
  fetchBalance: () => Promise<DeepSeekBalance>
  /** Compute the full billing estimate (balance plus per-model task projections). */
  fetchEstimate: () => Promise<DeepSeekBillingEstimate>
}

/**
 * Remote-only service exposing the DeepSeek account balance and billing
 * estimate. The plugin that owns connection, credential, and session-history
 * resolution constructs it with the matching thunks, so the Remote boundary
 * never sees an endpoint, key, or the session store.
 */
export class DeepSeekBalanceGateway extends TypertRemoteService {
  private readonly options: DeepSeekBalanceGatewayOptions

  /**
   * Register the balance Remote under the `billing` namespace.
   * @param ctx - owning plugin context.
   * @param options - balance and estimate thunks bound to the plugin's facts.
   */
  constructor(ctx: Context, options: DeepSeekBalanceGatewayOptions) {
    super(ctx, 'billing')
    this.options = options
  }

  /**
   * Read the current DeepSeek account balance.
   * @returns the validated balance snapshot.
   */
  @Remote('getBalance')
  getBalance(): Promise<DeepSeekBalance> {
    return this.options.fetchBalance()
  }

  /**
   * Read the balance plus per-model remaining-task estimates.
   * @returns the full billing estimate.
   */
  @Remote('getEstimate')
  getEstimate(): Promise<DeepSeekBillingEstimate> {
    return this.options.fetchEstimate()
  }
}

export default DeepSeekBalanceGateway
