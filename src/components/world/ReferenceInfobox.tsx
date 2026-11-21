import Link from "next/link";
import type { ReferenceInfoboxModel } from "@/world/referenceInfobox";
import { INFOBOX } from "@/ui/labels";

export function ReferenceInfobox({ model }: { model: ReferenceInfoboxModel }) {
  return (
    <aside className="panel reference-infobox" aria-labelledby="reference-infobox-heading">
      <h2 id="reference-infobox-heading">{INFOBOX.heading}</h2>
      {model.rows.length ? (
        <dl className="reference-infobox-grid">
          {model.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                {row.href ? (
                  <Link href={row.href}>{row.value}</Link>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {model.relationships.length ? (
        <section>
          <h3 className="reference-infobox-sub">{INFOBOX.relationships}</h3>
          <ul className="context-list">
            {model.relationships.map((row) => (
              <li key={`${row.href}-${row.label}`}>
                <Link href={row.href}>{row.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {model.maps.length ? (
        <section>
          <h3 className="reference-infobox-sub">{INFOBOX.onMaps}</h3>
          <ul className="context-list">
            {model.maps.map((row) => (
              <li key={row.href}>
                <Link href={row.href}>{row.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {model.facts.length ? (
        <section>
          <h3 className="reference-infobox-sub">{INFOBOX.establishedFacts}</h3>
          <ul>
            {model.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {model.openQuestions ? (
        <section>
          <h3 className="reference-infobox-sub">{INFOBOX.openQuestions}</h3>
          <p className="reference-infobox-open">{model.openQuestions}</p>
        </section>
      ) : null}
    </aside>
  );
}