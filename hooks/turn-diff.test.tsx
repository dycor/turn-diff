import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DONE = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

function fakeEngine(on: On, trees: string[]) {
  const calls: string[][] = []
  on('session.id', () => ({ value: 'sess' }))
  on('command.register', () => ({ value: { command: 'turn-diff' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('process.run', (_$, e) => {
    const [, command, ...args] = e.argv
    calls.push([command ?? '', ...args, ...(e.init?.stdin ? [`stdin:${e.init.stdin}`] : [])])
    if (command === 'rev-parse') return ran('/repo\n/repo/.git/idx\n')
    if (command === 'write-tree') return ran(`${trees.shift()}\n`)
    if (command === 'diff' && args.includes('--numstat')) return ran('1\t0\tsrc/a.ts\0')
    if (command === 'diff') return ran('PATCH')
    return ran('')
  })
  return calls
}

test('only a turn that changes the tree is recorded', async ($, on) => {
  const calls = fakeEngine(on, ['tree-a', 'tree-b', 'tree-b', 'tree-b'])

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'edit a.ts', turnId: 't1' })
  await $.turn.complete({ ...DONE, turnId: 't1' })
  await $.turn.start({ text: 'just a question', turnId: 't2' })
  await $.turn.complete({ ...DONE, turnId: 't2' })

  expect(calls.filter(call => call[0] === 'diff')).toEqual([['diff', '--no-renames', '--numstat', '-z', 'tree-a', 'tree-b']])
})

test('the card lands on the last reply of the turn and undoes then redoes it', async ($, on) => {
  const calls = fakeEngine(on, ['tree-a', 'tree-b'])
  const reply = { plugin: 'turn-diff', surface: 'desktop', component: 'AssistantMessage' } as const

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'edit a.ts', turnId: 't1' })
  await $.ui.mount({ ...reply, requestId: 'm1', props: { text: 'first', isFirstOfReply: true } })
  const last = await $.ui.mount({ ...reply, requestId: 'm2', props: { text: 'done', isFirstOfReply: false } })
  await $.turn.complete({ ...DONE, turnId: 't1' })

  await last.press({ key: 'undo-1' })
  await last.press({ key: 'undo-1' })

  const applies = calls.filter(call => call[0] === 'apply')
  expect(applies).toEqual([['apply', '-R', 'stdin:PATCH'], ['apply', 'stdin:PATCH']])
})
