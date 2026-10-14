export type FileStat = { path: string; added: number; removed: number }

export type FileDiff = { path: string; diff: string }

export type Turn = {
  n: number
  label: string
  from: string
  to: string
  isAborted: boolean
  isReverted: boolean
  files: FileStat[]
}

export type ScopeOption = { value: string; label: string }

export type View = {
  scope: string
  from: string
  to: string
  options: ScopeOption[]
  files: FileStat[]
  diffs: FileDiff[]
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'turn-diff': { turns: Turn[]; view: View; cards: StateFamily<number> }
  }
}
