import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkKnowledge, knowledgeClosure, knowledgeLinks, knowledgeNames, removeBrokenKnowledgeLinks, renameKnowledgeLinks } from "./knowledge";

describe("knowledge files", () => {
  it("accepts links to existing files by name and ignores web addresses and anchors", () => {
    const content: string = "# Guide\n\nSee [naming](naming.md#rules), [site](https://example.com) and [top](#guide).\n\n[ref]: setup.md\n";
    const result = checkKnowledge(content, new Set(["guide.md", "naming.md", "setup.md"]));
    expect(result.errors).toEqual([]);
    expect(result.links.sort()).toEqual(["naming.md", "setup.md"]);
  });

  it("refuses links to missing files and links with a path, with their position", () => {
    const content: string = "# Guide\n\nSee [a](missing.md) and [b](docs/naming.md).\n";
    expect(checkKnowledge(content, new Set(["guide.md", "naming.md"])).errors).toEqual([
      { line: 3, column: 9, length: 10, message: "missing.md is not a knowledge file of this project" },
      { line: 3, column: 29, length: 14, message: "docs/naming.md uses a path: link another knowledge file by its name only, for example naming.md" },
    ]);
  });

  it("reports formatting findings as warnings without the line-length rule", () => {
    const content: string = "# Guide\n# Second title\n\n* one\n- two\n\n" + "word ".repeat(60) + "\n";
    const { errors, warnings } = checkKnowledge(content, new Set(["guide.md"]));
    expect(errors).toEqual([]);
    expect(warnings.map(({ line }) => line)).toEqual(expect.arrayContaining([2, 5]));
    expect(warnings.some(({ message }) => /line length/i.test(message))).toBe(false);
  });

  it("renames links to a file and keeps their anchors and other links", () => {
    const content: string = "See [a](old.md), [b](old.md#part) and [c](other.md).\n\n[r]: old.md\n";
    expect(renameKnowledgeLinks(content, "old.md", "new.md")).toBe("See [a](new.md), [b](new.md#part) and [c](other.md).\n\n[r]: new.md\n");
    expect(knowledgeLinks("[x](a.md) [y](a.md) [z](http://x.y/b.md)")).toEqual(["a.md"]);
  });

  it("removes links to missing files or with a path, keeping their text, and drops broken definitions", () => {
    const content: string = "See [a](missing.md), [b](docs/x.md#y), [ok](ok.md), ![pic](img.png) and [web](https://e.com).\n\n[ref]: gone.md\n[good]: ok.md\nEnd.\n";
    expect(removeBrokenKnowledgeLinks(content, new Set(["ok.md"]))).toEqual({
      content: "See a, b, [ok](ok.md), pic and [web](https://e.com).\n\n[good]: ok.md\nEnd.\n",
      removed: ["missing.md", "docs/x.md#y", "img.png", "gone.md"],
    });
    expect(removeBrokenKnowledgeLinks("Nothing to do.\n", new Set())).toEqual({ content: "Nothing to do.\n", removed: [] });
  });

  it("gives a node its files and every file they link to, skipping missing links and nested files", async () => {
    const dir: string = await mkdtemp(join(tmpdir(), "knowledge-"));
    await writeFile(join(dir, "architecture.md"), "See [naming](naming.md) and [gone](gone.md).\n");
    await writeFile(join(dir, "naming.md"), "See [glossary](glossary.md) and [back](architecture.md).\n");
    await writeFile(join(dir, "glossary.md"), "Terms.\n");
    await writeFile(join(dir, "unrelated.md"), "Other.\n");
    await mkdir(join(dir, "old"));
    await writeFile(join(dir, "old", "nested.md"), "Nested.\n");
    expect(await knowledgeNames(dir)).toEqual(["architecture.md", "glossary.md", "naming.md", "unrelated.md"]);
    expect(await knowledgeClosure(dir, ["architecture.md"])).toEqual(["architecture.md", "naming.md", "glossary.md"]);
    expect((await knowledgeClosure(dir, ["un*.md"]))).toEqual(["unrelated.md"]);
    expect(await knowledgeClosure(dir, [])).toEqual([]);
    expect(await knowledgeClosure(join(dir, "missing"), ["a.md"])).toEqual([]);
  });
});
