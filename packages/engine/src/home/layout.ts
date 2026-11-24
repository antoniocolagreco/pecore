import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { jsonSchemas } from "@pecore/schemas";

export function homePaths(home: string) {
  return {
    home,
    settings: join(home, "settings.json"),
    agents: join(home, "agents.json"),
    agentContexts: join(home, "agents"),
    accounts: join(home, "accounts.json"),
    profiles: join(home, "profiles.json"),
    autoSetup: join(home, "auto-setup.json"),
    tiers: join(home, "tiers.json"),
    chatsDb: join(home, "chats.db"),
    chats: join(home, "chats"),
    harness: join(home, "harness"),
    templates: join(home, "templates"),
    templateNodes: join(home, "templates", "nodes"),
    templateRecipes: join(home, "templates", "recipes"),
    projects: join(home, "projects"),
    adapters: join(home, "adapters"),
    schemas: join(home, "schemas"),
    run: join(home, "run"),
    lock: join(home, "run", "lock"),
    apiFile: join(home, "run", "api.json"),
    themes: join(home, "themes"),
  };
}

export function projectPaths(projectDir: string) {
  return {
    dir: projectDir,
    project: join(projectDir, "project.json"),
    nodes: join(projectDir, "nodes"),
    recipes: join(projectDir, "recipes"),
    knowledge: join(projectDir, "knowledge"),
    db: join(projectDir, "pecore.db"),
    repo: join(projectDir, "repo.git"),
    work: join(projectDir, "work"),
    logs: join(projectDir, "logs"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const previousShippedHashes: ReadonlyMap<string, readonly string[]> = new Map([
  ["nodes/github-issues-comment.sh", ["fc00dd16b9f2f8acf8a5229d85e35f62fededbb23eaf573310b148ac6b1087cb"]],
  ["nodes/gitlab-issues-comment.sh", ["093a69585c5363072981eafeece2b7aaea440aa639a68401668aa22f38b6f189"]],
  ["nodes/jira-comment.sh", ["77898c3ff62f54b513705bf5ad9eb31d1e050e35cff483168b9f1d89c6b5ab18"]],
  ["nodes/markdown-folder-comment.sh", ["52a276e35cb4a49f4756fb68eff3d2de34276c7ba4ef61c074b864f79d7609d6"]],
  ["nodes/resolve-rebase-conflicts.json", ["d2df5213056e6207eec0e5b12fc5a8891cf9f516efd591e033c1f93b813de6f1"]],
  ["nodes/wait-for-ci.json", ["6b7461d4217479fde94a33b4587e79a099f961380104db99c52c6e8b1b3dba7f"]],
  ["nodes/github-pr.json", ["94beb5e3871cb7fdf71878a21b64a870f52be1bc8f607e6f30e3344e862ba39d", "95fd4ddcc1ae4556677e93981a2f1de440116e1b586458f5a385f3ef9129e353", "e2daf41b7d33f470fb7d78a21844353f167d88d570f96fdeeccb7ea8804349f3", "6ef3a09d0f245df703749aba6d0b669408be9fce6b869a370707d4ef2e8fb75a"]],
  ["nodes/github-pr.sh", ["fed0edcb88302c6ce34abed994443998be4e5e50ab8a7ddbaed98bab66353a01"]],
  ["nodes/git-push.sh", ["e80165bc3cdb599bac5010afbca5ee8b43f2603acb1f36a870520778c5ed2a1c"]],
  ["nodes/human-review.json", ["c2fa7065b330a6fd005aa4da046f3b7253047accdb97c9197740930ed72aeb70", "f636c8d7191eeb8784b1a2e4a0e3d6d4701f1e4bf7c926f8486234dfb4d0269f", "c756cdb25911b08bb40af55b4eb2247ea4e5e019ccc3c90e3274f0ea9bbab248", "862971a038f216fc253f531458a91d5fbf669255b640ef70da501160eb0c1274", "c33127ef5fc9416cea0d594d7e6721d788f03a98ccbbe1bdd093357b0b3c797e", "45c910717c664767c879b180b7c0b385745f3ec5b86592890dddcb398ea0343b", "1dc4789252a86d4fc1bc90098ceeb9fc94e5e2047eea7a261688ec08e5b47498"]],
  ["nodes/human-decision.json", ["d495a500dc693c40c6ee68685ddbaa1ce3ec14ee20e718875283138c5b0412c4", "d222ef22f8ae29e188d573bb85a95e1e7b34be8d816fe48e76edcd5471ed8caa"]],
  ["icons/node-human-decision.svg", ["41e4acfbb118105fb6c7844edb5fbfb15fc79f8ea939a805c0f4d823905bc0ad"]],
  ["nodes/gitlab-mr.json", ["6c397335104ed03e0b576aa45a57d13d250d0e126b8b4a158bec6d1ddfd631c7", "290ae9f7ad93471bd3aaf15fffc822e9b21f116a2a87d7c85ca885d660e9e178", "00b6b137b30e4916421ad25ad1552fcd35e4094cce90534dfc0bfde0c3275470", "03c3b0e18dff8491de0eab11f83a251a4f52723daba670c969537f2a7305da2b"]],
  ["nodes/cargo-check.json", ["8be45f65d6f300465dca1a411613414c891ae2d8a5ff9e1d41a1e191d312673e", "fc4a64d7c36290dde5a858afeefc962e447552b107fd2753cb2cf2d60704dbf5", "21b6d0a0445d391aa2cf2012d0ad70542cc7d1732c96defeaa791674ad5acc11"]],
  ["forges/git.json", ["4d4ae33b99e70c1c2cbf250d14b6895d192bdd113200ce8d0004f7d48f318b66"]],
  ["nodes/write-pr.json", ["9fe0defe866e948fc659323e728dfb3545994f4099113df8b45e6480d9a3405e", "e8e67ed3790552296d03cafac2b222e6c905a428afd75530101f97676f981787", "0a037f8c49069dbcae393559d1488c3518d8e5ccbc187b7d96ec8a7943f8cf4e"]],
  ["nodes/git-commit.json", ["bd23681b16252cebcc65e1d0453ea3a6c5fff4c39e3f8b3a6d7634986ae6a416", "4738f956605c04f37c781f4b4bea777dc1961592b9d03addd35e66e9972570a1", "ba00f5067a33a750951769de227ba4c39f193778deeed8791f19b968b267b127"]],
  ["nodes/git-delivery.json", ["5ff8da3d8d780c84f1d871c3a72b3a433ab1c2223014072fd4ee3e9efe0d4b73", "e0e3292269cd6214c15daf39c99eb19188c275b1d08270e2f68e0ce792f5a06e", "2ec70a8710afd982d7c57e71a8f15e4ab79029ee8c20b5d2ede45fa56d3bb1f4"]],
  ["nodes/git-push.json", ["6003a16081cf1bbb2c2bf941d3f2fcb39ef07200b31c6dacfd7c84b2e7607551", "1f7d3684c8cbbb89e5cf8ee723031b8779c0d3320abc7191a3bad2a1736857de", "7c7c69fd79c78c725fd3bf37a95035dc2d4c944024d41533adcaeb99be3be0ef"]],
  ["nodes/git-rebase.json", ["ae2166ac7a171f48517f75f3cc7c1bf6c0ff75c7eb2715c6b73457737ca31e4f", "d724a603b96ce5946971b54d1f32a8429d374b2edb2a8f623658c04c8e74369f", "9bf1ab386f270cfddf53a03f17bd22d3b61afd6fa3fcd1e831faa5222b0a6211"]],
  ["nodes/github-create-repo.json", ["61d42b6799ab812cfd8f114c9f4435f796e40079bc2a7b0475565c302c1a1524", "d4a94103b123821e3ebfd13eb098e0e618d9b5752053b225fa816019b0c005e6", "d8925d129a5d9f185f7b1a4984e9d324a7ce42ff839502a80ebeacd7e4150564"]],
  ["nodes/gitlab-create-repo.json", ["3a6200d03367f975f7adddff9c932abcf5a979119c2f2b31c8ea7845aae8f376", "c9899d6d0a6d959f59bd5bc1625869b7d09918f000df5918291114beda5d0208", "55757c3e4839fad922a92e12d169221accc0e13796a97e0068579fe91face206"]],
  ["nodes/github-issue-comment.json", ["8101c964c7bceb64768795283f4a57224cf2ff1c4f5a6359bb7ea5677532bfe8", "219013ff46a851ab11dda5e74360973c929d4d18faa0e46548d3f5abd4e36abe", "d14c568e6c5795603fadc05e4c41e3066feeaa8ed948fbd88df9947a816b932f"]],
  ["nodes/gitlab-issue-comment.json", ["e14b782993c8f6a6956832dceda19a3da58d4ec5739d8249e6b4231c7ea2bd5a", "c5f8e5ebf1455127dec8e0dea9cbcfe2e09cd06e7d06d3397e1f6606f0b7faad", "403bac5dd4349439b1a96fa77b805b4812020076b2a5710374d29d4805a473d0"]],
  ["nodes/approver.json", ["4b0b1f7a9436051a04bef71caa3db17c8199a06b7f28897c0c6515abf0896ef9", "b71cf4f5b12da4470130a5ed76b42c6d4fd577b5ec542ddd674b67469dfeea0d", "f76a74041acdf2c552914588935261f83ead684bf97731f2845dd92f7d44912a"]],
  ["nodes/builder.json", ["3ee3bfb005d0a57e5349c9153e828dde834c81e9736caafe9e23b85ba6df849e", "85b61589aa0d90fbee66a7d73af1eaf4cf6ccaf49ca89f7991103c6d05cf353c", "653dd308431fa16758dc73e4d549f8bc682628e724b3776a1d1b970fc96ca220"]],
  ["nodes/cargo-clippy.json", ["7abf94eea130de715642d49391929fdbed8292e29bbc8fde3e3ffb0ea6a3080a", "f3b16abe19b7101a8143a0daf5fa40484718adab89f006d4438e4dfaa63cb273", "92fdfd421f353fdb03bf91abef0b4d194ed66e5df5dd716c6479b5aa44b35f9b"]],
  ["nodes/cargo-test.json", ["f4fcc1efc20183cd96b8abb25e6c20a451ec9c0ab510edbbd7d2164f2d439784", "729c2a0bc2c509343bd41102c9673ecbd48dc9c684ebe30e6cfce8c6e158eaf9"]],
  ["nodes/code-reviewer.json", ["47099389905949755573c156fe69d7b6726f559e228cd447421153c9ff6270bc", "3d48cd6d79d0f7a807e82590daa354ed2b55953fc20ed4dd78ab366fb4e34d54", "e7299ba42af8b61de160ac73e098dadb87120d220b43f77ac87293b62db9d030"]],
  ["nodes/eslint.json", ["f3566e107a5166d5d448537e07895318a58aba228e5210ba917af37393582dcb", "671bbdfa2b71dc8b582093e50b2fc8af27ffabb045b820ed8088881ff6f6947f", "2ad25a02386bc9b8f1dfe589544c503e980e572a89c3f8c1ed288ccff51eb420"]],
  ["nodes/github-issues.json", ["a6ebc2ce895f800075a51f43937a8615efd7b7b9c03be3faf0a7df19adab2370"]],
  ["nodes/gitlab-issues.json", ["72a25d6716957d4e0169cc3ac01ab7c18863a1cb90049f0a05d27026a2a8beb1"]],
  ["nodes/jira.json", ["432182c14cf1ad5ea5a1716d2735a77754ab22eb47f312d4850aa34cdd95043f"]],
  ["nodes/markdown-folder.json", ["225074223cc9ebf4b957f349f4b8cb20f9cc7d152524b28f60b242c7253dad2d"]],
  ["nodes/spec-writer.json", ["87068d5a5754fc604ef7d1834789f8049c4e89d92ebf803d284cb6c5d94c9049", "14dd86f4abdde9a5de6d36c782162ce0f37719579694016bd3b2b9ceb32df122", "5bb54d3affaa7a6628165d51e31cdb1306074a0b1da5780f9e582428243340f2"]],
  ["nodes/tests-fail-check.json", ["e5f5ae61737e38eab76f4f91ae81fd9d0280e64169a84092b8d73a3858a6a421", "9bc652e588fcbc3f025cd9993e61047e5381e3f069e1afecd22af883c6c2ba0c"]],
  ["nodes/tests-writer.json", ["163afb5c81b172745208798f76d37359deb692c8fa7a9a0ccb7e8aa55cc6528c", "8cdabae341c763a1c6d1220ac76e2cbeb49e0909395fd0781eb542dfe53ea8f6"]],
  ["nodes/typecheck.json", ["a5b69ce5a5b45674d506a096230f0d6cd3553eec148d4ded8d7cb5775f49b6ca", "c3accb1d698cf67e6544304185c712bf0acb00abc22a62848970caeec2eb327a", "6f55500b15efd7c055d5fd06a47879f3b82de2ccc2a431c3f08470e7d09453f3"]],
  ["nodes/vitest.json", ["7e29efde28b538fdc6c34c094cd2a7a5fd8bce2c415f2c448832c9b23e27ffe1", "4c18807a84f73febe8adae85fa8240c223dae836cdf74528c845f2cd83a15049"]],
]);

const retiredShippedHashes: ReadonlyMap<string, readonly string[]> = new Map([
  ["recipes/empty.json", ["d5aeb3f6f5d017214284b2e2dccb1cbb0637fa9a7006c7039f7d68e95a63bee7"]],
  ["icons/recipe-empty.svg", ["b628ede0d499969ae3f7eccfbdd12dffed1ece97ba4065beae14f50d622775b2"]],
  ["recipes/feature.json", ["797ff459004ba0da6e728ec0da8a547300fc218c2492d28f590d1ab45af20f51"]],
  ["recipes/local-only.json", ["6b2a4ba6ee7d717d07147eecb9a4771dbdd04d17fcc5d88de72b87d7981549d3"]],
  ["recipes/bugfix.json", ["69025d843cb0f0d2205ba92790d076e2cb6dbdc50da8444610febad34ec49f0c"]],
  ["icons/recipe-feature.svg", ["471b9b48197661b9d25309c38530f2a26c9090e776f050628d6911c186447b17"]],
  ["icons/recipe-local-only.svg", ["07fff36b9a15e64991f771806ea74ad695ed7e9e7305602932a0df026523a3bf"]],
  ["icons/recipe-bugfix.svg", ["0e72f244d42e18607d31654ff16488ae993c042d27a8cf6f98b9612f139f99f9"]],
]);

async function removeRetiredTemplateFiles(templates: string): Promise<string[]> {
  const removed: string[] = [];
  for (const [path, hashes] of retiredShippedHashes) {
    const target: string = join(templates, path);
    if (!(await exists(target)) || !hashes.includes(createHash("sha256").update(await readFile(target)).digest("hex"))) continue;
    await rm(target);
    removed.push(target);
  }
  return removed;
}

export const templatesFormat: string = "3";

async function addShippedTemplateFiles(shipped: string, templates: string): Promise<string[]> {
  const added: string[] = [];
  const marker: string = join(templates, ".format");
  const current: boolean = (await readFile(marker, "utf8").catch(() => "")).trim() === templatesFormat;
  for (const entry of await readdir(shipped, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path: string = relative(shipped, join(entry.parentPath, entry.name));
    const target: string = join(templates, path);
    if (current && await exists(target)) {
      const previous: readonly string[] | undefined = previousShippedHashes.get(path);
      if (!previous?.includes(createHash("sha256").update(await readFile(target)).digest("hex"))) continue;
      if (previous.includes(createHash("sha256").update(await readFile(join(shipped, path))).digest("hex"))) continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(join(shipped, path), target);
    added.push(target);
  }
  if (!current) await writeFile(marker, templatesFormat + "\n");
  return added;
}

async function renameLibrary(home: string, templates: string): Promise<void> {
  const library: string = join(home, "library");
  if (!(await exists(library)) || (await exists(templates))) return;
  await rename(library, templates);
}

export async function initHome(home: string, opts: { templates: string }): Promise<{ created: boolean }> {
  const p = homePaths(home);
  const created = !(await exists(p.templates)) && !(await exists(join(home, "library")));
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(p.run, { recursive: true, mode: 0o700 });
  if (!created) await renameLibrary(home, p.templates);
  for (const dir of [p.templateNodes, p.templateRecipes, p.projects, p.themes]) await mkdir(dir, { recursive: true });
  await writeSchemas(home);
  if (!created) {
    await addShippedTemplateFiles(opts.templates, p.templates);
    await removeRetiredTemplateFiles(p.templates);
    return { created };
  }
  await cp(`${opts.templates}/`, p.templates, { recursive: true, force: false, errorOnExist: false, dereference: true });
  await writeFile(join(p.templates, ".format"), templatesFormat + "\n");
  return { created };
}

export async function writeSchemas(home: string): Promise<void> {
  const dir = homePaths(home).schemas;
  await mkdir(dir, { recursive: true });
  for (const [file, schema] of Object.entries(jsonSchemas())) {
    await writeFile(join(dir, file), JSON.stringify(schema, null, 2) + "\n");
  }
}

export async function syncAdapters(home: string, opts: { source: string; appVersion: string; pinned: string[] }): Promise<boolean> {
  const dir = homePaths(home).adapters;
  const versionFile = join(dir, "version");
  const current = await readFile(versionFile, "utf8").catch(() => null);
  if (current?.trim() === opts.appVersion && (!(await exists(join(opts.source, "chat-mcp.mjs"))) || (await exists(join(dir, "chat-mcp.mjs"))))) return false;
  await mkdir(dir, { recursive: true });
  await cp(`${opts.source}/`, dir, { recursive: true, force: true, preserveTimestamps: true, dereference: true });
  const keep = new Set(["version", "node", "chat-mcp.mjs", ...opts.pinned]);
  for (const entry of await readdir(dir)) {
    if (entry.startsWith("@")) {
      for (const inner of await readdir(join(dir, entry))) if (!keep.has(`${entry}/${inner}`)) await rm(join(dir, entry, inner), { recursive: true, force: true });
      if ((await readdir(join(dir, entry))).length === 0) await rm(join(dir, entry), { recursive: true, force: true });
    } else if (!keep.has(entry)) await rm(join(dir, entry), { recursive: true, force: true });
  }
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) await chmod(path, 0o755);
    else if (entry.isFile()) await chmod(path, (await stat(path)).mode & 0o111 ? 0o755 : 0o644);
  }
  await writeFile(versionFile, opts.appVersion + "\n");
  return true;
}
