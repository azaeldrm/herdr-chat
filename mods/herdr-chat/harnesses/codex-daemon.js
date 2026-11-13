const COMMAND = "item/commandExecution/requestApproval";
const FILES = "item/fileChange/requestApproval";
const INPUT = "item/tool/requestUserInput";
const FILE_DECISIONS = ["accept", "acceptForSession", "decline", "cancel"];

export function codexThread(path) {
  // The conversation id in a Codex log's name (rollout-<time>-<id>.jsonl), or "".
  const m = /rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path ?? "");
  return m ? m[1].toLowerCase() : "";
}

function shellOf(command) {
  // The command as typed, unwrapped from the `bash -lc '…'` Codex runs it in.
  const m = /^\S*(?:ba|z)?sh\s+-l?c\s+'([\s\S]*)'$/.exec(command ?? "");
  return m ? m[1].replace(/'\\''/g, "'") : command ?? "";
}

function decisionLabel(d, files) {
  // What a decision's row says, worded as Codex's own dialog words it.
  const name = typeof d === "string" ? d : Object.keys(d)[0];
  if (name === "accept") return "Yes, proceed";
  if (name === "acceptForSession") return files ? "Yes, and don't ask again for these files" : "Yes, and don't ask again this session";
  if (name === "acceptWithExecpolicyAmendment") {
    const words = d.acceptWithExecpolicyAmendment?.execpolicy_amendment ?? [];
    return `Yes, and don't ask again for commands that start with \`${words.join(" ")}\``;
  }
  if (name === "applyNetworkPolicyAmendment") return "Yes, and allow this network access from now on";
  if (name === "decline") return "No, continue without it";
  if (name === "cancel") return "No, and tell Codex what to do differently";
  return null;
}

function card(request, question, options, extra = {}) {
  // A prompt as the question card shows one, answered through Codex's daemon rather than keys.
  const p = request.params;
  return {
    question, tabs: null, steps: [], review: null, options, multi: false, more: false, preview: null,
    sig: JSON.stringify(["daemon", request.method, p.itemId, extra.step ?? 0]),
    daemon: { method: request.method, item: p.itemId, ...extra },
  };
}

function approvalCard(request, files) {
  const p = request.params;
  const decisions = files ? FILE_DECISIONS : p.availableDecisions ?? ["accept", "cancel"];
  const options = decisions.map(d => ({ d, label: decisionLabel(d, files) })).filter(o => o.label)
    .map((o, i) => ({ n: i + 1, label: o.label, desc: [], selected: i === 0, answered: false, decision: o.d }));
  if (options.length < 2) return null;
  const shown = files ? [] : [`$ ${shellOf(p.command)}`, ...(p.cwd ? [`in ${p.cwd}`] : [])];
  const ask = files ? "Allow Codex to make these file changes?" : "Allow Codex to run this command?";
  return card(request, [...shown, p.reason || ask], options);
}

function inputCard(request, step, answers) {
  const p = request.params, q = p.questions?.[step];
  if (!q || q.isSecret) return null;
  const options = (q.options ?? []).map((o, i) => ({ n: i + 1, label: o.label, desc: o.description ? [o.description] : [], selected: i === 0, answered: false, answer: o.label }));
  if (q.isOther || !options.length) options.push({ n: options.length + 1, label: "Type something", desc: [], selected: !options.length, input: "text" });
  const steps = p.questions.length > 1 ? p.questions.map((x, i) => ({ label: x.header || `Question ${i + 1}`, done: i < step })) : [];
  return { ...card(request, [q.question], options, { step, answers, questions: p.questions.map(x => x.id) }), steps };
}

export function daemonChoices(request, step = 0, answers = {}) {
  // The question card for a request Codex's daemon has open (null: the terminal handles that kind).
  if (!request?.params?.itemId) return null;
  if (request.method === COMMAND) return approvalCard(request, false);
  if (request.method === FILES) return approvalCard(request, true);
  if (request.method === INPUT) return inputCard(request, step, answers);
  return null;
}

export function daemonReply(choices, index, typed = "") {
  // What picking a row (or typing in its text row) sends: { result } to answer now, or { step, answers } for the next question.
  const d = choices.daemon, o = choices.options[index];
  if (d.method !== INPUT) return o?.decision !== undefined ? { result: { decision: o.decision } } : null;
  const answer = o?.input === "text" ? typed.trim() : o?.answer;
  if (!answer) return null;
  const answers = { ...d.answers, [d.questions[d.step]]: { answers: [answer] } };
  return d.step + 1 < d.questions.length ? { step: d.step + 1, answers } : { result: { answers } };
}
