import { aiStep, aiAddResults, prepareTurns } from "./ai.js";
import { isJiraWriteTool, jiraToolDefinitions, prepareJiraWrite, runJiraReadTool } from "./jira-actions.js";

export const MAX_STEPS = 8;

// Runs a chat turn that may call Jira tools. Reads run on their own; a write pauses the run as `pending`
// until confirm(true) executes it or confirm(false) cancels it. Either way the model then receives the outcome.
export class AgentRun {
  constructor({ config, messages, jira = null, onActivity = () => {}, signal } = {}) {
    this.config = config;
    this.jira = jira;
    this.onActivity = onActivity;
    this.signal = signal;
    this.turns = prepareTurns(messages);
    this.tools = jira ? jiraToolDefinitions() : [];
    this.provider = null;
    this.calls = null;
    this.outputs = [];
    this.pending = null;
    this.steps = 0;
  }

  start() {
    return this.#loop();
  }

  confirm(approved) {
    if (!this.pending) throw new Error("Não há ação aguardando confirmação.");
    const { title, run } = this.pending;
    this.pending = null;
    return this.#settle(title, run, approved);
  }

  async #settle(title, run, approved) {
    let output;
    if (!approved) {
      output = { error: "O usuário cancelou esta ação." };
    } else {
      try {
        output = await run();
        this.onActivity(`Concluído: ${title}`);
      } catch (error) {
        output = { error: error.message };
      }
    }
    this.outputs.push(output);
    return this.#loop();
  }

  async #loop() {
    for (;;) {
      if (this.calls) {
        if (await this.#processCalls()) return { pending: this.#publicPending() };
        this.turns = aiAddResults(this.provider, this.turns, this.calls, this.outputs);
        this.calls = null;
        this.outputs = [];
      }
      if (this.steps >= MAX_STEPS) {
        throw new Error(`O assistente atingiu o limite de ${MAX_STEPS} passos nesta resposta. Tente uma pergunta mais específica.`);
      }
      this.steps += 1;
      const step = await aiStep(this.config, this.turns, { tools: this.tools, signal: this.signal });
      this.provider = step.provider;
      this.turns = step.turns;
      if (!step.calls.length) return { done: true, text: step.text, truncated: Boolean(step.truncated), provider: step.provider };
      this.calls = step.calls;
      this.outputs = [];
    }
  }

  // Returns true when a write needs confirmation; otherwise every call in the batch has an output.
  async #processCalls() {
    while (this.outputs.length < this.calls.length) {
      const call = this.calls[this.outputs.length];
      if (!this.jira || call.args === null) {
        this.outputs.push({ error: call.args === null ? "Argumentos inválidos enviados pelo assistente." : "Integração com Jira não configurada." });
        continue;
      }
      if (isJiraWriteTool(call.name)) {
        try {
          this.pending = { call, ...(await prepareJiraWrite(this.jira, call.name, call.args)) };
        } catch (error) {
          this.outputs.push({ error: error.message });
          continue;
        }
        return true;
      }
      this.onActivity(`Consultando ${call.name}`);
      try {
        this.outputs.push(await runJiraReadTool(this.jira, call.name, call.args));
      } catch (error) {
        this.outputs.push({ error: error.message });
      }
    }
    return false;
  }

  #publicPending() {
    return { title: this.pending.title, lines: [...this.pending.lines] };
  }
}
