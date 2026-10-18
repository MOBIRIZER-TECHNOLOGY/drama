import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/wallet/LedgerView", () => ({ LedgerView: () => <div>ledger-view</div> }));

import Page, { dynamic, metadata } from "./page";

describe("wallet history page", () => {
  it("is dynamic, noindex and renders the ledger", () => {
    render(<Page />);
    expect(screen.getByText("ledger-view")).toBeInTheDocument();
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false });
  });
});
