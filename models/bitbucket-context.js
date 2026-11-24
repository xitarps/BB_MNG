function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item) || "desconhecido";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Whitelist of non-secret fields: no tokens, avatars, UUIDs, clone links or PR descriptions.
export function buildBitbucketContext(snapshot) {
  if (!snapshot) return null;
  const pullRequests = (snapshot.pullRequests || []).map((pr) => ({
    repo: pr.repo,
    id: pr.id,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    author: pr.author?.display_name || "",
    author_nickname: pr.author?.nickname || "",
    created_on: pr.created_on,
    updated_on: pr.updated_on,
    comment_count: pr.comment_count,
    task_count: pr.task_count,
    source_branch: pr.source,
    destination_branch: pr.destination,
    reviewers_loaded: Boolean(pr.reviewersLoaded),
    reviewers: (pr.reviewers || []).map((reviewer) => ({ name: reviewer.name, approved: reviewer.approved, state: reviewer.state })),
    url: pr.html
  }));
  const repos = snapshot.repos || [];
  return {
    notes: [
      "Dados do Bitbucket em cache local do painel Crizsopha; podem estar desatualizados.",
      `Só inclui pull requests no estado ${snapshot.prState || "OPEN"}.`,
      "É uma amostra: o número de repositórios e de pull requests lidos é limitado (veja sample)."
    ],
    updated_at: snapshot.fetchedAt || "",
    workspace: snapshot.workspace || "",
    queried_by: snapshot.user ? { display_name: snapshot.user.display_name, nickname: snapshot.user.nickname } : null,
    sample: { repos_listed: repos.length, repos_total: snapshot.repoTotal ?? repos.length, repos_truncated: Boolean(snapshot.repoTruncated) },
    summary: {
      pull_requests_total: pullRequests.length,
      pull_requests_by_author: countBy(pullRequests, (pr) => pr.author),
      pull_requests_by_repo: countBy(pullRequests, (pr) => pr.repo)
    },
    warnings: snapshot.sectionErrors || {},
    projects: (snapshot.projects || []).map((project) => ({ key: project.key, name: project.name, is_private: project.is_private })),
    repositories: repos.map((repo) => ({
      full_name: repo.full_name,
      name: repo.name,
      language: repo.language,
      is_private: repo.is_private,
      main_branch: repo.mainbranch,
      project_key: repo.project?.key || "",
      size_bytes: repo.size,
      updated_on: repo.updated_on
    })),
    pull_requests: pullRequests,
    pipelines: (snapshot.pipelines || []).map((pipeline) => ({
      repo: pipeline.repo,
      build: pipeline.build,
      result: pipeline.result,
      branch: pipeline.branch,
      creator: pipeline.creator,
      created_on: pipeline.created_on,
      completed_on: pipeline.completed_on
    })),
    runners: (snapshot.runners || []).map((runner) => ({ name: runner.name, status: runner.status, labels: runner.labels })),
    permissions: (snapshot.permissions || []).map((item) => ({ repo: item.full_name, permission: item.permission }))
  };
}

export function serializeBitbucketContext(snapshot) {
  const context = buildBitbucketContext(snapshot);
  return context ? JSON.stringify(context, null, 2) : "";
}
