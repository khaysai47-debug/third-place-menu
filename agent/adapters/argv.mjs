// Structured argv parsing for adapter safety checks.
//
// WHY THIS EXISTS
//
//   The first safety check joined argv into one string and substring-matched it
//   for forbidden flags. The Builder prompt is itself an argv element, and the
//   prompt embeds AGENTS.md, which documents "--dangerously-skip-permissions is
//   never used". So the guard matched its own documentation and refused a
//   perfectly safe command.
//
//   The same shape had a worse failure mode on the Reviewer: it asserted the
//   joined string CONTAINED "read-only", which the reviewed diff could satisfy
//   on its own — a dangerous sandbox would have passed. A false negative in a
//   safety check is far more serious than a false positive.
//
//   So: never inspect argv as text. Parse it into flags and values, and check
//   the flags. Prompt content is a VALUE and is never treated as a flag.

/**
 * Parse an argv array into flags and positionals.
 *
 * `valueFlags` names the flags whose NEXT token is their value. Those values —
 * prompts, paths, session ids — are consumed and never examined as flags, which
 * is precisely what stops prompt text from being read as configuration.
 *
 * `--flag=value` is also understood.
 *
 * @param {string[]} args
 * @param {Set<string>} valueFlags
 * @returns {{ flags: Map<string, string|true>, positional: string[] }}
 */
export function parseArgv(args, valueFlags = new Set()) {
  const flags = new Map();
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (typeof token !== "string" || !token.startsWith("-") || token === "-" || token === "--") {
      positional.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    if (eq !== -1) {
      flags.set(token.slice(0, eq), token.slice(eq + 1));
      continue;
    }

    if (valueFlags.has(token)) {
      // Consume the next token as this flag's value. It is data, not config.
      flags.set(token, args[i + 1]);
      i += 1;
      continue;
    }

    flags.set(token, true);
  }

  return { flags, positional };
}

/** The flag tokens actually present, ignoring every value. */
export const flagNames = (parsed) => [...parsed.flags.keys()];

/**
 * A human-readable command for the run record, with bulky argv tokens replaced
 * by their length.
 *
 * Prompts carry the whole task, project memory and the diff. Writing them into
 * every round's log would bloat the record and copy task context into a second
 * place for no benefit — the prompt is already reproducible from the task. The
 * flags, which are what a reviewer actually needs to audit, stay verbatim.
 */
export function redactCommand(command, args, { maxToken = 200 } = {}) {
  const shown = args.map((token) =>
    typeof token === "string" && token.length > maxToken
      ? `<redacted:${token.length} chars>`
      : token,
  );
  return `${command} ${shown.join(" ")}`;
}

/**
 * An error the engine can recognise and turn into a controlled run status
 * instead of an uncaught stack trace.
 */
export class AdapterConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdapterConfigurationError";
    this.category = "adapter_configuration";
  }
}
