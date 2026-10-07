import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
  host: string
  port: number
  token: string
}

export const DEFAULT_CONFIG: ModuleConfig = { host: '127.0.0.1', port: 4192, token: '' }

export function getConfigFields(): SomeCompanionConfigField[] {
  return [
    {
      type: 'static-text',
      id: 'info',
      width: 12,
      label: 'LZ Scopes',
      value:
        'Connects to the bridge of LZ Scopes (desktop app: port 4192, npm start: 4192, otherwise the port from the log). Without a token the bridge only accepts connections from 127.0.0.1; for Companion on another computer start the app with LZS_HOST=0.0.0.0 and LZS_CONTROL_TOKEN.',
    },
    { type: 'textinput', id: 'host', label: 'Host', width: 6, default: DEFAULT_CONFIG.host, regex: Regex.SOMETHING },
    { type: 'number', id: 'port', label: 'Port', width: 3, default: DEFAULT_CONFIG.port, min: 1, max: 65535 },
    { type: 'textinput', id: 'token', label: 'Token (optional)', width: 12, default: '' },
  ]
}
