import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileDiff, FileStat, ScopeOption, Turn, View } from '../types'

const DIFF_BUDGET = 90_000

type Repo = { root: string; index: string }
type GitOptions = { realIndex?: boolean; stdin?: string }
type Range = { from: string; to: string }

let repo: Repo | null = null

async function initRepo($: EngineInterface) {
  const id = await $.session.id()
  const found = await $.process.run([
    'git',
    'rev-parse',
    '--show-toplevel',
    '--path-format=absolute',
    '--git-path',
    `turn-diff-index-${id}`,
  ])
  const [root, index] = found.stdout.trim().split('\n')
  repo = found.exitCode === 0 && root && index ? { root, index } : null
  return repo !== null
}

async function dropIndex($: EngineInterface) {
  if (repo) await $.process.run(['rm', '-f', repo.index])
}

async function git($: EngineInterface, args: string[], options: GitOptions = {}) {
  if (!repo) return { ok: false, out: '', err: 'pas de repo git' }
  const run = await $.process.run(['git', ...args], {
    cwd: repo.root,
    env: options.realIndex ? {} : { GIT_INDEX_FILE: repo.index },
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  })
  return { ok: run.exitCode === 0, out: run.stdout, err: run.stderr.trim().split('\n')[0] ?? '' }
}

async function revParse($: EngineInterface, args: string[], options: GitOptions = {}) {
  const run = await git($, args, options)
  return run.ok ? run.out.trim() : null
}

async function snapshot($: EngineInterface) {
  const added = await git($, ['add', '-A'])
  return added.ok ? revParse($, ['write-tree']) : null
}

const parseNumstat = (out: string): FileStat[] =>
  out
    .split('\0')
    .filter(Boolean)
    .map(record => {
      const [added = '', removed = '', ...path] = record.split('\t')
      return { path: path.join('\t'), added: Number(added) || 0, removed: Number(removed) || 0 }
    })

const hunksOf = (diff: string) => {
  const first = /^@@/m.exec(diff)
  if (!first) return ''
  const hunks = diff.slice(first.index)
  return hunks.length <= DIFF_BUDGET ? hunks : hunks.slice(0, hunks.lastIndexOf('\n@@', DIFF_BUDGET) + 1)
}

async function numstat($: EngineInterface, range: Range) {
  return parseNumstat((await git($, ['diff', '--no-renames', '--numstat', '-z', range.from, range.to])).out)
}

async function fileDiff($: EngineInterface, range: Range, path: string): Promise<FileDiff> {
  return { path, diff: hunksOf((await git($, ['diff', '--no-renames', range.from, range.to, '--', path])).out) }
}

async function firstDiffs($: EngineInterface, range: Range, files: FileStat[]) {
  const chunks = (await git($, ['diff', '--no-renames', range.from, range.to])).out.split(/^(?=diff --git )/m)
  const diffs: FileDiff[] = []
  let used = 0
  for (const [i, file] of files.entries()) {
    const diff = hunksOf(chunks[i] ?? '')
    if (used + diff.length > DIFF_BUDGET) break
    used += diff.length
    diffs.push({ path: file.path, diff })
  }
  return diffs
}

async function applyDiff($: EngineInterface, range: Range, isReverse: boolean, path?: string) {
  const patch = await git($, ['diff', '--binary', '--no-renames', range.from, range.to, ...(path ? ['--', path] : [])])
  if (!patch.ok) return patch.err
  if (!patch.out) return ''
  const applied = await git($, ['apply', ...(isReverse ? ['-R'] : [])], { stdin: patch.out })
  return applied.ok ? '' : applied.err || 'git apply a échoué'
}

async function setStaged($: EngineInterface, path: string, isStaged: boolean) {
  const run = isStaged
    ? await git($, ['add', '--', path], { realIndex: true })
    : await git($, ['restore', '--staged', '--', path], { realIndex: true })
  return run.ok ? '' : run.err
}

async function baseBranch($: EngineInterface) {
  return (await revParse($, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])) ?? 'main'
}

async function scopeOptions($: EngineInterface, turns: Turn[]): Promise<ScopeOption[]> {
  const [last, ...older] = [...turns].reverse()
  const commits = (await git($, ['log', '-20', '--format=%h%x09%s'])).out.split('\n').filter(Boolean)
  return [
    ...(last ? [{ value: `turn:${last.n}`, label: 'Dernière réponse' }] : []),
    ...older.map(turn => ({ value: `turn:${turn.n}`, label: `T${turn.n} · ${turn.label}` })),
    { value: 'uncommitted', label: 'Non validées' },
    { value: 'unstaged', label: 'Non indexés' },
    { value: 'staged', label: 'Indexés' },
    ...commits.map(line => {
      const [sha = '', subject = ''] = line.split('\t')
      return { value: `commit:${sha}`, label: `Validé · ${sha} ${subject}`.slice(0, 80) }
    }),
    { value: 'branch', label: `Branche (${await baseBranch($)})` },
  ]
}

