import { ageDays } from "./format.js";

export function tally(items, keyFn, limit = 8) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item) || "—";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "pt-BR"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export function buildDashboard(snapshot) {
  const repos = snapshot?.repos || [];
  const prs = snapshot?.pullRequests || [];
  const pipelines = snapshot?.pipelines || [];
  const runners = snapshot?.runners || [];
  const ages = prs.map((pr) => ageDays(pr.created_on)).filter((n) => n != null);
  const finished = pipelines.filter((item) => ["SUCCESSFUL", "FAILED", "ERROR", "STOPPED"].includes(item.result));
  const successful = pipelines.filter((item) => item.result === "SUCCESSFUL").length;
  return {
    repos: repos.length,
    repoTotal: snapshot?.repoTotal ?? repos.length,
    repoTruncated: Boolean(snapshot?.repoTruncated),
    privateRepos: repos.filter((repo) => repo.is_private).length,
    projects: (snapshot?.projects || []).length,
    pullRequests: prs.length,
    drafts: prs.filter((pr) => pr.draft).length,
    unapproved: prs.filter((pr) => !pr.approved).length,
    stale: prs.filter((pr) => (ageDays(pr.created_on) ?? 0) >= 7).length,
    withTasks: prs.filter((pr) => pr.task_count > 0).length,
    avgAgeDays: ages.length ? ages.reduce((sum, n) => sum + n, 0) / ages.length : null,
    authors: tally(prs, (pr) => pr.author?.display_name),
    languages: tally(repos, (repo) => repo.language || "sem linguagem"),
    destBranches: tally(prs, (pr) => pr.destination || "—"),
    reposWithPrs: tally(prs, (pr) => pr.repo),
    oldest: [...prs].sort((a, b) => new Date(a.created_on) - new Date(b.created_on)).slice(0, 5),
    pipelineSample: pipelines.length,
    pipelineSuccessRate: finished.length ? Math.round((successful / finished.length) * 100) : null,
    pipelineFailed: pipelines.filter((item) => item.result === "FAILED" || item.result === "ERROR").length,
    pipelineResults: tally(pipelines, (item) => item.result || "UNKNOWN", 6),
    runners: runners.length,
    runnersOnline: runners.filter((runner) => /online/i.test(runner.status || "")).length,
    permissions: tally(snapshot?.permissions || [], (item) => item.permission || "desconhecida", 6)
  };
}

export function filterPullRequests(list, ui) {
  const query = (ui.prQuery || "").trim().toLowerCase();
  return (list || []).filter((pr) => {
    if (ui.prAuthor && pr.author?.display_name !== ui.prAuthor) return false;
    if (ui.prRepo && pr.repo !== ui.prRepo) return false;
    if (ui.prDraft === "draft" && !pr.draft) return false;
    if (ui.prDraft === "ready" && pr.draft) return false;
    if (ui.prReview === "pending" && pr.approved) return false;
    if (ui.prReview === "approved" && !pr.approved) return false;
    if (ui.prReview === "blocked" && !(pr.reviewers || []).some((r) => r.state === "changes_requested")) return false;
    if (!query) return true;
    const haystack = [pr.title, pr.repo, pr.author?.display_name, pr.author?.nickname, pr.source, pr.destination, ...(pr.reviewers || []).map((r) => r.name)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function filterRepos(list, ui) {
  const query = (ui.repoQuery || "").trim().toLowerCase();
  return (list || []).filter((repo) => {
    if (ui.repoLanguage && (repo.language || "sem linguagem") !== ui.repoLanguage) return false;
    if (ui.repoProject && (repo.project?.key || "") !== ui.repoProject) return false;
    if (!query) return true;
    return [repo.name, repo.slug, repo.full_name, repo.description, repo.language, repo.project?.name]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function uniqueOptions(list, keyFn) {
  return [...new Set(list.map(keyFn).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function paginate(list, page, size) {
  const pageSize = [10, 20, 30].includes(Number(size)) ? Number(size) : 10;
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: list.slice((current - 1) * pageSize, current * pageSize), page: current, pages, pageSize, total: list.length };
}
