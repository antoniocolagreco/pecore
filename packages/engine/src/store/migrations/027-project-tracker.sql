ALTER TABLE project_definition RENAME COLUMN source_node TO tracker_provider;
ALTER TABLE project_definition RENAME COLUMN source_account TO tracker_account;
UPDATE project_definition SET tracker_provider = CASE tracker_provider
  WHEN 'github-issues' THEN 'github' WHEN 'gitlab-issues' THEN 'gitlab' WHEN 'jira' THEN 'jira' ELSE NULL END;
DROP TABLE project_source_params;
UPDATE human_queue SET state = 'cancelled' WHERE state = 'open' AND kind IN ('ticket', 'outbound');
