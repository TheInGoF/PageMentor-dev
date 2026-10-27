import { t } from "../lib/i18n";

interface Props {
  size?: number;
  withLabel?: boolean;
  className?: string;
}

// PageMentor-Zeichen: drei gestapelte Bücher in den Akzentfarben
export function Logo({ size = 22, withLabel = true, className }: Props) {
  return (
    <div className={"flex items-center gap-2 " + (className ?? "")}>
      <span className="inline-flex flex-shrink-0">
        <BookStackIcon size={size} />
      </span>
      {withLabel && <span className="hidden sm:inline font-semibold tracking-tight">{t("app.name")}</span>}
    </div>
  );
}

// Farben aus dem Theme, damit das Zeichen der Palette folgt
const SHADE = ["rgb(var(--accent))", "rgb(var(--accent) / 0.7)", "rgb(var(--accent) / 0.45)"];

function BookStackIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="15.5" width="19" height="5" rx="1.2" fill={SHADE[0]} />
      <rect x="3.5" y="9.5" width="17" height="5" rx="1.2" fill={SHADE[1]} />
      <rect x="4.5" y="3.5" width="15" height="5" rx="1.2" fill={SHADE[2]} />
      {[16.6, 10.6, 4.6].map((y, i) => (
        <rect key={y} x={4.5 + i} y={y} width="0.8" height="2.8" rx="0.3" fill="rgb(255 255 255 / 0.55)" />
      ))}
    </svg>
  );
}
