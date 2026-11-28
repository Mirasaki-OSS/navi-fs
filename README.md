<p align="center"><img src=".github/markdown-media/logo.png" alt="NaviFS Logo" height="60" style="border-radius:50px"/></p>
<h1 align="center">NaviFS</h1>

<div align='center'>

[![CodeFactor](https://www.codefactor.io/repository/github/Mirasaki-Development/navi-fs/badge)](https://www.codefactor.io/repository/github/Mirasaki-Development/navi-fs)
![GitHub](https://img.shields.io/github/license/Mirasaki-Development/navi-fs)
![GitHub release](https://img.shields.io/github/v/release/Mirasaki-Development/navi-fs)

</div>

<p align="center">
  NaviFS (short for Navigate File System) transforms your local files into a secure, powerful API.
  Stream, serve, and execute using simple configuration and REST-style access.
</p>

> [!CAUTION]
> The v2 update is a complete rewrite focusing on completeness, ease-of-use, and security.
> 
> Previous versions are now unmaintained, and no longer supported. If your `v1` API key is secure there is no need to rush migrating to `v2`. However, do note there is a path traversal issue in `v1` that allows anyone with the master API key to access any files your service user has access to. If you're concerned about *your* API key, simply regenerate it, update the configuration file and rebuild.
> 
> The rewrite is designed with security best-practices in mind, and I encourage anyone to try and exploit it.

## 🔨 Installation

### 📦 Run as a Docker container (preferred)

The quickest, and easiest, way to host/use this application is by deploying it inside of a [Docker](https://www.docker.com/) container. We recommend [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Download the [latest release](https://github.com/Mirasaki-Development/navi-fs/releases`) or `git clone git@github.com:Mirasaki-Development/navi-fs.git` the repo
2. Run `npm run setup:linux` or `npm run setup:windows` (depending on your OS) in the project root folder
3. Edit the newly created `/config.yaml` file and provide your configuration
4. Start the application: `docker compose up -d` (you can view logs with `docker compose logs -f`)

### 🖥️ Run as a plain NodeJS app

1. Install the additional pre-requisites:
   - [Node.js](https://nodejs.org/en/) v16.6.0 or newer
2. Download the [latest release](https://github.com/Mirasaki-Development/navi-fs/releases`) or `git clone git@github.com:Mirasaki-Development/navi-fs.git` the repo
3. Run `npm run setup:linux` or `npm run setup:windows` in the project root folder
4. Edit the newly created `/config.yaml` file and provide your configuration
5. Start the application: `npm run start` for production, and `npm run dev` for local development

## ⚙️ Configuration

The configuration for this project can be found [here](/config.example.yaml), and should be very straight-forward. Please see below for "advanced" usage examples.

```yaml
port: 9000 # Port to run the application on
log-level: info # debug, info, warn, or error

# Master API key (must be strong, unique, and kept secret)
master-api-key: "a7fd8324d81e45a99e33b1c9a77ddca1c97f04a4e9aafb2ffb9273b7713ce1cb"

# List of resources to expose via the API
resources:
  - slug: project-files
    target: /home/navi/projects/my-site
    extensions:
      - .html
      - .css
      - .js
    size-policy:
      - unit: bytes
        limit: 1048576 # 1 MB
        mode: truncate
        cumulative: false
        extensions: [ ".log", ".txt" ]
        pattern: ".*\\.log$"
    cache-control:
      max-age: 3600
      s-maxage: 7200
      no-cache: false
      no-store: false
      stale-while-revalidate: 86400
      stale-if-error: 604800
      public: true
      private: false
      immutable: false
    permissions:
      - type: [ read, write ]
        api-key: "6cbf9926bc7c4ea49ad0ffcb3a6d31e103eb8c7209c69df173bfe1f5f90aa9a3"
      - type: delete
        api-key: "79b29829cebf4b65bb63ff51cdbeaad4f9b8e59aee93e2e5b709b2ef943f3468"

  - slug: run-script
    target: /usr/local/bin/scripts
    executable:
      command: "bash"
      args: [ "hello-world.sh" ]
      cwd: "/usr/local/bin/scripts"
      env:
        MODE: "production"
      timeout: 300 # seconds
      detached: false
      shell: "/bin/bash"
    permissions:
      - type: execute
        api-key: "4fa02b5dcfe84f2694ef7cbb6a198a3a94bd6b3e3f4696845edb4a983be70c26"

  - slug: config-json
    target: /etc/myapp/config.json
    extensions:
      - .json
    permissions:
      - type: read
        api-key: "79b29829cebf4b65bb63ff51cdbeaad4f9b8e59aee93e2e5b709b2ef943f3468"
```
## 📚 API Documentation

NaviFS exposes a RESTful API to interact with your local files via secure endpoints.

API requests require a valid `x-api-key` header, except for `OPTIONS` requests and the `GET /` endpoint, which are public.

---

### 🔐 Authentication

There are two types of API keys:

- **Master API Key** – Grants access to list all available slugs.
- **Per-Resource API Key** – Grants access to specific actions on a specific resource.

---

### 🌐 Endpoints

#### `GET /`

Basic health check. No authentication required.

**Response:**

```json
{
  "data": {
    "status": "alive"
  }
}
```

## 📂 `GET /api/v1/:slug`

Retrieves file contents or lists directory contents.

**Query Parameters (optional):**

- `cursor` – Subpath relative to resource root.
- `type` – Output format: `stream`, `json`, `text`, `html`, `xml`, `csv`, `yaml`, `toml`
- `recursive` – If `true`, list all nested files.

**Headers:**

- `x-api-key: <RESOURCE_API_KEY>`

**Behavior:**

- If resource is a file: streams file or parses to requested format.
- If directory: lists contents (recursively if requested).
- Directory cursors must be relative and resolve within the resource root, including through symbolic links; outside paths receive `403`. Directory listings omit links to outside targets and dangling links.
- Missing targets return `404`.
- Sets `Cache-Control` (`no-store` by default), `ETag`, and `Last-Modified` headers for files.
- Responds `304` if `If-Modified-Since` or `If-None-Match` headers match.
- Streamed files support single byte ranges: satisfiable `Range` requests return `206` with `Content-Range`; unsatisfiable ranges return `416` with `Content-Range: bytes */<size>`. Malformed or multiple disjoint ranges are ignored.
- `If-Range` supports `Last-Modified` dates for files unchanged for at least 60 seconds. File ETags are weak and cannot be used as `If-Range` validators. Non-stream formats ignore ranges.

Containment checks assume local filesystem paths are not concurrently modified by an untrusted
user. Protect resource directories and their parent directories from untrusted local writes;
the checks cannot prevent filesystem changes between validation and access.

**Response:**

```json
{
  "data": "...",  // string or list
  "meta": {
    "slug": "logs/system",
    "query": { ... }
  }
}
```

---

## 📥 `POST /api/v1/:slug`

Writes to a file or creates a new file.

**Query Parameters (optional):**

- `cursor` – Path of file to write to or create.
- `encoding` – Optional, e.g. `utf-8`, `base64`, etc.
- `create` – If `true`, creates the file and parent directories if they don't exist. If not provided or `false`, the file must already exist.

**Headers:**

- `Content-Type: text/plain`
- `x-api-key: <RESOURCE_API_KEY>`

**Body:**  
Plain string content to be written to file.

**Behavior:**

- **Without `create` parameter (or `create=false`):** Only works if target is a file. Responds with `400` if the target does not exist or is a directory.
- **With `create=true`:** Creates the file if it doesn't exist, including all parent directories as needed. If the file already exists, its contents are overwritten. If the target path exists as a directory, responds with `400`.
- Responds with `400` if request body is invalid.
- Text request bodies are limited to 100 KiB (102,400 bytes); larger bodies receive `413`. This preserves Express's default limit and bounds the memory used to buffer a request body.

**Response:**  
`201 Created` on success.

---

## 🗑️ `DELETE /api/v1/:slug`

Deletes a file or directory.

**Query Parameters (optional):**

- `cursor` – Path to target file or directory.
- `force` – Required to delete directories.

**Headers:**

- `x-api-key: <RESOURCE_API_KEY>`

**Behavior:**

- Deletes file directly.
- If target is a directory, requires `force=true`.

**Response:**  
`204 No Content` on success.

---

## 🧠 `POST /api/v1/:slug/execute`

Executes a configured command and returns SSE (Server-Sent Events). The `execute` permission is required; write permission alone does not grant execution.

**Query Parameters (optional):**

- `cursor` – Optional directory relative to a directory resource root. If supplied, it overrides the configured working directory and must resolve inside the root. File resources cannot use an execution cursor.

**Headers:**

- `Accept: text/event-stream`
- `x-api-key: <RESOURCE_API_KEY>`

**Behavior:**

- Only allowed for resources that have an `executable` configuration defined.
- Without a cursor, the configured `cwd` is used; if unset, the server process's working directory is used.
- The configured `timeout` is in seconds (default: 600). Execution failures after the SSE response starts are sent as `error` events.
- Streams `stdout`, `stderr`, `exit`, and `error` events.

Commands run with the server process's operating-system privileges; resource containment is not a command sandbox. Configure executables and grant execute keys only to trusted parties. A timeout or client disconnect terminates the spawned process, not necessarily every process it creates; detached processes are not terminated on disconnect.

**Response Format (SSE):**

```text
event: stdout
data: Hello from stdout

event: stderr
data: Warning: something happened

event: exit
data: Process exited with code 0
```

---

## 🧪 `HEAD /api/v1/:slug`

Returns the same status and headers as GET without a response body. Requires read permission. Range requests are ignored for HEAD.

**Headers:**

- `x-api-key: <RESOURCE_API_KEY>`

**Behavior:**

- Applies the same cursor containment and missing-target checks as GET.

---

## ⚙️ `OPTIONS /api/v1/:slug`

Public endpoint returning allowed methods for an existing resource. An unknown resource returns `404`.

**Response Headers:**

```json
Allow: GET, HEAD, POST, DELETE, OPTIONS
```

For `/api/v1/:slug/execute`, the header is `POST, OPTIONS`; for `/api/v1/` and `/`, it is `GET, HEAD, OPTIONS`. Unsupported methods on these routes return a JSON `405` with the corresponding `Allow` header. Public OPTIONS does not enable CORS by itself.

---

### ⚠️ Error Handling

Errors detected before the response starts return JSON:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Human-readable error message",
    "status": 404
  }
}
```

- Errors may include a `details` object.
- Codes include `UNAUTHORIZED`, `FORBIDDEN`, `BAD_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `PRECONDITION_FAILED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RANGE_NOT_SATISFIABLE`, `TOO_MANY_REQUESTS`, and `INTERNAL_ERROR`.
- Unexpected errors have a generic message in production; development mode may expose exception messages.
- `Execution` failures are reported as SSE events.

## 🛣️ Roadmap

This section outlines the current and upcoming features and enhancements planned for the project. Here's where we plan to go:

### 🚀 Current Milestones

- [x] **Improved Error Handling:** Specific error codes and messages for common failures.
- [x] **File Streaming Improvements:** Stream large files and support single byte ranges and conditional requests.
- [ ] **Search Functionality:** Add advanced search and filtering capabilities for resource queries.
- [ ] **Cloud Storage Integrations:** Support for external cloud storage providers (e.g., AWS S3, Google Cloud Storage).
- [ ] **Frontend Panel/Dashboard** for administrators (long-term vision).
  - [ ] **User Authentication & Authorization:** Allow users to create accounts, authenticate via OAuth, and manage their API keys.
  - [ ] **Resource Management Dashboard:** Build an admin interface for better management and exploration of resources.

### 📖 OS-Level File Caching Documentation

Documents the operating system's file caching mechanism, focusing on how the OS optimizes file reads by caching frequently accessed data in memory. See the [OS-level file caching explanation](./docs/os-file-caching.md).

## 🤝 Contributing

If you have any suggestions or would like to see a specific feature, feel free to open an issue or submit a pull request!

We welcome contributions of all kinds! Whether it's fixing a bug, improving documentation, suggesting a new feature, or helping with tests — every bit helps make NaviFS better for everyone.

To contribute: (Please note the project is in an early stage, and currently doesn't have any tests set-up - any PRs for this are appreciated!)

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** and ensure existing tests pass
3. If applicable, add tests for your changes
4. **Submit a pull request** with a clear description of your work

Before submitting, please review our [Code of Conduct](./CODE_OF_CONDUCT.md) and [Contribution Guidelines](./CONTRIBUTING.md) (coming soon).

> Found a bug or have an idea? Open an issue — let’s talk!

## ⭐ Credits and Attribution

- Logo by [Flaticon](https://www.flaticon.com/free-icons/distance-education)

<br />

> Open source, self-hosted, and [Free Culture licensed](https://creativecommons.org/share-your-work/public-domain/freeworks), meaning you're in full control.

<br />

<p align="center"><a href="https://github.com/Mirasaki-Development/navi-fs#navi-fs"><img src="http://randojs.com/images/backToTopButton.png" alt="Back to top" height="29"/></a></p>
