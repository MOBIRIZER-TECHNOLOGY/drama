import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { ToastProvider } from "@/components/toast";

/** Render inside the real ToastProvider (every page uses `useToast`). */
export function renderPage(ui: ReactElement, opts?: Omit<RenderOptions, "wrapper">) {
  const Wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;
  return render(ui, { wrapper: Wrapper, ...opts });
}
