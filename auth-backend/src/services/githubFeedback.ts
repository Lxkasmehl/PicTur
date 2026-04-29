/**
 * Create GitHub issues from the in-app feedback form (server-side token only).
 * Optional: add the issue to a GitHub Project (v2) and set Status to Backlog via GraphQL.
 */

const GITHUB_REST = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

export interface CreatedIssue {
  number: number;
  html_url: string;
  node_id: string;
}

function parseRepo(full: string): { owner: string; repo: string } | null {
  const t = full.trim();
  const m = /^([^/]+)\/([^/]+)$/.exec(t);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Strip BOM / zero-width chars often pasted from browsers or docs. */
function stripEnvNoise(s: string): string {
  return s
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export interface GithubFeedbackConfig {
  token: string;
  owner: string;
  repo: string;
  labels: string[];
  projectNodeId: string | null;
  /** Single-select field name to match (default Status). */
  projectStatusFieldName: string;
  /** Option name within that field (default Backlog). */
  projectBacklogOptionName: string;
}

export function getGithubFeedbackConfig(): GithubFeedbackConfig | null {
  const token = (process.env.GITHUB_FEEDBACK_TOKEN || '').trim();
  const repoFull = (process.env.GITHUB_FEEDBACK_REPOSITORY || '').trim();
  if (!token || !repoFull) return null;

  const parsed = parseRepo(repoFull);
  if (!parsed) return null;

  const labelsRaw = (process.env.GITHUB_FEEDBACK_LABELS || 'user-feedback').trim();
  const labels = labelsRaw
    ? labelsRaw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : ['user-feedback'];

  const projectNodeId = stripEnvNoise(process.env.GITHUB_FEEDBACK_PROJECT_NODE_ID || '') || null;
  const projectStatusFieldName =
    stripEnvNoise(process.env.GITHUB_FEEDBACK_PROJECT_STATUS_FIELD || 'Status') || 'Status';
  const projectBacklogOptionName =
    stripEnvNoise(process.env.GITHUB_FEEDBACK_PROJECT_BACKLOG_OPTION || 'Backlog') || 'Backlog';

  return {
    token,
    owner: parsed.owner,
    repo: parsed.repo,
    labels,
    projectNodeId,
    projectStatusFieldName,
    projectBacklogOptionName,
  };
}

async function githubGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const rawText = await res.text();
  let json: { data?: T; errors?: { message: string }[] };
  try {
    json = JSON.parse(rawText) as { data?: T; errors?: { message: string }[] };
  } catch {
    throw new Error(`GitHub GraphQL: non-JSON response (${res.status}): ${rawText.slice(0, 500)}`);
  }

  if (!res.ok) {
    console.error('GitHub GraphQL HTTP error body:', rawText.slice(0, 2000));
    throw new Error(`GitHub GraphQL HTTP ${res.status}`);
  }
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    console.error('GitHub GraphQL errors:', msg);
    throw new Error(msg);
  }
  if (json.data === undefined || json.data === null) {
    throw new Error('GitHub GraphQL returned no data');
  }
  return json.data;
}

export async function createGithubIssue(params: {
  token: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
}): Promise<CreatedIssue> {
  const { token, owner, repo, title, body, labels } = params;
  const res = await fetch(`${GITHUB_REST}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels }),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const msg =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : `GitHub API ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; details?: unknown };
    err.status = res.status;
    err.details = data;
    throw err;
  }

  const number = typeof data.number === 'number' ? data.number : NaN;
  const html_url = typeof data.html_url === 'string' ? data.html_url : '';
  const node_id = typeof data.node_id === 'string' ? data.node_id : '';
  if (!Number.isFinite(number) || !html_url || !node_id) {
    throw new Error('Unexpected GitHub issue response');
  }
  return { number, html_url, node_id };
}

type AddItemData = {
  addProjectV2ItemById?: { item?: { id: string } | null } | null;
};

/**
 * Adds an existing issue to a GitHub Project (v2). Requires classic PAT scope `project`
 * (or fine-grained “Projects” read/write where applicable).
 */
