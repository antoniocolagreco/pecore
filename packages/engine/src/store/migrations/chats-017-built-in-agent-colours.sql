UPDATE agents SET color = '#68389A'
WHERE id IN ('assistant', 'agent-default') AND kind = 'agent' AND color = '#FFFFFF';
