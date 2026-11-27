/** Meeting 27 Nov 2026: the Manufacturers list shows whether the invite is pending or the
 * manufacturer has set up their account. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InviteBadge } from "@/components/admin/ui";

describe("Invite status in the Manufacturers list", () => {
  it.each([
    ["invited", "Invite sent · not opened", "badge-pending"],
    ["opened", "Invite opened · not set up", "badge-pending"],
    ["accepted", "Account set up", "badge-verified"],
    ["expired", "Invite expired", "badge-neutral"],
  ])("%s", (status, label, tone) => {
    render(<InviteBadge invite={{ status, at: null }} />);
    expect(screen.getByText(label)).toHaveClass(tone);
  });

  it("never invited: nothing shown", () => {
    const { container } = render(<InviteBadge invite={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
