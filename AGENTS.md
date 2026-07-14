# AGENTS.md

## Arbeitsweise

- Jede Idee, jedes Feature, jeder Bugfix und jedes Refactoring beginnt mit einem GitHub Issue.
- Vor der Umsetzung bestehende Issues, Pull Requests, Architektur und Tests prüfen.
- Pro Session möglichst genau ein Issue bearbeiten.
- Für jedes Issue einen eigenen Branch verwenden:

  - `feat/<issue>-<slug>`
  - `fix/<issue>-<slug>`
  - `chore/<issue>-<slug>`
  - `test/<issue>-<slug>`

- Niemals direkt auf `main` arbeiten.
- Änderungen klein, nachvollziehbar und auf den Issue-Umfang begrenzen.
- Passende Tests immer zusammen mit der Umsetzung ergänzen.
- Vor dem Pull Request mindestens Lint, Typecheck, Tests und Build ausführen.
- Pull Requests müssen `Closes #<issue>` enthalten.
- Neue Nebenaufgaben nicht ungeplant mitumsetzen, sondern als neue Issues anlegen.
- Merge erst bei grüner CI.
- Branch erst nach erfolgreichem Merge und grünem `main`-Workflow löschen.
- Wichtige Entscheidungen dauerhaft im Issue, Pull Request oder Repository dokumentieren.

## GitHub-Zugriff

- GitHub-Aufgaben werden durch den Agenten über die GitHub CLI `gh` verwaltet.
- Vor Beginn `gh auth status` und das aktuelle Repository prüfen.
- Bestehende Issues mit `gh issue list` und `gh issue view` prüfen.
- Ideen, Wünsche und Bugfixes zuerst als eigenes Issue anlegen.
- Der Agent erstellt anschließend Issue-Branch, Commits und Pull Request.
- Keine Umsetzung beginnen, wenn kein passendes Issue existiert.
- GitHub-Zugangsdaten oder Tokens niemals ausgeben.
