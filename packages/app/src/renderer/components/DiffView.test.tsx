import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DiffView } from "./DiffView";

afterEach(cleanup);

it("passes the file and line for every line chosen for review", async () => {
  const content: string = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -0,0 +1,2 @@\n+const first = 1;\n+const second = 2;\n";
  const onComment = vi.fn<(line: { file: string; line: number }) => void>();
  render(<DiffView content={content} onComment={onComment} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Comment on line 1" }));
  await user.click(screen.getByRole("button", { name: "Comment on line 2" }));
  expect(onComment.mock.calls).toEqual([[{ file: "app.ts", line: 1 }], [{ file: "app.ts", line: 2 }]]);
});
