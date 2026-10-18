import "@/test/components-dom-matchers";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { escape, installDialogPolyfill } from "@/test/components-dialog";
import {
  Badge,
  BulkBar,
  Button,
  Card,
  ChipInput,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  LinkButton,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SelectCell,
  Spinner,
  StatTile,
  Table,
  TabPanel,
  Tabs,
  Td,
  Textarea,
  Th,
  Toggle,
  periodDelta,
  statusTone,
  tabId,
  tabPanelId,
  useFieldId,
  useSelection,
  type SortState,
} from "./ui";

beforeAll(installDialogPolyfill);

describe("Button / LinkButton", () => {
  it("defaults to type=button, variant secondary", () => {
    render(<Button>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b).toHaveAttribute("type", "button");
    expect(b.className).toContain("bg-surface");
  });
  it("loading disables, sets aria-busy and shows a spinner; click is inert", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} variant="danger" size="sm">
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: /Save/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(within(b).getByRole("progressbar")).toBeTruthy();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b.className).toContain("bg-danger");
    expect(b.className).toContain("h-8");
  });
  it("disabled prop and submit type pass through", () => {
    render(
      <Button disabled type="submit" variant="primary" className="extra">
        X
      </Button>,
    );
    const b = screen.getByRole("button");
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("type", "submit");
    expect(b).toHaveClass("extra");
    expect(b).not.toHaveAttribute("aria-busy");
  });
  it("LinkButton renders an anchor with variant classes", () => {
    render(
      <LinkButton href="/x" variant="ghost" size="sm" className="mine">
        Open
      </LinkButton>,
    );
    const a = screen.getByRole("link", { name: "Open" });
    expect(a).toHaveAttribute("href", "/x");
    expect(a).toHaveClass("mine");
    expect(a.className).toContain("h-8");
  });
  it("LinkButton defaults", () => {
    render(<LinkButton href="/y">Y</LinkButton>);
    expect(screen.getByRole("link").className).toContain("h-10");
  });
});

describe("Field and controls", () => {
  it("wires label, id, required marker and describedby hint to the control", () => {
    render(
      <Field label="Name" hint="Be kind" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).not.toHaveAttribute("aria-invalid");
    const hint = screen.getByText("Be kind");
    expect(input).toHaveAttribute("aria-describedby", hint.id);
  });
  it("an error replaces the hint, is announced, and marks the control invalid", () => {
    render(
      <Field label="Name" hint="Be kind" error="Too short">
        <Textarea />
      </Field>,
    );
    const ta = screen.getByLabelText("Name");
    expect(ta).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Too short");
    expect(screen.queryByText("Be kind")).toBeNull();
    expect(ta).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
  });
  it("no message: no describedby, no required marker", () => {
    render(
      <Field label="Kind">
        <Select>
          <option>a</option>
        </Select>
      </Field>,
    );
    const sel = screen.getByLabelText("Kind");
    expect(sel).not.toHaveAttribute("aria-describedby");
    expect(sel).not.toHaveAttribute("aria-required");
    expect(screen.queryByText("*")).toBeNull();
  });
  it("controls outside a Field carry no aria wiring and forward refs/classes", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} className="zz" placeholder="p" />);
    expect(ref.current).toBe(screen.getByPlaceholderText("p"));
    expect(ref.current).toHaveClass("zz");
    expect(ref.current).not.toHaveAttribute("id");
    render(<IdProbe />);
    expect(screen.getByTestId("bare-id").textContent).toBe("none");
  });
  it("useFieldId exposes the control id", () => {
    function Probe() {
      return <span data-testid="id">{useFieldId()}</span>;
    }
    render(
      <Field label="L">
        <Probe />
      </Field>,
    );
    expect(screen.getByTestId("id").textContent).toBe(screen.getByText("L").getAttribute("for"));
  });
});
function IdProbe() {
  return <span data-testid="bare-id">{useFieldId() ?? "none"}</span>;
}

