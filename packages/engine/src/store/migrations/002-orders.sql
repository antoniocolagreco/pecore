ALTER TABLE tickets_seen ADD COLUMN order_id TEXT;
ALTER TABLE tickets_seen ADD COLUMN state TEXT NOT NULL DEFAULT 'received'
  CHECK (state IN ('received', 'confirming', 'handed', 'asking', 'planned', 'done', 'dropped'));

UPDATE tickets_seen
SET order_id = (
  SELECT min(id) FROM events
  WHERE type = 'ticket.seen'
    AND json_extract(payload, '$.source') = tickets_seen.source
    AND json_extract(payload, '$.ticketId') = tickets_seen.ticket_id
);

CREATE UNIQUE INDEX tickets_seen_order ON tickets_seen (order_id);
CREATE INDEX events_order ON events (json_extract(payload, '$.orderId'), id) WHERE type LIKE 'order.%';

ALTER TABLE jobs ADD COLUMN order_id TEXT;
ALTER TABLE jobs ADD COLUMN order_key TEXT;
CREATE UNIQUE INDEX jobs_order_key ON jobs (order_id, order_key);
