const nameWords: ReadonlyMap<string, string> = new Map<string, string>([
  ["bugfix", "Bug Fix"],
  ["eslint", "ESLint"],
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["mr", "MR"],
  ["pr", "PR"],
  ["to", "to"],
  ["typecheck", "Type Check"],
]);

export function templateTitle(name: string): string {
  return name.split("-").filter(Boolean).map((word) => nameWords.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
