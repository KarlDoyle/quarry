import { readFileSync } from "node:fs";
import { fetchJson } from "./http.js";

export interface Ticket {
  key: string;
  summary: string;
  description: string;
  status: string;
  type: string;
  priority: string;
}

/** Flatten Atlassian Document Format (or pass through a plain string) to text. */
function descToText(d: unknown): string {
  if (typeof d === "string") return d;
  if (!d || typeof d !== "object") return "";
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (typeof n.text === "string") out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(d);
  return out.join(" ").trim();
}

export function parseJiraIssue(raw: any): Ticket {
  const f = raw?.fields ?? {};
  return {
    key: raw?.key ?? "",
    summary: f.summary ?? "",
    description: descToText(f.description),
    status: f.status?.name ?? "",
    type: f.issuetype?.name ?? "",
    priority: f.priority?.name ?? "",
  };
}

/** Load a ticket from a saved Jira `GET issue` JSON — used for offline demos/tests. */
export function loadJiraFixture(path: string): Ticket {
  return parseJiraIssue(JSON.parse(readFileSync(path, "utf-8")));
}

/** Thin live Jira client (Basic auth). Only `getIssue` is needed for analysis. */
export class JiraClient {
  constructor(
    private baseUrl: string,
    private email: string,
    private token: string,
  ) {}

  async getIssue(key: string): Promise<Ticket> {
    const auth = Buffer.from(`${this.email}:${this.token}`).toString("base64");
    const raw = await fetchJson(
      `${this.baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      },
    );
    return parseJiraIssue(raw);
  }
}
