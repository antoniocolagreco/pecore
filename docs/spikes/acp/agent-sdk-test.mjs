import { query } from "@anthropic-ai/claude-agent-sdk";

const work = new URL("./work/", import.meta.url).pathname;
const turns = [
  "Crea il file nota.txt con il testo 'ciao pecora' usando il tool Write. Poi rispondi solo 'fatto'.",
  "Cosa c'è scritto in nota.txt? Rispondi con il testo esatto.",
];

let release;
async function* input() {
  for (const text of turns) {
    yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" };
    await new Promise((r) => (release = r));
  }
}

const q = query({
  prompt: input(),
  options: {
    cwd: work,
    model: "sonnet",
    settingSources: [],
    permissionMode: "default",
    canUseTool: async (toolName, toolInput) => {
      console.log("PERMISSION", toolName, JSON.stringify(toolInput));
      return { behavior: "allow", updatedInput: toolInput };
    },
  },
});

for await (const m of q) {
  if (m.type === "system" && m.subtype === "init") {
    console.log("INIT", JSON.stringify({ session: m.session_id, apiKeySource: m.apiKeySource, model: m.model, version: m.claude_code_version, tools: m.tools.length }));
  } else if (m.type === "assistant") {
    for (const c of m.message.content) {
      if (c.type === "text") console.log("TEXT", c.text);
      if (c.type === "tool_use") console.log("TOOL_USE", c.name);
    }
  } else if (m.type === "result") {
    console.log("RESULT", JSON.stringify({ subtype: m.subtype, is_error: m.is_error, result: m.result, session: m.session_id, cost: m.total_cost_usd, usage: { in: m.usage.input_tokens, cw: m.usage.cache_creation_input_tokens, cr: m.usage.cache_read_input_tokens, out: m.usage.output_tokens } }));
    if (release) release();
  } else if (m.type === "rate_limit_event") {
    console.log("RATE", JSON.stringify(m.rate_limit_info.status));
  }
}
console.log("END");
