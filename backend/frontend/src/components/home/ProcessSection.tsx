const STEPS = [
  {
    num: "01",
    title: "Describe a need",
    desc: "Capture what you want to make or the capability you can offer.",
  },
  {
    num: "02",
    title: "Discover capabilities",
    desc: "Explore manufacturers, vendors, and supporting partners.",
  },
  {
    num: "03",
    title: "Find relevant matches",
    desc: "See explainable recommendations based on fit factors.",
  },
  {
    num: "04",
    title: "Engage",
    desc: "Start controlled conversations with the right participants.",
  },
  {
    num: "05",
    title: "Collaborate",
    desc: "Share information deliberately and move work forward.",
  },
] as const;

export function ProcessSection() {
  return (
    <section className="process" id="process">
      <div className="wrap">
        <div className="section-head">
          <h2>From idea to opportunity</h2>
          <p className="desc">
            X!Y helps participants discover the right capabilities, connect with
            relevant participants, and move conversations forward.
          </p>
        </div>

        <div className="process-row">
          {STEPS.flatMap((step, index) => {
            const card = (
              <div key={step.num} className="process-card">
                <div className="process-num">{step.num}</div>
                <div className="process-title">{step.title}</div>
                <div className="process-desc">{step.desc}</div>
              </div>
            );

            if (index === STEPS.length - 1) {
              return [card];
            }

            return [
              card,
              <div key={`arrow-${step.num}`} className="process-arrow" aria-hidden="true">
                →
              </div>,
            ];
          })}
        </div>
      </div>
    </section>
  );
}