describe("Toggle", () => {
  it("reflects checked, flips on click, and clicking its label toggles", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Live" description="goes live" />);
    const sw = screen.getByRole("switch", { name: /Live/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByText("Live"));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByText("goes live")).toBeTruthy();
  });
  it("checked flips to false; disabled blocks; hideLabel keeps aria-label only", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked onChange={onChange} label="Live" />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
    rerender(<Toggle checked onChange={onChange} label="Live" hideLabel disabled />);
    const sw = screen.getByRole("switch", { name: "Live" });
    expect(sw).toBeDisabled();
    expect(screen.queryByText("Live")).toBeNull();
  });
});

describe("layout and display", () => {
  it("PageHeader with and without description/actions", () => {
    const { rerender } = render(<PageHeader title="T" description="D" actions={<button>A</button>} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("T");
    expect(screen.getByText("D")).toBeTruthy();
    expect(screen.getByRole("button", { name: "A" })).toBeTruthy();
    rerender(<PageHeader title="T2" />);
    expect(screen.queryByText("D")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("Card header only when title or actions", () => {
    const { rerender, container } = render(<Card>body</Card>);
    expect(container.querySelector("header")).toBeNull();
    rerender(<Card title="Hi" actions={<i>act</i>} className="k">body</Card>);
    expect(screen.getByRole("heading", { name: "Hi" })).toBeTruthy();
    expect(screen.getByText("act")).toBeTruthy();
    rerender(<Card actions={<i>only</i>}>b</Card>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("only")).toBeTruthy();
  });
  it("Badge tones", () => {
    const { rerender } = render(<Badge>x</Badge>);
    expect(screen.getByText("x").className).toContain("bg-surface-2");
    for (const [tone, cls] of [
      ["success", "text-success"],
      ["warning", "text-warning"],
      ["danger", "text-danger"],
      ["accent", "text-accent"],
      ["gold", "bg-gold/15"],
    ] as const) {
      rerender(<Badge tone={tone}>x</Badge>);
      expect(screen.getByText("x").className).toContain(cls);
    }
  });
  it("statusTone maps every status family", () => {
    for (const s of ["published", "paid", "ready", "active", "resolved", "complete"]) expect(statusTone(s)).toBe("success");
    for (const s of ["review", "pending", "queued", "running", "transcoding", "uploaded", "open"]) expect(statusTone(s)).toBe("warning");
    for (const s of ["failed", "banned", "deleted", "refunded"]) expect(statusTone(s)).toBe("danger");
    for (const s of ["archived", "dismissed", "whatever"]) expect(statusTone(s)).toBe("neutral");
  });
  it("Spinner / LoadingState", () => {
    render(<LoadingState />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeTruthy();
    render(<LoadingState label="Wait" />);
    expect(screen.getByText(/Wait/)).toBeTruthy();
    const { container } = render(<Spinner size={30} />);
    expect((container.firstChild as HTMLElement).style.width).toBe("30px");
  });
  it("EmptyState optional parts", () => {
    const { rerender } = render(<EmptyState title="None" />);
    expect(screen.getByText("None")).toBeTruthy();
    rerender(<EmptyState title="None" description="desc" action={<button>Add</button>} />);
    expect(screen.getByText("desc")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
  it("ErrorState and InlineError retry", async () => {
    const retry = vi.fn();
    const { rerender } = render(<ErrorState message="boom" />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ErrorState message="boom" onRetry={retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    const retry2 = vi.fn();
    rerender(<InlineError message="stale" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<InlineError message="stale" onRetry={retry2} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry2).toHaveBeenCalledTimes(1);
  });
  it("StatTile delta colouring and formatting", () => {
    const { rerender } = render(<StatTile label="Rev" value="10" sub="usd" delta={0.123} deltaLabel="vs last" />);
    const d = () => screen.getByTitle("vs last");
    expect(d()).toHaveTextContent("+12%");
    expect(d()).toHaveClass("text-success");
    expect(screen.getByText("usd")).toBeTruthy();
    rerender(<StatTile label="Rev" value="10" delta={-0.5} deltaLabel="vs last" />);
    expect(d()).toHaveTextContent("-50%");
    expect(d()).toHaveClass("text-danger");
    rerender(<StatTile label="Refunds" value="10" delta={0.5} higherIsBetter={false} deltaLabel="vs last" />);
    expect(d()).toHaveClass("text-danger");
    rerender(<StatTile label="Refunds" value="10" delta={-0.5} higherIsBetter={false} deltaLabel="vs last" />);
    expect(d()).toHaveClass("text-success");
    rerender(<StatTile label="Flat" value="10" delta={0} deltaLabel="vs last" />);
    expect(d()).toHaveClass("text-muted");
    expect(d()).toHaveTextContent("0%");
    rerender(<StatTile label="Big" value="10" delta={12} deltaLabel="vs last" />);
    expect(d()).toHaveTextContent("+>999");
    rerender(<StatTile label="None" value="10" delta={null} />);
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it("periodDelta", () => {
    expect(periodDelta(150, 100)).toBe(0.5);
    expect(periodDelta(5, 0)).toBeNull();
    expect(periodDelta(5, undefined)).toBeNull();
  });
  it("SearchInput is controlled and reports changes", () => {
    const onChange = vi.fn();
    render(<SearchInput value="ab" onChange={onChange} />);
    const box = screen.getByLabelText("Search…");
    expect(box).toHaveValue("ab");
    fireEvent.change(box, { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");
    render(<SearchInput value="" onChange={onChange} placeholder="Find series" />);
    expect(screen.getByPlaceholderText("Find series")).toBeTruthy();
  });
});

describe("Table / Th / Td", () => {
  it("applies min-width and optional scroll height", () => {
    const { container, rerender } = render(
      <Table>
        <tbody>
          <tr>
            <Td title="tip" className="c">
              x
            </Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(container.querySelector("table")!.style.minWidth).toBe("640px");
    expect((container.firstChild as HTMLElement).style.maxHeight).toBe("");
    expect(screen.getByText("x")).toHaveAttribute("title", "tip");
    rerender(
      <Table minWidth={900} maxHeight={300}>
        <tbody />
      </Table>,
    );
    expect(container.querySelector("table")!.style.minWidth).toBe("900px");
    expect((container.firstChild as HTMLElement).style.maxHeight).toBe("300px");
  });

  function SortHost({ start = null as SortState | null }) {
    const [sort, setSort] = useState<SortState | null>(start);
    return (
      <table>
        <thead>
          <tr>
            <Th sortKey="name" sort={sort} onSort={setSort} sticky>
              Name
            </Th>
            <Th sortKey="age" sort={sort} onSort={setSort}>
              Age
            </Th>
            <Th>Plain</Th>
          </tr>
        </thead>
      </table>
    );
  }
  it("sortable headers toggle direction, report aria-sort and switch keys", async () => {
    const user = userEvent.setup();
    render(<SortHost />);
    const name = screen.getByRole("columnheader", { name: /Name/ });
    const age = screen.getByRole("columnheader", { name: /Age/ });
    expect(name).toHaveAttribute("aria-sort", "none");
    expect(name.className).toContain("sticky");
    expect(age.className).not.toContain("sticky");
    await user.click(within(name).getByRole("button"));
    expect(name).toHaveAttribute("aria-sort", "ascending");
    expect(name).toHaveTextContent("↑");
    await user.click(within(name).getByRole("button"));
    expect(name).toHaveAttribute("aria-sort", "descending");
    expect(name).toHaveTextContent("↓");
    await user.click(within(name).getByRole("button"));
    expect(name).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(age).getByRole("button"));
    expect(age).toHaveAttribute("aria-sort", "ascending");
    expect(name).toHaveAttribute("aria-sort", "none");
    expect(name).toHaveTextContent("↕");
  });
  it("a header with sortKey but no handler (or none) is a plain th", () => {
    render(
      <table>
        <thead>
          <tr>
            <Th sortKey="a">A</Th>
            <Th>B</Th>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "A" })).not.toHaveAttribute("aria-sort");
  });
});

describe("selection", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  function Host({ data = rows }: { data?: { id: string }[] }) {
    const sel = useSelection(data);
    return (
      <div>
        <table>
          <thead>
            <tr>
              <SelectCell header label="all" checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <SelectCell label={`row ${r.id}`} checked={sel.has(r.id)} onChange={(n) => sel.toggle(r.id, n)} />
              </tr>
            ))}
          </tbody>
        </table>
        <span data-testid="sel">{sel.selected.join(",")}</span>
        <BulkBar count={sel.count} onClear={sel.clear}>
          <button>Act</button>
        </BulkBar>
      </div>
    );
  }
  it("toggle, indeterminate header, select all, clear", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const all = screen.getByLabelText("all") as HTMLInputElement;
    expect(screen.queryByText(/selected/)).toBeNull();
    await user.click(screen.getByLabelText("row b"));
    expect(screen.getByTestId("sel").textContent).toBe("b");
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    await user.click(all);
    expect(screen.getByTestId("sel").textContent).toBe("a,b,c");
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    await user.click(screen.getByLabelText("row a"));
    expect(screen.getByTestId("sel").textContent).toBe("b,c");
    await user.click(all);
    await user.click(all);
    expect(screen.getByTestId("sel").textContent).toBe("");
    await user.click(screen.getByLabelText("row a"));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("sel").textContent).toBe("");
  });
  it("prunes selection against the rows on screen, and empty rows are never 'all selected'", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Host />);
    await user.click(screen.getByLabelText("row a"));
    await user.click(screen.getByLabelText("row c"));
    rerender(<Host data={[{ id: "c" }]} />);
    expect(screen.getByTestId("sel").textContent).toBe("c");
    rerender(<Host data={[]} />);
    expect((screen.getByLabelText("all") as HTMLInputElement).checked).toBe(false);
  });
  it("clicking a checkbox does not bubble to the row", async () => {
    const onRow = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={onRow}>
            <SelectCell label="r" checked={false} onChange={() => {}} />
          </tr>
        </tbody>
      </table>,
    );
    await userEvent.click(screen.getByLabelText("r"));
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe("Pagination", () => {
  const nav = () => screen.getByRole("navigation", { name: "Pagination" });
  it("middle page with total: numbers window, summary and jumps", async () => {
    const onChange = vi.fn();
    render(<Pagination offset={40} limit={20} count={20} hasNext total={200} onChange={onChange} />);
    expect(nav()).toHaveTextContent("41–60 of 200 · page 3 of 10");
    const pageNums = within(nav()).getAllByRole("button").map((b) => b.textContent);
    expect(pageNums).toEqual(["First", "Previous", "1", "2", "3", "4", "5", "Next", "Last"]);
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "First" }));
    expect(onChange).toHaveBeenLastCalledWith(0);
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenLastCalledWith(20);
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    expect(onChange).toHaveBeenLastCalledWith(80);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onChange).toHaveBeenLastCalledWith(60);
    await userEvent.click(screen.getByRole("button", { name: "Last" }));
    expect(onChange).toHaveBeenLastCalledWith(180);
  });
  it("window slides at the end, and first/prev/last disabled at the edges", () => {
    render(<Pagination offset={180} limit={20} count={20} hasNext={false} total={200} onChange={() => {}} />);
    expect(within(nav()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "First", "Previous", "6", "7", "8", "9", "10", "Next", "Last",
    ]);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "First" })).toBeEnabled();
  });
  it("first page disables First/Previous", () => {
    render(<Pagination offset={0} limit={20} count={5} hasNext={false} total={5} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "First" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(nav()).toHaveTextContent("1–5 of 5 · page 1 of 1");
  });
  it("without total there are no page numbers or Last; empty page says so", () => {
    render(<Pagination offset={20} limit={20} count={0} hasNext={false} onChange={() => {}} />);
    expect(nav()).toHaveTextContent("No rows on this page");
    expect(screen.queryByRole("button", { name: "Last" })).toBeNull();
    expect(within(nav()).getAllByRole("button").map((b) => b.textContent)).toEqual(["First", "Previous", "Next"]);
  });
  it("total of 0 still shows one page; Previous never goes negative", async () => {
    const onChange = vi.fn();
    render(<Pagination offset={10} limit={20} count={3} hasNext total={0} onChange={onChange} />);
    expect(nav()).toHaveTextContent("page 1 of 1");
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
  it("page size selector", async () => {
    const onLimit = vi.fn();
    render(<Pagination offset={0} limit={50} count={50} hasNext onChange={() => {}} onLimitChange={onLimit} />);
    const sel = screen.getByRole("combobox") as HTMLSelectElement;
    expect(sel.value).toBe("50");
    expect([...sel.options].map((o) => o.text)).toEqual(["20 / page", "50 / page", "100 / page"]);
    await userEvent.selectOptions(sel, "100");
    expect(onLimit).toHaveBeenCalledWith(100);
  });
});

describe("Tabs", () => {
  const tabs = [
    { value: "a", label: "Alpha", badge: <b>3</b> },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];
  function Host() {
    const [v, setV] = useState("a");
    return (
      <>
        <Tabs id="t" tabs={tabs} value={v} onChange={setV} label="Sections" />
        <TabPanel tabsId="t" value={v} className="p">
          panel {v}
        </TabPanel>
      </>
    );
  }
  it("selection, roving tabindex, aria linkage and panel", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeTruthy();
    const a = screen.getByRole("tab", { name: /Alpha/ });
    const b = screen.getByRole("tab", { name: "Beta" });
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
    expect(a).toHaveTextContent("3");
    expect(a.id).toBe(tabId("t", "a"));
    expect(a).toHaveAttribute("aria-controls", tabPanelId("t", "a"));
    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe(tabPanelId("t", "a"));
    expect(panel).toHaveAttribute("aria-labelledby", a.id);
    await user.click(b);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel b");
  });
  it("arrow keys wrap and move focus, Home/End jump, other keys ignored", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const a = screen.getByRole("tab", { name: /Alpha/ });
    a.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel b");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Beta" }));
    await user.keyboard("{End}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel c");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel a");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel c");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel a");
    await user.keyboard("x");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel a");
  });
  it("default label is 'Tabs'", () => {
    render(<Tabs id="x" tabs={tabs} value="a" onChange={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Tabs" })).toBeTruthy();
  });
  it("unmounting a tab drops its ref without errors", () => {
    const { rerender } = render(<Tabs id="x" tabs={tabs} value="a" onChange={() => {}} />);
    rerender(<Tabs id="x" tabs={tabs.slice(0, 1)} value="a" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });
});

describe("Modal", () => {
  const dlg = () => document.querySelector("dialog") as HTMLDialogElement;
  it("opens via showModal, focuses data-autofocus, and closes on prop change", () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}} title="T" footer={<button>F</button>}>
        <input aria-label="first" />
        <input aria-label="auto" data-autofocus />
      </Modal>,
    );
    expect(dlg().open).toBe(false);
    rerender(
      <Modal open onClose={() => {}} title="T" footer={<button>F</button>}>
        <input aria-label="first" />
        <input aria-label="auto" data-autofocus />
      </Modal>,
    );
    expect(dlg().open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("auto"));
    expect(dlg()).toHaveAttribute("aria-labelledby", screen.getByRole("heading", { name: "T" }).id);
    expect(screen.getByRole("button", { name: "F" })).toBeTruthy();
    rerender(
      <Modal open={false} onClose={() => {}} title="T">
        x
      </Modal>,
    );
    expect(dlg().open).toBe(false);
    expect(screen.queryByRole("button", { name: "F" })).toBeNull();
  });
  it("falls back to the first control, never the close button", () => {
    render(
      <Modal open onClose={() => {}} title="T">
        <input aria-label="first" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
  });
  it("with nothing focusable inside, focus is left alone", () => {
    render(
      <Modal open onClose={() => {}} title="T">
        text only
      </Modal>,
    );
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Close" }));
  });
  it("close button and native close event call onClose", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">
        x
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => escape(dlg()));
    expect(dlg().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("Escape is blocked and the x disabled when not dismissible", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T" dismissible={false}>
        x
      </Modal>,
    );
    act(() => escape(dlg()));
    expect(dlg().open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.pointerDown(dlg());
    fireEvent.pointerUp(dlg());
    expect(onClose).not.toHaveBeenCalled();
  });
  it("backdrop click needs press and release on the backdrop; inner drags don't close", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">
        <input aria-label="in" />
      </Modal>,
    );
    const inner = screen.getByLabelText("in");
    fireEvent.pointerDown(inner);
    fireEvent.pointerUp(dlg());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dlg());
    fireEvent.pointerUp(inner);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dlg());
    fireEvent.pointerUp(dlg());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("side and width variants", () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="T" side>
        x
      </Modal>,
    );
    expect(dlg().className).toContain("inset-y-0");
    rerender(
      <Modal open onClose={() => {}} title="T" width="max-w-xs">
        x
      </Modal>,
    );
    expect(dlg().className).toContain("max-w-xs");
  });
});

