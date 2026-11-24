import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContextTree, filterContext, findNode, leavesOf, selectedContextText } from "../models/context-tree.js";

const data = {
  updated_at: "2026-11-24",
  summary: { pull_requests_total: 3, pull_requests_by_author: { Ana: 2, Juliano: 1 } },
  pull_requests: [
    { id: 1, title: "A", author: "Ana", reviewers: [{ name: "Maria", approved: true }] },
    { id: 2, title: "B", author: "Juliano", reviewers: [] }
  ],
  runners: [{ name: "r1", labels: ["linux"] }],
  pipelines: [],
  warnings: {}
};
const tree = buildContextTree(data);
const paths = tree.flatMap(leavesOf);

test("arrays become field groups, nested arrays expand, dynamic maps stay as one leaf", () => {
  assert.deepEqual(findNode(tree, "pull_requests").children.map((child) => child.key), ["id", "title", "author", "reviewers"]);
  assert.equal(findNode(tree, "pull_requests").count, 2);
  assert.deepEqual(findNode(tree, "pull_requests.reviewers").children.map((child) => child.key), ["name", "approved"]);
  assert.ok(paths.includes("summary.pull_requests_by_author"));
  assert.ok(!paths.some((path) => path.startsWith("summary.pull_requests_by_author.")));
  assert.ok(paths.includes("runners.labels"), "primitive arrays are leaves");
  assert.ok(paths.includes("pipelines") && paths.includes("warnings"), "empty values are leaves");
  assert.equal(findNode(tree, "pull_requests.title").sample, "A");
  assert.equal(findNode(tree, "nope.x"), null);
});

test("with nothing excluded the filtered context equals the original", () => {
  assert.deepEqual(filterContext(data, tree, new Set()), data);
});

test("unchecking a leaf removes that field from every item", () => {
  const out = filterContext(data, tree, new Set(["pull_requests.author", "summary.pull_requests_total"]));
  assert.deepEqual(out.pull_requests.map((pr) => Object.keys(pr)), [["id", "title", "reviewers"], ["id", "title", "reviewers"]]);
  assert.deepEqual(Object.keys(out.summary), ["pull_requests_by_author"]);
  assert.equal(out.pull_requests[0].reviewers[0].name, "Maria");
});

test("unchecking every leaf of a group drops the whole group, even a nested one", () => {
  const noReviewers = filterContext(data, tree, new Set(leavesOf(findNode(tree, "pull_requests.reviewers"))));
  assert.ok(noReviewers.pull_requests.every((pr) => !("reviewers" in pr)));
  const noPullRequests = filterContext(data, tree, new Set(leavesOf(findNode(tree, "pull_requests"))));
  assert.ok(!("pull_requests" in noPullRequests));
  assert.ok("runners" in noPullRequests);
});

test("selectedContextText is empty when nothing is selected and ignores stale exclusions", () => {
  assert.equal(selectedContextText(data, new Set(paths)), "");
  assert.equal(selectedContextText(null, new Set()), "");
  assert.deepEqual(JSON.parse(selectedContextText(data, new Set(["removed.field"]))), data);
});

const combined = {
  bitbucket: { summary: { total: 3, by_author: { Ana: 2 } }, pull_requests: [{ id: 1, author: "Ana" }] },
  jira: { summary: { total: 5 }, issues: [{ key: "ABC-1", assignee: "Juliano" }, { key: "ABC-2", assignee: "" }] }
};
const groups = { grouped: true };

test("grouped mode makes one group per source and keeps per-source field rules", () => {
  const tree = buildContextTree(combined, groups);
  assert.deepEqual(tree.map((node) => node.key), ["bitbucket", "jira"]);
  assert.deepEqual(findNode(tree, "jira").children.map((node) => node.key), ["summary", "issues"]);
  assert.deepEqual(findNode(tree, "jira.summary").children.map((node) => node.key), ["total"]);
  assert.ok(leavesOf(findNode(tree, "bitbucket.summary")).includes("bitbucket.summary.by_author"), "dynamic maps stay one leaf");
  assert.equal(findNode(tree, "jira.issues").count, 2);
  assert.deepEqual(JSON.parse(selectedContextText(combined, new Set(), groups)), combined);
});

test("unchecking a whole source or one of its fields only affects that source", () => {
  const tree = buildContextTree(combined, groups);
  const noJira = JSON.parse(selectedContextText(combined, new Set(leavesOf(findNode(tree, "jira"))), groups));
  assert.deepEqual(Object.keys(noJira), ["bitbucket"]);
  const noAssignee = JSON.parse(selectedContextText(combined, new Set(["jira.issues.assignee"]), groups));
  assert.deepEqual(noAssignee.jira.issues, [{ key: "ABC-1" }, { key: "ABC-2" }]);
  assert.deepEqual(noAssignee.bitbucket, combined.bitbucket);
  assert.equal(selectedContextText(combined, new Set(tree.flatMap(leavesOf)), groups), "");
});
