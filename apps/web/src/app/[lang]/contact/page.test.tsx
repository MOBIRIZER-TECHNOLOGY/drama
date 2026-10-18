import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ContactForm", () => ({ ContactForm: () => <div>contact-form</div> }));

import Page, { metadata } from "./page";

describe("contact page", () => {
  it("renders the form and titles the page", () => {
    render(<Page />);
    expect(screen.getByText("contact-form")).toBeInTheDocument();
    expect(metadata.title).toBe("Contact");
  });
});
