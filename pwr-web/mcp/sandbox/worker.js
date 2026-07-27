// Worker thread for the MCP Code Mode sandbox.
// The host transpiles user TS to JS and ships it here as the body of an async
// function that receives `{ pwr, console }`. All `pwr.<ns>.<method>(args)` calls
// are RPC'd back to the host over the parent port — the worker has no DB handle.

const { parentPort } = require("node:worker_threads");

if (!parentPort) {
  throw new Error("worker.js must be spawned via worker_threads");
}

let nextId = 1;
const pending = new Map();
let stdout = [];
let stderr = [];

function format(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function call(method, args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ type: "call", id, method, args });
  });
}

const NAMESPACES = ["wrestlers", "books", "territories", "pendingWrestlers", "dedup", "audit"];
const pwr = {};
for (const ns of NAMESPACES) {
  pwr[ns] = new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method !== "string") return undefined;
        return (...args) => call(`${ns}.${method}`, args);
      },
    },
  );
}

const consoleProxy = {
  log: (...args) => stdout.push(args.map(format).join(" ")),
  info: (...args) => stdout.push(args.map(format).join(" ")),
  warn: (...args) => stderr.push(args.map(format).join(" ")),
  error: (...args) => stderr.push(args.map(format).join(" ")),
  debug: (...args) => stdout.push(args.map(format).join(" ")),
};

parentPort.on("message", async (msg) => {
  if (msg && msg.type === "result") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p.resolve(msg.value);
    }
    return;
  }
  if (msg && msg.type === "error") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
    return;
  }
  if (msg && msg.type === "ready") {
    stdout = [];
    stderr = [];
    try {
      // The host already wrapped the user code as `(async (pwr, console) => { ... })`.
      // We just need to invoke that expression with our injected pwr/console.
      // eslint-disable-next-line no-new-func
      const fn = new Function("pwr", "console", `return (${msg.code})(pwr, console);`);
      const returnValue = await fn(pwr, consoleProxy);
      parentPort.postMessage({
        type: "done",
        returnValue,
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
      });
    } catch (err) {
      parentPort.postMessage({
        type: "throw",
        message: err?.message ? String(err.message) : String(err),
        stack: err?.stack ? String(err.stack) : undefined,
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
      });
    }
  }
});
