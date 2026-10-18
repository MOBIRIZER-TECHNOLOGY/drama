import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/wallet/WalletView", () => ({ WalletView: () => <div>wallet-view</div> }));

import Page, { dynamic, metadata } from "./page";

describe("wallet page", () => {
  it("is dynamic, noindex and renders the wallet", () => {
    render(<Page />);
    expect(screen.getByText("wallet-view")).toBeInTheDocument();
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false });
  });
});
