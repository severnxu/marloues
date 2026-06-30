/**
 * Gateway Initializer - starts the HTTP gateway using store configuration
 */

import { startServer, stopServer, RouteDecision, RouteResolver } from './server'
import { configurePipeline } from './pipeline'
import { store } from '../store'
import type { ProtocolId } from './protocol'
import { log } from './logger'

let gatewayStarted = false
let gatewayPort = 0

export async function startGateway(): Promise<{ port: number } | null> {
  if (gatewayStarted) {
    log('[Gateway] Already started')
    return { port: gatewayPort }
  }

  const provider = store.getSelectedProvider()
  if (!provider) {
    log('[Gateway] No provider configured, starting with empty config')
  }

  log(`[Gateway] Starting with provider: ${provider?.name ?? 'none'} (${provider?.baseUrl ?? 'n/a'})`)

  // Configure route resolver using store's provider — re-reads store on each request
  // so provider changes take effect without restarting the gateway
  const resolveRoute: RouteResolver = (_sourceProtocol: ProtocolId, model: string): RouteDecision[] => {
    const currentProvider = store.getSelectedProvider()
    if (!currentProvider) return []
    return [{
      targetProvider: currentProvider.id,
      targetModel: currentProvider.model || model,
      targetProtocol: 'openai-chat',
      targetBaseUrl: currentProvider.baseUrl,
      apiKey: currentProvider.apiKey
    }]
  }

  // Configure pipeline
  configurePipeline({ resolveRoute })

  // Model list — re-reads store on each request
  const getModels = (): string[] => {
    const providers = store.get('providers')
    const selected = store.getSelectedProvider()
    const models = providers
      .filter(p => p.enabled && p.model)
      .map(p => p.model!)
    if (selected?.model && !models.includes(selected.model)) {
      models.unshift(selected.model)
    }
    return Array.from(new Set(models))
  }

  // Start server on port 8080 (or next available if in use)
  gatewayPort = await startServer({
    port: 8080,
    resolveRoute,
    getModels,
  })

  gatewayStarted = true
  log(`[Gateway] Started successfully on port ${gatewayPort}`)
  return { port: gatewayPort }
}

export async function stopGateway(): Promise<void> {
  if (!gatewayStarted) {
    return
  }

  await stopServer()
  gatewayStarted = false
  log('[Gateway] Stopped')
}

export function isGatewayStarted(): boolean {
  return gatewayStarted
}

export function getGatewayPort(): number {
  return gatewayPort
}
