import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import { ScopesClient } from './client.js'
import type { Command } from './commands.js'
import { DEFAULT_CONFIG, getConfigFields, type ModuleConfig } from './config.js'
import { updateActions } from './actions.js'
import { FEEDBACK_IDS, updateFeedbacks } from './feedbacks.js'
import { updatePresets } from './presets.js'
import { EMPTY_STATE, VARIABLES, choicesKey, normalizeState, variableValues, type ScopesState } from './state.js'
import { UpgradeScripts } from './upgrades.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> {
  config: ModuleConfig = DEFAULT_CONFIG
  state: ScopesState = { ...EMPTY_STATE }
  bridgeUp = false
  appConnected = false
  private client: ScopesClient | null = null
  private choices = ''

  constructor(internal: unknown) {
    super(internal)
  }

  async init(config: ModuleConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.setVariableDefinitions(VARIABLES)
    this.rebuild()
    this.startClient()
  }

  async destroy(): Promise<void> {
    this.client?.destroy()
    this.client = null
  }

  async configUpdated(config: ModuleConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startClient()
  }

  getConfigFields() {
    return getConfigFields()
  }

  /** Send a command; errors show up in the log and the connection status. */
  async run(command: Command): Promise<void> {
    const reply = await (this.client?.send(command) ?? Promise.resolve({ ok: false, error: 'Nicht verbunden' }))
    if (!reply.ok) this.log('warn', `${command.cmd}: ${reply.error ?? 'fehlgeschlagen'}`)
  }

  private rebuild(): void {
    updateActions(this)
    updateFeedbacks(this)
    updatePresets(this)
  }

  private status(): void {
    if (!this.bridgeUp) this.updateStatus(InstanceStatus.ConnectionFailure, 'Bridge nicht erreichbar')
    else if (!this.appConnected) this.updateStatus(InstanceStatus.UnknownWarning, 'Bridge erreichbar, LZ-Scopes-Fenster nicht verbunden')
    else this.updateStatus(InstanceStatus.Ok)
  }

  private startClient(): void {
    this.client?.destroy()
    this.updateStatus(InstanceStatus.Connecting)
    const c = new ScopesClient(this.config)
    this.client = c
    c.onBridge = (up) => {
      this.bridgeUp = up
      if (!up) this.appConnected = false
      this.status(); this.publish()
    }
    c.onApp = (connected) => {
      if (connected === this.appConnected) return
      this.appConnected = connected
      if (!connected) this.state = { ...EMPTY_STATE }
      this.status(); this.publish()
    }
    c.onState = (raw) => {
      if (raw == null) return
      this.state = normalizeState(raw)
      const key = choicesKey(this.state)
      if (key !== this.choices) { this.choices = key; this.rebuild() }
      this.publish()
    }
    c.onError = (m) => this.log('debug', m)
    c.connect()
  }

  private publish(): void {
    this.setVariableValues(variableValues(this.state, this.appConnected))
    this.checkFeedbacks(...FEEDBACK_IDS)
  }
}

runEntrypoint(ModuleInstance, UpgradeScripts)
