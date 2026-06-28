# Cloud Flow

## List

1. Dashboard calls `cloud-list` with bearer token.
2. Function verifies caller and admin role.
3. Function inserts `cloud_jobs` row with `action = "list"`.
4. Function waits briefly for agent result.
5. Agent reads filesystem under `CLOUD_HIDDENROOM_ROOT` and writes job result.

## Upload

1. Dashboard uploads file to private `cloud-staging` at `{auth.uid()}/timestamp-random-name`.
2. Dashboard calls `cloud-upload` with filename, staging path, size, MIME, and target path.
3. Function enqueues job.
4. Agent downloads the staged object using service role, validates size, writes inside root, removes staged object, and stores public URL in result.

## Folder/Delete

Functions authenticate and authorize, normalize request path, enqueue jobs. Agent uses safe child path validation before `mkdir`, `rm`, or file deletion.

## Environment

Required agent env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLOUD_HIDDENROOM_ROOT`
- `CLOUD_HIDDENROOM_URL`
- `CLOUD_STAGING_BUCKET`

Optional:

- `CLOUD_JOBS_POLL_INTERVAL_MS`
- `CLOUD_JOBS_BATCH_SIZE`
- `CLOUD_JOBS_LOCK_TIMEOUT_MS`