export async function addIssueToProjectV2(params: {
  token: string;
  projectNodeId: string;
  contentNodeId: string;
}): Promise<{ projectItemId: string }> {
  const gql = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `;
  const data = await githubGraphql<AddItemData>(params.token, gql, {
    projectId: params.projectNodeId,
    contentId: params.contentNodeId,
  });
  const id = data?.addProjectV2ItemById?.item?.id;
  if (!id) {
    throw new Error('Project add mutation returned no item id');
  }
  return { projectItemId: id };
}

type ProjectFieldsData = {
  node?: {
    fields?: {
      nodes?: (
        | { __typename: string }
        | {
            __typename: 'ProjectV2SingleSelectField';
            id: string;
            name: string;
            options: { id: string; name: string }[];
          }
      )[];
    };
  };
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function splitCsv(s: string): string[] {
  return stripEnvNoise(s)
    .split(/[,;]/)
    .map((x) => stripEnvNoise(x))
    .filter(Boolean);
}

/**
 * Resolves a single-select project field and option (e.g. Status → Backlog) for Project v2.
 * `statusFieldName` / `backlogOptionName` may contain several comma- or semicolon-separated
 * candidates; the first matching field and first matching option win (e.g. `Status` / `Backlog,Todo`).
 */
export async function resolveProjectStatusBacklogIds(params: {
  token: string;
  projectNodeId: string;
  statusFieldName: string;
  backlogOptionName: string;
}): Promise<{ fieldId: string; optionId: string } | null> {
  const fieldNameCandidates = splitCsv(params.statusFieldName);
  const optionNameCandidates = splitCsv(params.backlogOptionName);
  if (fieldNameCandidates.length === 0) fieldNameCandidates.push('Status');
  if (optionNameCandidates.length === 0) optionNameCandidates.push('Backlog');

  const gql = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 100) {
            nodes {
              __typename
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await githubGraphql<ProjectFieldsData>(params.token, gql, {
    projectId: params.projectNodeId,
  });

  const projectNode = data?.node;
  if (!projectNode) {
    console.warn(
      'GitHub project: GraphQL node(id) is null — check GITHUB_FEEDBACK_PROJECT_NODE_ID and token access to that project.',
    );
    return null;
  }

  const nodes = projectNode.fields?.nodes;
  if (!nodes?.length) {
    console.warn('GitHub project: no fields returned for this project (empty fields list).');
    return null;
  }

  const selectFields = nodes.filter(
    (n): n is { __typename: 'ProjectV2SingleSelectField'; id: string; name: string; options: { id: string; name: string }[] } =>
      n != null && n.__typename === 'ProjectV2SingleSelectField',
  );

  for (const wantField of fieldNameCandidates.map(norm)) {
    for (const field of selectFields) {
      if (norm(field.name) !== wantField) continue;

      for (const wantOpt of optionNameCandidates.map(norm)) {
        const opt = field.options.find((o) => norm(o.name) === wantOpt);
        if (opt) {
          return { fieldId: field.id, optionId: opt.id };
        }
      }

      console.warn(
        `GitHub project: field "${field.name}" found but no option matching any of: ${optionNameCandidates.join(', ')}. Options on this field: ${field.options.map((o) => o.name).join(', ') || '(none)'}`,
      );
      return null;
    }
  }

  const fieldNames = selectFields.map((x) => x.name);
  console.warn(
    `GitHub project: no single-select field matching any of: ${fieldNameCandidates.join(', ')}. Single-select fields on this project: ${fieldNames.join(', ') || '(none)'}`,
  );
  return null;
}

type UpdateFieldData = {
  updateProjectV2ItemFieldValue?: { projectV2Item?: { id: string } | null } | null;
};

export async function setProjectItemSingleSelect(params: {
  token: string;
  projectNodeId: string;
  projectItemId: string;
  fieldId: string;
  singleSelectOptionId: string;
}): Promise<void> {
  const gql = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) {
        projectV2Item { id }
      }
    }
  `;
  const data = await githubGraphql<UpdateFieldData>(params.token, gql, {
    projectId: params.projectNodeId,
    itemId: params.projectItemId,
    fieldId: params.fieldId,
    optionId: params.singleSelectOptionId,
  });
  if (!data?.updateProjectV2ItemFieldValue?.projectV2Item?.id) {
    throw new Error('updateProjectV2ItemFieldValue returned no item');
  }
}
