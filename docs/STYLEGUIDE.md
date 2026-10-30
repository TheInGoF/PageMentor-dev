# UI-Styleguide

Kurzfassung des HeatPilot-UI-Styleguides, angewendet auf PageMentor. Bausteine dafür liegen in
`frontend/src/components/settings/parts.tsx` (Card, SettingRow, Expert, Notice, SubTitle).

## Darstellung

- Drei Schriftgrößen: Titel `text-base`, Text `text-sm`, Klein `text-xs`.
- Abstände in 8er-Schritten (`gap-2`, `gap-4`, `p-4`, …).
- Einstellungszeile: Bezeichnung links, Bedienelement rechts, Erklärung klein darunter.
- Jede Information an genau einer Stelle; keine doppelten Status- oder Modellanzeigen.
- Höchstens zwei Ebenen: Reiter und darunter Chips, keine dritte Navigationsebene.
- Experten- und Diagnoseoptionen eingeklappt am Ende der Seite.
- Hinweisboxen immer gleich aufgebaut (Info, Warnung, Fehler) über `Notice`.
- Nach jedem Umbau Bildschirmfotos prüfen.

## Verhalten (UX)

- **Popups schließen nur über „Schließen“ bzw. ×.** Kein Schließen per Klick auf den Hintergrund und
  keine Escape-Taste: Wer beim Markieren oder Tippen danebenklickt, verliert sonst seine Eingaben.
- Aktionen für einen Eintrag stehen in seinem Drei-Punkte-Menü (⋯), nicht als einzelne Symbole in der
  Zeile. Mehrere ausgewählte Einträge teilen sich ein gemeinsames Menü über der Liste.
- Kästchen, Schalter und kleine Knöpfe haben eine große Klickfläche: In Listen ist die ganze
  Kästchen-Spalte der Zeile anklickbar, das Kästchen selbst mindestens 20 px groß.
- Reihenfolgen, die der Nutzer festlegt (z. B. ein Lauf über mehrere Bücher), lassen sich vor dem Start
  und, soweit noch nicht begonnen, auch währenddessen ändern.
- Lange Läufe zeigen ihren Fortschritt in der Kopfzeile; ein Klick klappt die Einzelheiten aus.
- Nach einem Upload oder Export öffnet die App keine fremden Seiten von selbst.
