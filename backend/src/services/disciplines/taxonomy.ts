// Wissenschaften für Module: feste Liste, nach Familien gruppiert. Jede Familie hat einen Farbton, die Fächer darin
// leicht abgewandelte Töne, damit Verwandtes auf einen Blick zusammengehört. Qwen wählt nur aus dieser Liste
export interface Family {
  id: string;
  name: string;
  // Farbton (HSL) und Sättigung der Familie
  hue: number;
  sat: number;
}
export interface Discipline {
  id: string;
  name: string;
  family: string;
  // Stichworte für Qwen, woran man das Fach erkennt
  hint: string;
}

export const FAMILIES: Family[] = [
  { id: "math", name: "Mathematik und Naturwissenschaften", hue: 270, sat: 70 },
  { id: "et", name: "Elektrotechnik", hue: 217, sat: 85 },
  { id: "energy", name: "Energietechnik", hue: 42, sat: 92 },
  { id: "ikt", name: "Informations- und Kommunikationstechnik", hue: 190, sat: 85 },
  { id: "cs", name: "Informatik", hue: 165, sat: 70 },
  { id: "auto", name: "Automatisierung und Messtechnik", hue: 135, sat: 60 },
  { id: "traffic", name: "Verkehr und Fahrzeuge", hue: 80, sat: 65 },
  { id: "biz", name: "Wirtschaft und Management", hue: 22, sat: 88 },
  { id: "soc", name: "Gesellschaft und Kommunikation", hue: 350, sat: 75 },
  { id: "lang", name: "Sprachen", hue: 318, sat: 70 },
  { id: "hum", name: "Literatur und Geisteswissenschaften", hue: 32, sat: 45 },
  { id: "practice", name: "Praxis und Abschluss", hue: 215, sat: 20 },
  { id: "other", name: "Sonstiges", hue: 0, sat: 0 },
];

