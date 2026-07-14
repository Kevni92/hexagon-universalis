# Contributing

## Arbeitsweise

Diese Regeln gelten vollständig in Ergänzung zu [AGENTS.md](./AGENTS.md).

- Jede Idee, jedes Feature, jeder Bugfix und jedes Refactoring beginnt mit einem GitHub Issue.
- Pro Feature-Branch genau ein Issue.
- Branch-Namensschema:
  - `feat/<issue-number>-<slug>`
  - `fix/<issue-number>-<slug>`
  - `chore/<issue-number>-<slug>`
  - `test/<issue-number>-<slug>`
  - `data/<issue-number>-<slug>`
  - `perf/<issue-number>-<slug>`
- Niemals direkt auf `main` arbeiten.
- Jeder Pull Request muss `Closes #<issue-number>` enthalten.
- Squash-Merge ist die bevorzugte Merge-Strategie.
- Der Branch wird erst nach erfolgreichem Merge und anschließend grünem `main`-Workflow gelöscht.

## Erforderliche lokale Prüfungen vor jedem Push

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Alle fünf Prüfungen müssen lokal erfolgreich sein, bevor ein Pull Request erstellt oder aktualisiert wird. Derselbe Prüfablauf läuft automatisch in GitHub Actions (`.github/workflows/ci.yml`) für jeden Pull Request gegen `main` und jeden Push auf `main`.

## Empfohlene Branch-Protection-Regeln für `main`

Diese Einstellungen sind unter _Settings → Branches → Branch protection rules_ für `main` manuell zu aktivieren:

- **Require a pull request before merging** aktivieren – keine direkten Pushes auf `main`.
- **Require status checks to pass before merging** aktivieren und den Check-Namen `Format, Lint, Typecheck, Test, Build` (Job `quality` aus `CI`) als erforderlich markieren.
- **Require branches to be up to date before merging** aktivieren.
- **Do not allow bypassing the above settings** aktivieren, damit die Regeln auch für Administratoren gelten.
- **Allow force pushes**: deaktiviert lassen.
- **Allow deletions**: deaktiviert lassen.

## Pull-Request-Vorlage

Jeder Pull Request nutzt automatisch die Vorlage unter `.github/pull_request_template.md` mit verknüpftem Issue, Änderungsbeschreibung, Testnachweisen und einer Checkliste für Lint, Typecheck, Tests und Build.
