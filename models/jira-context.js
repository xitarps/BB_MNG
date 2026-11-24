import { tally } from "./metrics.js";
import { ageDays } from "./format.js";

export const isOpenIssue = (issue) => issue.status_category !== "done";

export function isOverdue(issue, now = Date.now()) {
  if (!issue.due || !isOpenIssue(issue)) return false;
  const due = new Date(`${issue.due}T23:59:59`).getTime();
  return !Number.isNaN(due) && due < now;
}

export function buildJiraDashboard(snapshot, now = Date.now()) {
  const issues = snapshot?.issues || [];
  const open = issues.filter(isOpenIssue);
  const ages = open.map((issue) => ageDays(issue.created, now)).filter((n) => n != null);
  return {
    issues: issues.length,
    open: open.length,
    inProgress: issues.filter((issue) => issue.status_category === "indeterminate").length,
    done: issues.length - open.length,
    overdue: open.filter((issue) => isOverdue(issue, now)).length,
    unassigned: open.filter((issue) => !issue.assignee).length,
    stale: open.filter((issue) => (ageDays(issue.updated, now) ?? 0) >= 30).length,
    avgAgeDays: ages.length ? ages.reduce((sum, n) => sum + n, 0) / ages.length : null,
    projects: (snapshot?.projects || []).length,
    byStatus: tally(issues, (issue) => issue.status, 10),
    byAssignee: tally(open, (issue) => issue.assignee || "Sem responsável", 10),
    byType: tally(issues, (issue) => issue.type, 8),
    byPriority: tally(issues, (issue) => issue.priority || "sem prioridade", 8),
    byProject: tally(issues, (issue) => issue.project, 10),
    oldestOpen: [...open].sort((a, b) => new Date(a.created) - new Date(b.created)).slice(0, 5)
  };
}

export function filterJiraIssues(list, ui) {
  const query = (ui.jiraQuery || "").trim().toLowerCase();
  return (list || []).filter((issue) => {
    if (ui.jiraScope !== "all" && !isOpenIssue(issue)) return false;
    if (ui.jiraProject && issue.project !== ui.jiraProject) return false;
    if (ui.jiraStatus && issue.status !== ui.jiraStatus) return false;
    if (ui.jiraType && issue.type !== ui.jiraType) return false;
    if (ui.jiraAssignee === "__none__" ? Boolean(issue.assignee) : ui.jiraAssignee && issue.assignee !== ui.jiraAssignee) return false;
    if (!query) return true;
    return [issue.key, issue.summary, issue.assignee, issue.reporter, issue.status, issue.type, ...(issue.labels || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

// Whitelist of non-secret fields, mirroring the Bitbucket context.
export function buildJiraContext(snapshot) {
  if (!snapshot) return null;
  const issues = snapshot.issues || [];
  const open = issues.filter(isOpenIssue);
  return {
    notes: [
      "Dados do Jira em cache local do painel Crizsopha; podem estar desatualizados.",
      `Só inclui as issues retornadas pela consulta (JQL): ${snapshot.jql || "não informada"}.`,
      "É uma amostra limitada: veja sample.truncated."
    ],
    updated_at: snapshot.fetchedAt || "",
    site: snapshot.site || "",
    queried_by: snapshot.user ? { display_name: snapshot.user.display_name } : null,
    sample: { issues_listed: issues.length, truncated: Boolean(snapshot.truncated) },
    summary: {
      issues_total: issues.length,
      issues_open: open.length,
      issues_by_status: Object.fromEntries(tally(issues, (issue) => issue.status, 50).map((item) => [item.label, item.count])),
      open_issues_by_assignee: Object.fromEntries(tally(open, (issue) => issue.assignee || "Sem responsável", 100).map((item) => [item.label, item.count])),
      issues_by_project: Object.fromEntries(tally(issues, (issue) => issue.project, 100).map((item) => [item.label, item.count]))
    },
    warnings: snapshot.sectionErrors || {},
    projects: (snapshot.projects || []).map((project) => ({ key: project.key, name: project.name, type: project.type, lead: project.lead, is_private: project.is_private })),
    issues: issues.map((issue) => ({
      key: issue.key,
      summary: issue.summary,
      project: issue.project,
      type: issue.type,
      status: issue.status,
      status_category: issue.status_category,
      priority: issue.priority,
      assignee: issue.assignee,
      reporter: issue.reporter,
      labels: issue.labels,
      created: issue.created,
      updated: issue.updated,
      due: issue.due,
      resolved: issue.resolved,
      url: issue.url
    }))
  };
}

export function serializeJiraContext(snapshot) {
  const context = buildJiraContext(snapshot);
  return context ? JSON.stringify(context, null, 2) : "";
}
