import { Button } from "@/components/ui/Button";

export function HowItWorksBand() {
  return (
    <section className="band" id="how-it-works">
      <div className="wrap">
        <div>
          <h3>Not sure where you fit yet?</h3>
          <p>
            Walk through a two-minute overview of how X!Y matches personas, before
            you create an account.
          </p>
        </div>
        <Button href="/#how-it-works" variant="ghost">
          Browse how X!Y works
        </Button>
      </div>
    </section>
  );
}
