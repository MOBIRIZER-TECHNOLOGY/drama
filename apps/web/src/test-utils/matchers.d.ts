import "vitest";

interface DomMatchers<R = unknown> {
  toBeInTheDocument(): R;
  toHaveAttribute(name: string, value?: string): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toHaveTextContent(text: string | RegExp): R;
  toHaveClass(...classes: string[]): R;
  toBeChecked(): R;
  toHaveValue(value: unknown): R;
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends DomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends DomMatchers {}
}