describe("ConfirmDialog", () => {
  beforeAll(installDialogPolyfill);
  it("confirm and cancel callbacks; cancel is the autofocus", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete it?" message={<em>sure</em>} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("sure")).toBeTruthy();
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del.className).toContain("bg-danger");
    await userEvent.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it("non-destructive, custom label", () => {
    render(<ConfirmDialog open title="T" message="m" confirmLabel="Publish" destructive={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Publish" }).className).toContain("bg-accent");
  });
  it("loading disables both actions and blocks dismissal", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open loading title="T" message="m" onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
    act(() => escape(document.querySelector("dialog")!));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("ChipInput", () => {
  function Host({ initial = ["a"] }: { initial?: string[] }) {
    const [v, setV] = useState(initial);
    return (
      <Field label="Tags">
        <ChipInput values={v} onChange={setV} label="Tag input" />
      </Field>
    );
  }
  const chips = () => [...document.querySelectorAll("span.rounded-full")].map((s) => s.textContent!.replace("×", ""));
  it("Enter and comma commit trimmed unique values; field label targets the input", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByLabelText("Tag input") as HTMLInputElement;
    expect(input.id).toBe(screen.getByText("Tags").getAttribute("for"));
    await user.type(input, "  b {Enter}");
    expect(chips()).toEqual(["a", "b"]);
    expect(input.value).toBe("");
    await user.type(input, "c,");
    expect(chips()).toEqual(["a", "b", "c"]);
    await user.type(input, "a{Enter}");
    expect(chips()).toEqual(["a", "b", "c"]);
    await user.type(input, "{Enter}");
    expect(chips()).toEqual(["a", "b", "c"]);
  });
  it("blur commits; backspace on empty removes the last; remove button removes one", async () => {
    const user = userEvent.setup();
    render(<Host initial={["a", "b"]} />);
    const input = screen.getByLabelText("Tag input");
    await user.type(input, "z");
    await user.tab();
    expect(chips()).toEqual(["a", "b", "z"]);
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(chips()).toEqual(["a", "b"]);
    await user.type(input, "q{Backspace}");
    expect(chips()).toEqual(["a", "b"]); // backspace with text only edits the text
    await user.click(screen.getByRole("button", { name: "Remove a" }));
    expect(chips()).toEqual(["b"]);
    await user.click(input);
    await user.keyboard("{Backspace}{Backspace}");
    expect(chips()).toEqual([]);
  });
});
