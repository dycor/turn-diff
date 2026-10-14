# turn-diff

Mod Claude Code : voir, prompt par prompt, ce que Claude a modifié dans ton repo git — et l'annuler en un clic.

Le panneau Changes du desktop montre tout le diff non commité d'un bloc. turn-diff découpe ce diff par réponse : chaque prompt qui touche des fichiers obtient sa carte, avec ses fichiers, ses `+/-` et un bouton Annuler.

## Installation

Dans une session `claude` lancée depuis un terminal :

```
/plugin install turn-diff --marketplace dycor/turn-diff
```

Réponds `y` pour ajouter la marketplace, puis choisis la portée utilisateur (Entrée). Le mod est actif tout de suite, et dans chaque nouvelle session ensuite — y compris les sessions de l'onglet Code du desktop.

Le mod ne s'active que dans un repo git ; ailleurs il affiche `turn-diff : pas de repo git, inactif` et ne fait rien.

## Exemples

### Une carte sous chaque réponse qui modifie des fichiers

Prompt : *« rajoute 7 console log dans 5 fichiers différents »*. Sous la dernière réponse de Claude :

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

- **Annuler ↺** retire les changements de ce prompt seulement (les prompts précédents et suivants restent). La carte passe en `5 fichiers modifiés · annulé` et le bouton devient **Rétablir ↻**.
- Un clic sur un fichier ouvre le panneau directement sur son diff.
- Un prompt qui ne modifie rien (une simple question) n'a pas de carte.

Les modifications faites via Bash (`sed`, scripts, codemods…) comptent aussi : turn-diff compare l'état du repo avant et après chaque prompt, pas seulement les appels à Edit/Write.

### Le panneau « Modifications »

**Afficher les modifications** ou la commande `/turn-diff` ouvre un panneau :

```
[Dernière réponse ▾]  +7  -0  [↻]

▾ packages/acl/src/subjects.ts +2 -0                         [Revert]
    @@ -42,3 +42,5 @@ export const subjects = …
    +console.log('turn-diff test 1: subjects');
    +console.log('turn-diff test 2: subjects');

▸ packages/acl/src/enums/pages.enum.ts +2 -0                 [Revert]
▸ packages/acl/src/permissions/admin-roles.ts +1 -0          [Revert]
```

Le menu en haut change la portée du diff :

| Portée | Ce qui est comparé |
| --- | --- |
| Dernière réponse, `T1 · <prompt>`, `T2 · …` | les changements d'un prompt de la session |
| Non validées | `HEAD` ↔ arbre de travail |
| Non indexés | index ↔ arbre de travail (boutons **Stage** / **Revert** par fichier) |
| Indexés | `HEAD` ↔ index (bouton **Unstage** par fichier) |
| `Validé · <sha> <message>` | un des 20 derniers commits |
| Branche (`origin/main`) | merge-base avec la branche de base ↔ arbre de travail |

Clique sur un fichier pour plier / déplier son diff.

## Comment ça marche

- Au début et à la fin de chaque prompt, turn-diff prend un instantané de l'arbre de travail (`git add -A` + `git write-tree`) dans un index git temporaire (`GIT_INDEX_FILE`, sous `.git/`). Ton vrai index n'est jamais touché, rien n'est commité.
- La carte d'un prompt est le diff entre ces deux arbres. **Annuler** applique ce diff à l'envers avec `git apply -R` ; **Rétablir** le réapplique.
- L'index temporaire est supprimé à la fin de la session.

## Limites

- Les cartes vivent le temps de la session : elles disparaissent au redémarrage.
- **Annuler** échoue proprement (toast avec l'erreur git) si un prompt suivant a modifié les mêmes lignes.
- Les fichiers ignorés par `.gitignore` ne sont pas suivis.
- Les diffs très gros sont tronqués dans le panneau ; les fichiers binaires n'ont pas de diff texte.
- Interface en français.

## Développement

```bash
claude plugin validate .
claude plugin test .
```

## Licence

MIT
