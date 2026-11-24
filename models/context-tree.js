// Field tree for the Bitbucket context. Arrays are described by the union of their items' fields,
// so unchecking a leaf such as "pull_requests.author" removes that field from every item.
const SKIP = Symbol("skip");
const MAX_SAMPLE = 32;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function sampleOf(values) {
  const value = values.find((item) => item !== undefined && item !== null && item !== "") ?? values[0];
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length > MAX_SAMPLE ? `${text.slice(0, MAX_SAMPLE - 1)}…` : text;
}

function describe(key, values, path, depth) {
  let sawArray = false;
  const items = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      sawArray = true;
      items.push(...value);
    } else {
      items.push(value);
    }
  }
  const objects = items.filter(isObject);
  const keys = [...new Set(objects.flatMap((item) => Object.keys(item)))];
  const expandable = objects.length > 0 && objects.length === items.length && keys.length > 0 && (sawArray || depth <= 1);
  if (!expandable) return { key, path, sample: sampleOf(values) };
  return {
    key,
    path,
    count: sawArray ? items.length : undefined,
    children: keys.map((child) => describe(child, objects.map((item) => item[child]).filter((value) => value !== undefined), `${path}.${child}`, depth + 1))
  };
}

// With { grouped: true } every top-level object (e.g. "bitbucket", "jira") becomes a group of its own.
export function buildContextTree(data, { grouped = false } = {}) {
  if (!isObject(data)) return [];
  return Object.keys(data).map((key) => {
    const value = data[key];
    if (grouped && isObject(value) && Object.keys(value).length) {
      return { key, path: key, children: Object.keys(value).map((child) => describe(child, [value[child]], `${key}.${child}`, 1)) };
    }
    return describe(key, [value], key, 1);
  });
}

export function leavesOf(node) {
  return node.children ? node.children.flatMap(leavesOf) : [node.path];
}

export function findNode(tree, path) {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.children && path.startsWith(`${node.path}.`)) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function apply(value, node, excluded) {
  if (!leavesOf(node).some((path) => !excluded.has(path))) return SKIP;
  if (!node.children) return value;
  if (Array.isArray(value)) return value.map((item) => (isObject(item) ? pickFields(item, node, excluded) : item));
  return isObject(value) ? pickFields(value, node, excluded) : value;
}

function pickFields(item, node, excluded) {
  const out = {};
  for (const child of node.children) {
    if (!(child.key in item)) continue;
    const result = apply(item[child.key], child, excluded);
    if (result !== SKIP) out[child.key] = result;
  }
  return out;
}

export function filterContext(data, tree, excluded) {
  const out = {};
  for (const node of tree) {
    if (!(node.key in data)) continue;
    const result = apply(data[node.key], node, excluded);
    if (result !== SKIP) out[node.key] = result;
  }
  return out;
}

export function selectedContextText(data, excluded, options) {
  if (!isObject(data)) return "";
  const filtered = filterContext(data, buildContextTree(data, options), excluded);
  return Object.keys(filtered).length ? JSON.stringify(filtered, null, 2) : "";
}
