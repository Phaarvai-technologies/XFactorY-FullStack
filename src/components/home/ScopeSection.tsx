const SCOPE_CARDS = [
  {
    title: "Discovery",
    body: "Find relevant participants and capabilities.",
  },
  {
    title: "Engagement",
    body: "Start and manage conversations.",
  },
  {
    title: "Not payments",
    body: "X!Y does not execute marketplace payments.",
  },
  {
    title: "Not employment/intermediation",
    body: "X!Y does not execute employment or regulated transactions.",
  },
] as const;

export function ScopeSection() {
  return (
    <section className="scope" id="scope">
      <div className="wrap">
        <div className="section-head">
          <h2>What X!Y is — and isn&apos;t</h2>
        </div>
        <p className="scope-lead">
          X!Y is a discovery and engagement platform for the manufacturing
          ecosystem.
        </p>
        <p className="scope-lead scope-lead-strong">
          X!Y is not a payment intermediary, legal intermediary, investment
          intermediary, or employment intermediary.
        </p>

        <div className="scope-grid">
          {SCOPE_CARDS.map((card) => (
            <div key={card.title} className="scope-card">
              <h4>{card.title}</h4>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
