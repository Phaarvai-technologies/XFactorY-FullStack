import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/Button";

export function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-grid">
        <div>
          <div className="eyebrow-row">
            <span className="rule" /> Manufacturing ecosystem
          </div>
          <h1 className="headline">Why own it, when you can make it.</h1>
          <p className="sub">
            X!Y connects designers, manufacturers, suppliers and every partner in
            between — so production capacity finds demand, and good ideas find a
            factory floor.
          </p>
          <div className="cta-row">
            {/* Only for signed-out visitors: any signed-in user is already registered,
                whether or not they have a Manufacturer account. */}
            <Show when="signed-out">
              <Button href="/sign-up" variant="primary">
                Sign in / Create account
              </Button>
            </Show>
            <a className="btn btn-ghost" href="#how-it-works">
              Browse how X!Y works
            </a>
          </div>
        </div>
        <div />
      </div>
    </section>
  );
}