async function headTree($: EngineInterface) {
  return revParse($, ['rev-parse', 'HEAD^{tree}'])
}

async function indexTree($: EngineInterface) {
  return revParse($, ['write-tree'], { realIndex: true })
}

const pair = (from: string | null, to: string | null): Range | null => (from && to ? { from, to } : null)

async function scopeRange($: EngineInterface, scope: string, turns: Turn[]): Promise<Range | null> {
  const [kind = '', arg = ''] = scope.split(':')

  if (kind === 'turn') {
    const turn = turns.find(one => one.n === Number(arg))
    return turn ? { from: turn.from, to: turn.to } : null
  }
  if (kind === 'commit') return { from: `${arg}~1`, to: arg }
  if (kind === 'uncommitted') return pair(await headTree($), await snapshot($))
  if (kind === 'unstaged') return pair(await indexTree($), await snapshot($))
  if (kind === 'staged') return pair(await headTree($), await indexTree($))
  if (kind === 'branch') {
    const base = await revParse($, ['merge-base', 'HEAD', await baseBranch($)])
    return pair(base, await snapshot($))
  }
  return null
}

const PANE = 'turn-diff'
const EMPTY_VIEW: View = { scope: '', from: '', to: '', options: [], files: [], diffs: [], error: '' }
const turns = atom({ plugin: 'turn-diff', key: 'turns' } as const, [])
const view = atom({ plugin: 'turn-diff', key: 'view' } as const, EMPTY_VIEW)
const cards = atom({ plugin: 'turn-diff', key: 'cards' } as const, 0)

const label = (text: string) => text.trim().split('\n')[0]?.slice(0, 60) || '(suite)'
const total = (files: FileStat[], side: 'added' | 'removed') => files.reduce((sum, file) => sum + file[side], 0)
const plural = (count: number) => (count > 1 ? 's' : '')

let isReady = false

async function ensureReady($: EngineInterface) {
  if (isReady) return true
  isReady = await initRepo($)
  if (isReady) {
    await $.command.register({ name: 'turn-diff', description: 'Modifications de cette session, par réponse' })
  }
  return isReady
}

async function loadView($: EngineInterface, scope?: string, focusPath?: string) {
  const list = await read($, turns)
  const wanted = scope ?? (await read($, view)).scope
  const options = await scopeOptions($, list)
  const range = await scopeRange($, wanted, list)
  if (!range) {
    await update($, view, () => ({ ...EMPTY_VIEW, scope: wanted, options, error: 'Portée indisponible.' }))
    return
  }
  const files = await numstat($, range)
  const diffs = focusPath ? [await fileDiff($, range, focusPath)] : await firstDiffs($, range, files)
  await update($, view, () => ({ scope: wanted, ...range, options, files, diffs, error: '' }))
}

async function openPane($: EngineInterface, scope: string, focusPath?: string) {
  await loadView($, scope, focusPath)
  const opened = await $.ui.open({ id: PANE, title: 'Modifications' })
  if (!opened.isPlaced) $.ui.toast(`turn-diff : panneau non placé (${opened.reason})`)
}

async function toggleFile($: EngineInterface, path: string) {
  const current = await read($, view)
  if (current.diffs.some(one => one.path === path)) {
    await update($, view, v => ({ ...v, diffs: v.diffs.filter(one => one.path !== path) }))
    return
  }
  const added = await fileDiff($, current, path)
  await update($, view, v => {
    const diffs = [...v.diffs, added]
    while (diffs.length > 1 && diffs.reduce((sum, one) => sum + one.diff.length, 0) > DIFF_BUDGET) diffs.shift()
    return { ...v, diffs }
  })
}

async function fileAction($: EngineInterface, path: string, action: 'stage' | 'unstage' | 'revert') {
  const current = await read($, view)
  const error =
    action === 'revert' ? await applyDiff($, current, true, path) : await setStaged($, path, action === 'stage')
  if (error) $.ui.toast(`turn-diff : ${error}`)
  await loadView($)
}

async function toggleRevert($: EngineInterface, n: number) {
  const turn = (await read($, turns)).find(one => one.n === n)
  if (!turn) return
  const error = await applyDiff($, turn, !turn.isReverted)
  if (error) {
    $.ui.toast(`turn-diff : ${error}`)
    return
  }
  await update($, turns, list => list.map(one => (one.n === n ? { ...one, isReverted: !turn.isReverted } : one)))
}

