# Archiv

Nicht mehr in Gebrauch, zum Nachschlagen aufbewahrt. Nichts hiervon wird gebaut,
getestet oder ausgeliefert.

| Pfad | Was | Warum archiviert |
|---|---|---|
| `docs/legacy/` | Frühere NAS-Installation mit Docker Compose, Plan zur vLLM-Omni-Migration | Seit dem All-in-One-Umbau läuft alles als Windows-App mit eigener WSL-Engine (`engine/compose.yaml`) |
| `docs/PLAN-safety-content-validation.md` | Konzept gegen Missbrauch geklonter Stimmen | Nie umgesetzt; bleibt als Grundlage, falls das Thema wieder aufkommt |
| `docs/screenshots-v1.18/` | Screenshots bis v1.19, teils englisch und mit alter Navigation | Ersetzt durch `docs/screenshots/` |
| `docs/diagrams-v1.18/` | Pipeline-Diagramm (PlantUML) mit Qwen-Flash, Edge-TTS und Podcast-Feed | Veraltet; die README zeigt die Pipeline jetzt als Mermaid-Diagramm |
| `pm-audio-analyzer/` | Sidecar mit Qwen3-Omni: Transkript und Sprech-Anweisung aus einer Stimmprobe | Von App und Engine nicht genutzt |
| `workflows/publish-audio-analyzer.yml.txt` | Build-Workflow des Audio-Analyzers | Abgeschaltet (umbenannt), damit GitHub ihn nicht mehr ausführt |

Wieder aufnehmen: Ordner per `git mv` zurückschieben; bei Workflows zusätzlich die
Endung `.txt` entfernen und nach `.github/workflows/` legen.
