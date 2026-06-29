import { readFileSync } from "node:fs";
import { fetchJson } from "./http.js";

export interface RepoInfo {
  fullName: string;
  description: string;
  language: string;
  defaultBranch: string;
}

export function parseRepo(raw: any): RepoInfo {
  return {
    fullName: raw?.full_name ?? "",
    description: raw?.description ?? "",
    language: raw?.language ?? "",
    defaultBranch: raw?.default_branch ?? "",
  };
}

/** Load repo metadata from a saved GitHub `GET repo` JSON — for offline demos/tests. */
export function loadRepoFixture(path: string): RepoInfo {
  return parseRepo(JSON.parse(readFileSync(path, "utf-8")));
}

/** Thin live GitHub client. Optional repo context for ticket analysis. */
export class GitHubClient {
  constructor(private token?: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    return parseRepo(
      await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: this.headers(),
      }),
    );
  }
}