export const register: Register = on => {
  const started = new Map<string, { text: string; from: string }>()
  const seenMessages = new Set<string>()
  let isTurnRunning = false
  let lastNewMessage: string | null = null

  on('session.start', async ($, e, next) => {
    if (!(await ensureReady($))) $.ui.toast('turn-diff : pas de repo git, inactif')
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await dropIndex($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    lastNewMessage = null
    await ensureReady($)
    const from = await snapshot($)
    if (from) started.set(e.turnId, { text: e.text, from })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isTurnRunning = false
    const start = started.get(e.turnId)
    started.delete(e.turnId)
    const to = start ? await snapshot($) : null

    if (start && to && to !== start.from) {
      const files = await numstat($, { from: start.from, to })
      const n = (await read($, turns)).length + 1
      await update($, turns, list => [
        ...list,
        { n, label: label(start.text), from: start.from, to, isAborted: e.isAborted, isReverted: false, files },
      ])
      if (lastNewMessage) await update($, memberOf(cards, { requestId: lastNewMessage }), () => n)
    }

    return next(e)
  })

  on('command.run', { command: 'turn-diff' }, async $ => {
    const last = (await read($, turns)).at(-1)
    await openPane($, last ? `turn:${last.n}` : 'uncommitted')
    return { text: 'Modifications ouvertes.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!seenMessages.has(e.requestId)) {
      seenMessages.add(e.requestId)
      if (isTurnRunning) lastNewMessage = e.requestId
    }
    const n = await read($, memberOf(cards, e))
    const turn = n ? (await read($, turns)).find(one => one.n === n) : undefined
    if (!turn) return next(e)

    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const count = turn.files.length

    return (
      <Box flexDirection="column">
        <Markdown text={e.props.text} />
        <Box flexDirection="column" borderStyle="round" borderDimColor marginTop={1} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="column">
              <Text bold dimColor={turn.isReverted}>
                {count} fichier{plural(count)} modifié{plural(count)}
                {turn.isReverted ? ' · annulé' : ''}
              </Text>
              <Text>
                <Text color="diffAdded">+{total(turn.files, 'added')}</Text>{' '}
                <Text color="diffRemoved">-{total(turn.files, 'removed')}</Text>
              </Text>
            </Box>
            <Box flexDirection="row" gap={1}>
              <Button
                key={`undo-${turn.n}`}
                label={turn.isReverted ? 'Rétablir ↻' : 'Annuler ↺'}
                onPress={() => toggleRevert($, turn.n)}
              />
              <Button
                key={`show-${turn.n}`}
                label="Afficher les modifications"
                onPress={() => openPane($, `turn:${turn.n}`)}
              />
            </Box>
          </Box>
          {turn.files.map(file => {
            const slash = file.path.lastIndexOf('/') + 1
            return (
              <Button key={`file-${turn.n}-${file.path}`} plain onPress={() => openPane($, `turn:${turn.n}`, file.path)}>
                <Text dimColor>{file.path.slice(0, slash)}</Text>
                {file.path.slice(slash)} <Text color="diffAdded">+{file.added}</Text>{' '}
                <Text color="diffRemoved">-{file.removed}</Text>
              </Button>
            )
          })}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, view)
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Ouvre ce panneau depuis le desktop.</Text>
    }

    const { Box, Text, Button, Code, Select } = $.ui.resolve(e)
    const kind = current.scope.split(':')[0]
    const canStage = kind === 'uncommitted' || kind === 'unstaged'
    const canRevert = kind === 'turn' || canStage

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center">
          <Select key="scope" options={current.options} value={current.scope} onSelect={value => loadView($, value)} />
          <Text color="diffAdded">+{total(current.files, 'added')}</Text>
          <Text color="diffRemoved">-{total(current.files, 'removed')}</Text>
          <Button key="refresh" label="↻" onPress={() => loadView($)} />
        </Box>
        {current.error ? <Text color="error">{current.error}</Text> : null}
        {!current.error && current.files.length === 0 ? <Text dimColor>Aucune modification.</Text> : null}
        {current.files.map(file => {
          const shown = current.diffs.find(one => one.path === file.path)
          return (
            <Box key={`file-${file.path}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Button key={`toggle-${file.path}`} plain onPress={() => toggleFile($, file.path)}>
                  {shown ? '▾' : '▸'} {file.path} <Text color="diffAdded">+{file.added}</Text>{' '}
                  <Text color="diffRemoved">-{file.removed}</Text>
                </Button>
                {canStage ? (
                  <Button key={`stage-${file.path}`} label="Stage" onPress={() => fileAction($, file.path, 'stage')} />
                ) : null}
                {kind === 'staged' ? (
                  <Button key={`unstage-${file.path}`} label="Unstage" onPress={() => fileAction($, file.path, 'unstage')} />
                ) : null}
                {canRevert ? (
                  <Button key={`revert-${file.path}`} label="Revert" onPress={() => fileAction($, file.path, 'revert')} />
                ) : null}
              </Box>
              {shown ? (
                shown.diff ? (
                  <Code source={shown.diff} format="diff" path={file.path} />
                ) : (
                  <Text dimColor>Pas de diff texte (binaire ou trop gros).</Text>
                )
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
