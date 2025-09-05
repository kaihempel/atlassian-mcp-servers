# Jira REST API v3 Search Endpoint Documentation

## Overview
The Jira REST API v3 provides powerful search capabilities for querying issues using JQL (Jira Query Language). This document covers the search endpoints available in API v3.

## Main Search Endpoints

### 1. GET /rest/api/3/search
Search for issues using JQL via GET request. Best for simple queries that fit within URL length limits.

**Base URL Pattern:**
```
https://{instance}.atlassian.net/rest/api/3/search
```

### 2. POST /rest/api/3/search
Search for issues using JQL via POST request. Use this when:
- Your JQL query is too large for URL parameters
- You need to specify complex field selections
- You want to use request body for better structure

## Parameters

### GET Request Parameters

| Parameter | Type | Description | Default | Example |
|-----------|------|-------------|---------|---------|
| `jql` | string | The JQL query string | - | `project = ABC AND status = "In Progress"` |
| `startAt` | integer | The index of the first item to return in results | 0 | 0 |
| `maxResults` | integer | Maximum number of results to return (max: 100) | 50 | 50 |
| `fields` | string | Comma-separated list of fields to return | All navigable fields | `id,key,summary,status` |
| `expand` | string | Additional data to include in response | - | `names,schema,operations` |
| `validateQuery` | string | Whether to validate the JQL query | strict | `strict`, `warn`, `none` |
| `fieldsByKeys` | boolean | Reference fields by keys instead of IDs | false | false |
| `properties` | string | List of issue properties to return | - | `*all`, `-prop1` |

### POST Request Body Structure

```json
{
  "jql": "project = HSP ORDER BY created DESC",
  "startAt": 0,
  "maxResults": 50,
  "fields": [
    "id",
    "key",
    "summary",
    "status",
    "assignee",
    "priority",
    "created",
    "updated",
    "duedate"
  ],
  "expand": [
    "names",
    "schema",
    "operations"
  ],
  "fieldsByKeys": false
}
```

### Alternative Pagination (POST only)

Instead of `startAt`, you can use:
- `nextPageToken` - Token for the next page of results (returned in previous response)

## Response Structure

### Successful Response (200 OK)

```json
{
  "expand": "schema,names",
  "startAt": 0,
  "maxResults": 50,
  "total": 234,
  "issues": [
    {
      "id": "10002",
      "key": "ABC-1",
      "self": "https://instance.atlassian.net/rest/api/3/issue/10002",
      "fields": {
        "summary": "Issue summary text",
        "status": {
          "name": "In Progress",
          "id": "3",
          "statusCategory": {
            "id": 4,
            "key": "indeterminate",
            "name": "In Progress"
          }
        },
        "assignee": {
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "displayName": "John Doe",
          "emailAddress": "john.doe@example.com"
        },
        "priority": {
          "id": "3",
          "name": "Medium"
        },
        "created": "2024-01-15T10:30:00.000+0000",
        "updated": "2024-01-20T14:45:00.000+0000",
        "duedate": "2024-02-01"
      }
    }
  ],
  "warningMessages": [],
  "names": {
    "status": "Status",
    "summary": "Summary"
  },
  "schema": {}
}
```

## Important Limitations

### MaxResults Constraints
- **Maximum value**: 100 issues per request
- **Default value**: 50 if not specified
- Even if you specify more than 100, only 100 will be returned

### JQL Query Length
- GET requests: Limited by URL length (typically ~2000 characters)
- POST requests: No practical limit on JQL length

### Rate Limiting
- Subject to Atlassian's API rate limits
- Varies by plan and usage patterns

## Example Requests

### Example 1: Basic GET Search
```bash
curl -X GET \
  'https://your-domain.atlassian.net/rest/api/3/search?jql=assignee=currentUser()&maxResults=10' \
  -H 'Authorization: Basic <base64-encoded-credentials>' \
  -H 'Accept: application/json'
```

### Example 2: Complex POST Search
```bash
curl -X POST \
  'https://your-domain.atlassian.net/rest/api/3/search' \
  -H 'Authorization: Basic <base64-encoded-credentials>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{
    "jql": "project = ABC AND status NOT IN (Closed, Resolved) AND assignee = currentUser() ORDER BY priority DESC, duedate ASC",
    "startAt": 0,
    "maxResults": 50,
    "fields": ["summary", "status", "priority", "assignee", "duedate"],
    "expand": ["names"]
  }'
```

### Example 3: Pagination with Next Page Token
```bash
curl -X POST \
  'https://your-domain.atlassian.net/rest/api/3/search' \
  -H 'Authorization: Basic <base64-encoded-credentials>' \
  -H 'Content-Type: application/json' \
  -d '{
    "jql": "project = ABC",
    "nextPageToken": "eyJpc3N1ZUlkIjoxMDAxMH0=",
    "maxResults": 50,
    "fields": ["key", "summary"]
  }'
```

## Common JQL Examples

### Assigned to Current User
```
assignee = currentUser()
```

### Open Issues in Project
```
project = "PROJECT_KEY" AND status NOT IN (Closed, Resolved, Done)
```

### High Priority Bugs
```
issuetype = Bug AND priority IN (High, Highest)
```

### Issues Updated in Last Week
```
updated >= -1w
```

### Overdue Issues
```
duedate < now() AND status NOT IN (Closed, Resolved, Done)
```

## Field Reference

### Commonly Used Fields
- `key` - Issue key (e.g., ABC-123)
- `summary` - Issue summary/title
- `description` - Issue description
- `status` - Current status
- `assignee` - Person assigned to the issue
- `reporter` - Person who created the issue
- `priority` - Issue priority
- `created` - Creation timestamp
- `updated` - Last update timestamp
- `duedate` - Due date
- `project` - Project information
- `issuetype` - Type of issue (Bug, Story, Task, etc.)
- `components` - Project components
- `labels` - Issue labels
- `fixVersions` - Fix versions
- `comment` - Comments on the issue

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "errorMessages": ["The JQL query is invalid."],
  "errors": {}
}
```

#### 401 Unauthorized
```json
{
  "errorMessages": ["Authentication required"],
  "errors": {}
}
```

#### 403 Forbidden
```json
{
  "errorMessages": ["You do not have permission to access this resource"],
  "errors": {}
}
```

## Best Practices

1. **Use Field Filtering**: Only request fields you need to reduce response size
2. **Implement Pagination**: Always paginate through large result sets
3. **Cache Results**: Cache search results when appropriate to reduce API calls
4. **Validate JQL**: Use `validateQuery` parameter during development
5. **Handle Errors Gracefully**: Implement proper error handling for all response codes
6. **Use POST for Complex Queries**: When JQL is long or contains special characters
7. **Respect Rate Limits**: Implement exponential backoff for rate limit errors

## Migration Notes from API v2

- The endpoint path remains `/rest/api/3/search` (not `/rest/api/3/search/jql`)
- Response structure is largely compatible with v2
- New pagination option with `nextPageToken` available
- Some deprecated fields may not be available in v3

## Additional Resources

- [JQL Reference](https://support.atlassian.com/jira-software-cloud/docs/advanced-search-reference-jql-fields/)
- [Atlassian REST API Authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- [API Rate Limits](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)