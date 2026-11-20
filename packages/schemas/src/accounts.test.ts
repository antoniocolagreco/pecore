import { describe, expect, it } from "vitest";
import { forgeHost, withForgeHosts } from "./accounts";
import type { Accounts } from "./accounts";

describe("forge host", () => {
  it("keeps only the host name the forge tools log in to", () => {
    expect(forgeHost("https://gitlab.com/")).toBe("gitlab.com");
    expect(forgeHost(" HTTPS://GitLab.example.com/team/app.git ")).toBe("gitlab.example.com");
    expect(forgeHost("ssh://git@git.example.com:2222/team/app.git")).toBe("git.example.com:2222");
    expect(forgeHost("git@git.example.com")).toBe("git.example.com");
    expect(forgeHost("github.com")).toBe("github.com");
    expect(forgeHost("")).toBe("");
  });

  it("cleans the host of forge accounts loaded from an accounts file and leaves other accounts alone", () => {
    const file: Accounts = {
      accounts: [
        { id: "glab-me", kind: "forge", forge: "gitlab", host: "https://gitlab.com/", tool: "glab", user: "me", author: { name: "Me", email: "me@example.com" } },
        { id: "claude", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription", email: null, maxParallel: 2 },
      ],
    };
    expect(withForgeHosts(file).accounts).toEqual([
      { id: "glab-me", kind: "forge", forge: "gitlab", host: "gitlab.com", tool: "glab", user: "me", author: { name: "Me", email: "me@example.com" } },
      { id: "claude", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription", email: null, maxParallel: 2 },
    ]);
  });
});
