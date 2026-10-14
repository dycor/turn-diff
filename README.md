# turn-diff

**English** · [Français](README.fr.md)

A Claude Code mod that shows, prompt by prompt, what Claude changed in your git repo — and undoes it in one click.

The desktop Changes pane shows the whole uncommitted diff at once. turn-diff splits that diff by reply: every prompt that touches files gets its own card, with its files, its `+/-` counts and an Undo button.

> The mod's interface is in French for now. The examples below show the labels as they appear, with their English meaning.

## Install

In a `claude` session started from a terminal:

```
/plugin install turn-diff --marketplace dycor/turn-diff
```

Answer `y` to add the marketplace, then pick the user scope (Enter). The mod is active right away, and in every new session after that — desktop Code tab sessions included.

The mod only runs inside a git repo; elsewhere it shows `turn-diff : pas de repo git, inactif` ("no git repo, inactive") and does nothing.

## Examples

### A card under every reply that changes files

Prompt: *"add 7 console logs across 5 different files"*. Under Claude's last reply:

```
╭────────────────────────────────────────────────────────────────────────╮
│ 5 fichiers modifiés                [Annuler ↺] [Afficher les modifications] │
│ +7 -0                                                                  │
│ packages/acl/src/subjects.ts +2 -0                                     │
│ packages/acl/src/enums/pages.enum.ts +2 -0                             │
│ packages/acl/src/permissions/admin-roles.ts +1 -0                      │
│ packages/acl/src/permissions/roles.ts +1 -0                            │
│ packages/acl/src/permissions/feature-flag-permissions.ts +1 -0         │
╰────────────────────────────────────────────────────────────────────────╯
```

*5 files changed · [Undo ↺] [Show changes]*

- **Annuler ↺** (Undo) reverts this prompt's changes only; earlier and later prompts stay. The card turns into `5 fichiers modifiés · annulé` (undone) and the button becomes **Rétablir ↻** (Redo).
- Clicking a file opens the pane straight on its diff.
- A prompt that changes nothing (a plain question) gets no card.

Changes made through Bash (`sed`, scripts, codemods…) count too: turn-diff compares the repo before and after each prompt, not just Edit/Write calls.

### The "Modifications" pane

**Afficher les modifications** (Show changes) or the `/turn-diff` command opens a pane:

```
[Dernière réponse ▾]  +7  -0  [↻]

▾ packages/acl/src/subjects.ts +2 -0                         [Revert]
    @@ -42,3 +42,5 @@ export const subjects = …
    +console.log('turn-diff test 1: subjects');
    +console.log('turn-diff test 2: subjects');

▸ packages/acl/src/enums/pages.enum.ts +2 -0                 [Revert]
▸ packages/acl/src/permissions/admin-roles.ts +1 -0          [Revert]
```

The menu at the top picks what the diff covers:

| Scope | Label in the menu | Compares |
| --- | --- | --- |
| Last reply, any earlier prompt | `Dernière réponse`, `T1 · <prompt>`, `T2 · …` | one prompt's changes in this session |
| Uncommitted | `Non validées` | `HEAD` ↔ working tree |
| Unstaged | `Non indexés` | index ↔ working tree (**Stage** / **Revert** per file) |
| Staged | `Indexés` | `HEAD` ↔ index (**Unstage** per file) |
| A commit | `Validé · <sha> <message>` | one of the last 20 commits |
| Branch | `Branche (origin/main)` | merge-base with the base branch ↔ working tree |

Click a file to fold or unfold its diff.

## How it works

- At the start and end of each prompt, turn-diff snapshots the working tree (`git add -A` + `git write-tree`) into a temporary git index (`GIT_INDEX_FILE`, under `.git/`). Your real index is never touched and nothing is committed.
- A prompt's card is the diff between those two trees. **Undo** applies it in reverse with `git apply -R`; **Redo** applies it again.
- The temporary index is deleted when the session ends.

## Limits

- Cards last for the session: they are gone after a restart.
- **Undo** fails cleanly (a toast with the git error) if a later prompt changed the same lines.
- Files ignored by `.gitignore` are not tracked.
- Very large diffs are truncated in the pane; binary files have no text diff.

## Development

```bash
claude plugin validate .
claude plugin test .
```

## License

MIT
