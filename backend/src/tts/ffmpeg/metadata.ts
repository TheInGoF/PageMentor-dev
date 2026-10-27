// FFMETADATA für Kapitel und Tags

// FFMETADATA: \ = ; # und Zeilenumbrüche escapen, sonst kaputte Kapitel
function ffMetaEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/=/g, "\\=")
    .replace(/;/g, "\\;")
    .replace(/#/g, "\\#")
    .replace(/\r?\n/g, " ");
}

export function buildFfMetadata(params: {
  title: string;
  artist: string;
  shortCode?: string;
  series?: string;
  seriesSequence?: string;
  chapters: Array<{ title: string; durationMs: number }>;
}): string {
  // Zuordnung PageMentor → M4B-Atom → Audiobookshelf
  //   Titel          ©nam            book.title
  //   Modul          ©mvn, tvsh      series.name
  //   Kürzel         ©st3 fehlt      nur per PATCH
  //   Position       trkn, ©mvi      series.sequence
  // Kein album=Serie: ABS las das als Buchtitel
  const lines: string[] = [";FFMETADATA1"];
  lines.push(`title=${ffMetaEscape(params.title)}`);
  lines.push(`artist=${ffMetaEscape(params.artist)}`);
  // ABS nimmt artist als Autor, album_artist zur Sicherheit
  lines.push(`album_artist=${ffMetaEscape(params.artist)}`);
  // album = Buchtitel, für Player ohne Hörbuch-Modus
  lines.push(`album=${ffMetaEscape(params.title)}`);
  const seriesName = params.series?.trim();
  if (seriesName && seriesName.length > 0) {
    // movement_name + show tragen die Serie
    lines.push(`movement_name=${ffMetaEscape(seriesName)}`);
    lines.push(`show=${ffMetaEscape(seriesName)}`);
  }
  // Ohne Modul: movement/show leer
  lines.push(`genre=Audiobook`);
  if (params.shortCode && params.shortCode.trim().length > 0) {
    // Nur grouping: echtes iTunes-Atom, übersteht den Muxer
    lines.push(`grouping=${ffMetaEscape(params.shortCode.trim())}`);
  }
  if (params.seriesSequence && params.seriesSequence.trim().length > 0) {
    // Position als track + movement_index, nur ganzzahlig
    // "1.5" setzt nur der ABS-PATCH
    lines.push(`track=${params.seriesSequence.trim()}`);
    lines.push(`movement_index=${params.seriesSequence.trim()}`);
  }
  let start = 0;
  for (const ch of params.chapters) {
    const end = start + ch.durationMs;
    lines.push("");
    lines.push("[CHAPTER]");
    lines.push("TIMEBASE=1/1000");
    lines.push(`START=${start}`);
    lines.push(`END=${end}`);
    lines.push(`title=${ffMetaEscape(ch.title)}`);
    start = end;
  }
  return lines.join("\n") + "\n";
}
