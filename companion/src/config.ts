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
        'Verbindet sich mit der Bridge von LZ Scopes (Desktop-App: Port 4192, npm start: 4190, sonst der Port aus dem Log). Ohne Token nimmt die Bridge nur Verbindungen von 127.0.0.1 an; für Companion auf einem anderen Rechner die App mit LZS_HOST=0.0.0.0 und LZS_CONTROL_TOKEN starten.',
    },
    { type: 'textinput', id: 'host', label: 'Host', width: 6, default: DEFAULT_CONFIG.host, regex: Regex.SOMETHING },
    { type: 'number', id: 'port', label: 'Port', width: 3, default: DEFAULT_CONFIG.port, min: 1, max: 65535 },
    { type: 'textinput', id: 'token', label: 'Token (optional)', width: 12, default: '' },
  ]
}