export const DISCIPLINES: Discipline[] = [
  { id: "math.math", name: "Mathematik", family: "math", hint: "Analysis, Lineare Algebra, Mathematik I–III" },
  { id: "math.stat", name: "Statistik und Wahrscheinlichkeit", family: "math", hint: "Stochastik, Statistik" },
  { id: "math.phys", name: "Physik", family: "math", hint: "Mechanik, Optik, Naturwissenschaftliche (Ingenieur-)Grundlagen" },
  { id: "math.chem", name: "Chemie", family: "math", hint: "Chemie, Werkstoffe" },
  { id: "math.bio", name: "Biologie und Umweltwissenschaften", family: "math", hint: "Biologie, Ökologie" },

  { id: "et.basics", name: "Grundlagen der Elektrotechnik", family: "et", hint: "Einführung in die Elektrotechnik, Gleich- und Wechselstrom" },
  { id: "et.electronics", name: "Elektronik und Schaltungstechnik", family: "et", hint: "Einführung in die Elektronik, Elektronische Schaltungstechnik, Bauelemente" },
  { id: "et.power", name: "Leistungselektronik und Antriebe", family: "et", hint: "Leistungselektronik, Elektrische Maschinen, Elektrische und hybride Antriebe, Hochvoltsysteme" },

  { id: "energy.systems", name: "Energietechnik und Netze", family: "energy", hint: "Grundlagen der Energietechnik, Energieinformationsnetze, Hochspannung" },
  { id: "energy.storage", name: "Energiespeicher", family: "energy", hint: "Elektrische Energiespeicher, Energiespeichertechnik, Batterien" },
  { id: "energy.renewable", name: "Erneuerbare Energien", family: "energy", hint: "Regenerative Energietechnik, Biomasse, Wasserstofftechnologien" },
  { id: "energy.efficiency", name: "Energieeffizienz und Umwelt", family: "energy", hint: "Energieeffizienz und Nachhaltigkeit, Energie und Umwelt" },

  { id: "ikt.telecom", name: "Nachrichten- und Telekommunikationstechnik", family: "ikt", hint: "Grundlagen der Telekommunikation, Informationsübertragung" },
  { id: "ikt.signal", name: "Signalverarbeitung", family: "ikt", hint: "Digitale Signal- und Informationsverarbeitung" },
  { id: "ikt.radio", name: "Funktechnik", family: "ikt", hint: "Funktechnik und -systeme, Antennen, Mobilfunk" },
  { id: "ikt.networks", name: "Netze und Dienste", family: "ikt", hint: "Netzarchitektur, Netzmanagement und -design, Protokolle" },
  { id: "ikt.optics", name: "Optische Nachrichtentechnik", family: "ikt", hint: "Glasfasertechnik und optische Netze" },

  { id: "cs.basics", name: "Informatik-Grundlagen", family: "cs", hint: "Grundlagen der Informatik, Algorithmen, Datenstrukturen" },
  { id: "cs.programming", name: "Programmierung und Software Engineering", family: "cs", hint: "Programmieren, Software Engineering, Laboreingangsprüfung Programmieren" },
  { id: "cs.systems", name: "Rechner- und Betriebssysteme", family: "cs", hint: "Betriebssysteme, Digital- und Mikrorechentechnik, eingebettete Systeme" },
  { id: "cs.vision", name: "Bildverarbeitung und KI", family: "cs", hint: "Vision Systems, maschinelles Lernen" },

  { id: "auto.control", name: "Regelungstechnik und Systemtheorie", family: "auto", hint: "Regelungstechnik, Systemtheorie, Modellbildung und Simulation" },
  { id: "auto.plc", name: "Steuerungs- und Automatisierungstechnik", family: "auto", hint: "Steuerungstechnik, Fabrik-, Prozess-, Gebäudeautomatisierung" },
  { id: "auto.robotics", name: "Robotik", family: "auto", hint: "Industrierobotertechnik" },
  { id: "auto.measure", name: "Mess- und Sensortechnik", family: "auto", hint: "Messtechnik, Sensorik und Aktorik" },

  { id: "traffic.rail", name: "Bahn- und Leit- und Sicherungstechnik", family: "traffic", hint: "LST, Bahnbetrieb, Prozessgestaltung im Bahnbetrieb, Planung von LST-Anlagen" },
  { id: "traffic.vehicle", name: "Fahrzeugtechnik und Elektromobilität", family: "traffic", hint: "Fahrzeugelektronik, Sensorik in Kraftfahrzeugen, Elektromobilität" },

  { id: "biz.bwl", name: "Betriebswirtschaft", family: "biz", hint: "BWL, Investition und Finanzierung, Energiewirtschaft" },
  { id: "biz.quality", name: "Qualitäts- und Sicherheitsmanagement", family: "biz", hint: "Qualitätsmanagement, Sicherheitsmanagement, Instandhaltungsmanagement" },
  { id: "biz.project", name: "Projektmanagement", family: "biz", hint: "Projekt-/Bauleitung, Projektplanung" },
  { id: "biz.law", name: "Recht", family: "biz", hint: "Recht, Normen, Verträge" },

  { id: "soc.communication", name: "Kommunikation und Führung", family: "soc", hint: "Führung und Kommunikation, Präsentation" },
  { id: "soc.intercultural", name: "Interkulturelle Kompetenz", family: "soc", hint: "Interkulturelle Kompetenz" },
  { id: "soc.ethics", name: "Technik und Gesellschaft", family: "soc", hint: "Technikfolgenabschätzung, Ethik, Nachhaltigkeit als Gesellschaftsfrage" },

  { id: "lang.english", name: "Englisch", family: "lang", hint: "Englisch, Technical English" },
  { id: "lang.spanish", name: "Spanisch", family: "lang", hint: "Spanisch" },
  { id: "lang.other", name: "Weitere Sprachen", family: "lang", hint: "Französisch, Italienisch, andere Fremdsprachen" },

  { id: "hum.fiction", name: "Belletristik", family: "hum", hint: "Romane, Erzählungen, Krimis, Lyrik" },
  { id: "hum.history", name: "Geschichte und Philosophie", family: "hum", hint: "Geschichte, Philosophie, Politik" },
  { id: "hum.nonfiction", name: "Sachbuch und Ratgeber", family: "hum", hint: "Sachbücher, Biografien, Ratgeber" },

  { id: "practice.project", name: "Projekte und Praxisphasen", family: "practice", hint: "Einführungsprojekt, Ingenieurwissenschaftliches Projekt, Berufspraktische Phase" },
  { id: "practice.thesis", name: "Abschlussarbeit", family: "practice", hint: "Bachelorarbeit und Kolloquium, Masterarbeit" },

  { id: "other", name: "Sonstiges", family: "other", hint: "passt in keine andere Wissenschaft" },
];

const byId = new Map(DISCIPLINES.map((d) => [d.id, d]));
export const isDiscipline = (id: unknown): id is string => typeof id === "string" && byId.has(id);
export const disciplineName = (id: string | null | undefined) => (id ? byId.get(id)?.name ?? null : null);

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Farbe eines Fachs: Ton der Familie, je Fach leicht verschoben (Ton ±, Helligkeit im Wechsel)
export function disciplineColor(id: string | null | undefined): string | null {
  const d = id ? byId.get(id) : undefined;
  if (!d) return null;
  const fam = FAMILIES.find((f) => f.id === d.family)!;
  const members = DISCIPLINES.filter((x) => x.family === d.family);
  const i = members.indexOf(d);
  const spread = members.length > 1 ? (i / (members.length - 1) - 0.5) * 24 : 0;
  // Hell genug für Schrift auf dunklem Grund
  const light = 56 + (i % 2 ? 7 : 0);
  return hslToHex((fam.hue + spread + 360) % 360, fam.sat, light);
}

export function taxonomy() {
  return {
    families: FAMILIES.map((f) => ({ id: f.id, name: f.name })),
    disciplines: DISCIPLINES.map((d) => ({ id: d.id, name: d.name, family: d.family, color: disciplineColor(d.id)! })),
  };
}
