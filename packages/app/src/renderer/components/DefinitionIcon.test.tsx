import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DefinitionIconField } from "./DefinitionIcon";

afterEach(cleanup);

it.each(["node", "recipe"] as const)("offers the menu icons and lock for a %s", async (type) => {
  const onChange = vi.fn<(value: string) => void>();
  const user = userEvent.setup();
  const { rerender } = render(<DefinitionIconField icons={undefined} type={type} name="example" value="" disabled={false} onChange={onChange} />);
  await user.tab();
  await user.keyboard("{ArrowDown}");
  await screen.findByRole("listbox");
  for (const name of ["app-factory", "app-folder", "app-list", "app-bell", "app-book", "app-spark", "app-gear", "app-box", "app-lock"]) {
    expect(screen.getByRole("option", { name })).toBeTruthy();
  }
  await user.click(screen.getByRole("option", { name: "app-lock" }));
  expect(onChange).toHaveBeenCalledWith("app-lock");
  rerender(<DefinitionIconField icons={undefined} type={type} name="example" value="app-lock" disabled={false} onChange={onChange} />);
  expect(screen.getByRole("combobox", { name: "Icon" }).querySelector("svg rect")).toBeTruthy();
});
