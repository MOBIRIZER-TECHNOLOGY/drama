import "@/test/dramas-dom-matchers";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import { renderPage } from "@/test/render";
import NewSeriesPage from "./page";

describe("NewSeriesPage", () => {
  it("renders the header, a back link and the create form", async () => {
    mockApi.get("/v1/admin/languages", [{ code: "hi", name: "Hindi", is_active: true }]);
    mockApi.get("/v1/admin/categories", []);
    renderPage(<NewSeriesPage />);
    expect(screen.getByRole("heading", { name: "New series" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to dramas/ })).toHaveAttribute("href", "/dramas");
    expect(await screen.findByRole("button", { name: "Create series" })).toBeInTheDocument();
  });

  it("navigates to the new series after it is saved", async () => {
    mockApi.get("/v1/admin/languages", [{ code: "hi", name: "Hindi", is_active: true }]);
    mockApi.get("/v1/admin/categories", []);
    mockApi.post("/v1/admin/series", (c) => ({ ...c.body, id: "created-1" }));
    renderPage(<NewSeriesPage />);
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText(/^Title/), "Brand new");
    await userEvent.click(screen.getByRole("button", { name: "Create series" }));
    await screen.findByText("Series created");
    expect(nav.router.replace).toEqual(["/dramas/created-1"]);
  });
});
