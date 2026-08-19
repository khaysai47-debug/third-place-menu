// Lessons: the small, machine-readable guardrail layer.
//
// Ten lines of hard-won "do not do that again", loaded at task start, filtered
// to what the task can actually trip over, and handed to the workers in their
// prompts. Deliberately NOT a knowledge base — no embeddings, no graph, no
// second system to maintain. A JSON list with tags is enough to stop the same
// mistake twice, and anything bigger stops being read.
//
// Nothing here is written automatically. A lesson entering the file is a human
// decision, because the agent editing its own guardrails during a task is the
// exact thing AGENTS.md forbids.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "./runstore.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LESSONS_FILE = path.join(HERE, "lessons.json");

/** Lessons that apply to every task regardless of subject. */
const UNIVERSAL_TAG = "always";

export function loadLessons(file = LESSONS_FILE) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed.lessons) ? parsed.lessons : [];
  } catch {
    // A missing or broken lessons file must never stop a task; it degrades to
    // "no lessons", which is where V1 already was.
    return [];
  }
}

/** Everything the task says about itself, lowercased, for tag matching. */
const searchText = (task) =>
  [
    task?.goal,
    task?.title,
    task?.objective,
    task?.context,
    ...(task?.allowedPaths ?? []),
    ...(task?.acceptanceCriteria ?? []),
    ...(task?.systems ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

/**
 * Lessons worth showing this task, most relevant first.
 *
 * Universal lessons always come along; the rest have to earn their place by
 * matching a tag or a system the task actually involves.
 */
export function relevantLessons(task, { file = LESSONS_FILE, limit = 8, lessons } = {}) {
  const all = lessons ?? loadLessons(file);
  const text = searchText(task);
  const systems = new Set((task?.systems ?? []).map((s) => String(s).toLowerCase()));

  const scored = all.map((lesson) => {
    const tags = lesson.tags ?? [];
    let score = tags.includes(UNIVERSAL_TAG) ? 10 : 0;
    for (const tag of tags) if (tag !== UNIVERSAL_TAG && text.includes(tag)) score += 2;
    for (const system of lesson.systems ?? []) if (systems.has(system)) score += 3;
    return { lesson, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id))
    .slice(0, limit)
    .map((entry) => entry.lesson);
}

/** Free-text/tag search, for a human asking "what do we know about n8n?". */
export function searchLessons(query, { file = LESSONS_FILE, lessons } = {}) {
  const needle = String(query ?? "").toLowerCase();
  if (!needle) return [];
  return (lessons ?? loadLessons(file)).filter(
    (lesson) =>
      lesson.id.toLowerCase() === needle ||
      lesson.lesson.toLowerCase().includes(needle) ||
      (lesson.tags ?? []).some((tag) => tag.toLowerCase() === needle) ||
      (lesson.systems ?? []).some((system) => system.toLowerCase() === needle),
  );
}

/**
 * Add a lesson. Explicit, human-initiated, never called from the loop.
 *
 * @returns {{ added: boolean, lessons: object[] }}
 */
export function addLesson(lesson, { file = LESSONS_FILE } = {}) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed.lessons.some((existing) => existing.id === lesson.id)) {
    return { added: false, lessons: parsed.lessons };
  }
  parsed.lessons.push(lesson);
  writeAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return { added: true, lessons: parsed.lessons };
}
