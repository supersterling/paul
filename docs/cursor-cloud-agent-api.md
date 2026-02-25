# Cursor Cloud Agent API

Tested 2026-02-24. Base URL: `https://api.cursor.com`

## Authentication

Basic Auth — API key as username, empty password.

```bash
curl -u "$CURSOR_API_KEY:" https://api.cursor.com/v0/me
```

Key lives in `.env.local` as `CURSOR_API_KEY`. Generated from the Cursor Dashboard.

## Endpoints

### GET /v0/me

Returns API key metadata.

```json
{
    "apiKeyName": "Default",
    "createdAt": "2026-02-24T23:18:40.500Z",
    "userEmail": "aiden.zepp@superbuilders.school"
}
```

### GET /v0/models

Returns available models.

```json
{
    "models": [
        "composer-1.5",
        "claude-4.6-opus-high-thinking",
        "gpt-5.3-codex-high",
        "gpt-5.2-high"
    ]
}
```

### GET /v0/repositories

Returns all GitHub repos accessible to the account. Rate limited: 1/user/minute, 30/user/hour.

```json
{
    "repositories": [
        {
            "owner": "supersterling",
            "name": "paul",
            "repository": "https://github.com/supersterling/paul"
        }
    ]
}
```

### POST /v0/agents

Launch a coding agent. Returns immediately with status `CREATING`.

**Request:**

```json
{
    "prompt": {
        "text": "Create a file at tmp/test.txt with hello world",
        "images": []
    },
    "source": {
        "repository": "supersterling/paul",
        "ref": "main"
    },
    "target": {
        "autoBranch": true,
        "autoCreatePr": false,
        "branchName": "custom-branch-name",
        "openAsCursorGithubApp": false,
        "skipReviewerRequest": false
    },
    "model": "claude-4.6-opus-high-thinking",
    "webhook": {
        "url": "https://example.com/webhook",
        "secret": "optional-hmac-secret"
    }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `prompt.text` | yes | The task description |
| `prompt.images` | no | Array of image URLs for visual context |
| `source.repository` | yes | `owner/repo` format |
| `source.ref` | no | Branch/tag to start from (defaults to default branch) |
| `source.prUrl` | no | Existing PR URL — agent works on that PR's branch |
| `target.autoBranch` | no | Auto-generate branch name |
| `target.autoCreatePr` | no | Auto-open a PR when done |
| `target.branchName` | no | Custom branch name (ignored if autoBranch) |
| `model` | no | Model to use (see /v0/models) |
| `webhook` | no | POST notification on completion |

**Response:**

```json
{
    "id": "bc-b6ab3316-6e12-4c66-a629-6780ac9f1d02",
    "status": "CREATING",
    "source": {
        "repository": "https://github.com/supersterling/paul",
        "ref": "main"
    },
    "target": {
        "autoBranch": true,
        "branchName": "cursor/cloud-agent-api-test-a82f",
        "url": "https://cursor.com/agents/bc-b6ab3316-6e12-4c66-a629-6780ac9f1d02"
    },
    "name": "Cloud agent API test",
    "createdAt": "2026-02-24T23:21:24.094Z"
}
```

### GET /v0/agents

List agents. Paginated.

| Param | Default | Notes |
|-------|---------|-------|
| `limit` | 20 | Max 100 |
| `cursor` | — | Pagination cursor from `nextCursor` |
| `prUrl` | — | Filter by PR URL |

### GET /v0/agents/{id}

Poll agent status. Status lifecycle: `CREATING` → `RUNNING` → `FINISHED` / `EXPIRED` / `ERROR`.

**Response (finished):**

```json
{
    "id": "bc-b6ab3316-6e12-4c66-a629-6780ac9f1d02",
    "status": "FINISHED",
    "source": {
        "repository": "github.com/supersterling/paul",
        "ref": "main",
        "prUrl": "https://github.com/supersterling/paul/pull/2"
    },
    "target": {
        "branchName": "cursor/cloud-agent-api-test-a82f",
        "prUrl": "https://github.com/supersterling/paul/pull/2",
        "url": "https://cursor.com/agents/bc-b6ab3316-6e12-4c66-a629-6780ac9f1d02"
    },
    "name": "Cloud agent API test",
    "linesAdded": 2,
    "filesChanged": 1
}
```

### GET /v0/agents/{id}/conversation

Full message history between user and agent.

```json
{
    "messages": [
        {
            "id": "d0380bba-...",
            "type": "user_message",
            "text": "Create a file at tmp/cursor-api-test.txt..."
        },
        {
            "id": "cf37322c-...",
            "type": "assistant_message",
            "text": "Done. I created `tmp/cursor-api-test.txt`..."
        }
    ]
}
```

### POST /v0/agents/{id}/followup

Send follow-up instructions to a running or finished agent.

```json
{
    "prompt": {
        "text": "Also add a README explaining the file",
        "images": []
    }
}
```

### POST /v0/agents/{id}/stop

Stop a running agent. Returns `{ "id": "bc-..." }`.

### DELETE /v0/agents/{id}

Delete an agent record. Returns `{ "id": "bc-..." }`.

## Verified Behavior

Tested by launching an agent on `supersterling/paul`:

- Agent cloned repo, created file, committed, pushed to auto-named branch, opened PR
- Total time from launch to `FINISHED`: ~10 seconds
- PR: https://github.com/supersterling/paul/pull/2
- Agent auto-generated branch name: `cursor/cloud-agent-api-test-a82f`
- Agent auto-generated a descriptive PR title and body
