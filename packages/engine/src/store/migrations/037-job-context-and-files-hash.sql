CREATE TEMP TABLE obsolete_jobs AS SELECT DISTINCT job_id AS id FROM events WHERE type = 'job.created' AND json_type(payload, '$.request') IS NULL;
DELETE FROM attempts WHERE node_run_id IN (SELECT id FROM node_runs WHERE job_id IN (SELECT id FROM obsolete_jobs));
DELETE FROM node_runs WHERE job_id IN (SELECT id FROM obsolete_jobs);
DELETE FROM human_queue WHERE job_id IN (SELECT id FROM obsolete_jobs);
DELETE FROM events WHERE job_id IN (SELECT id FROM obsolete_jobs);
DELETE FROM events WHERE type LIKE 'order.%' OR type = 'ticket.seen';
DELETE FROM tickets_seen;
DELETE FROM jobs WHERE id IN (SELECT id FROM obsolete_jobs);
DROP TABLE obsolete_jobs;

ALTER TABLE jobs ADD COLUMN request TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ticket_id TEXT;
ALTER TABLE artifacts RENAME COLUMN content_state TO files_hash;
ALTER TABLE node_runs RENAME COLUMN content_before TO files_hash_before;
ALTER TABLE node_runs RENAME COLUMN content_after TO files_hash_after;
UPDATE jobs SET
  request = COALESCE((SELECT json_extract(payload, '$.request') FROM events WHERE type = 'job.created' AND job_id = jobs.id), ''),
  ticket_id = (SELECT json_extract(payload, '$.ticketId') FROM events WHERE type = 'job.created' AND job_id = jobs.id);
