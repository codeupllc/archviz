import { defineResource, prop, ref } from '@archviz/schema';

export const elastiCacheCluster = defineResource({
  id: 'aws/elasticache-cluster',
  provider: 'aws',
  display: {
    label: 'ElastiCache Cluster',
    icon: 'elasticache',
    category: 'database',
    kind: 'node',
    description: 'Managed in-memory cache (Redis or Memcached)',
  },
  capabilities: ['network-service', 'database', 'cache'],
  nesting: {
    allowedParents: [{ type: 'aws/subnet', required: true }],
  },
  connections: [
    {
      relationship: 'attached-to',
      targets: [{ type: 'aws/security-group' }],
      cardinality: { maxOutgoing: 5 },
      materialize: { strategy: 'attribute', attribute: 'security_group_ids' },
      label: 'Security Group',
    },
  ],
  properties: [
    {
      name: 'cluster_id',
      type: 'string',
      required: true,
      label: 'Cluster ID',
      description: 'Unique identifier: lowercase letters, numbers, hyphens.',
      default: 'my-cache-cluster',
      validate: { pattern: '^[a-z][a-z0-9-]*$' },
    },
    {
      name: 'engine',
      type: 'enum',
      required: true,
      label: 'Engine',
      enumValues: ['redis', 'memcached'],
      default: 'redis',
    },
    {
      name: 'engine_version',
      type: 'string',
      required: false,
      label: 'Engine Version',
    },
    {
      name: 'node_type',
      type: 'enum',
      required: true,
      label: 'Node Type',
      enumValues: ['cache.t3.micro', 'cache.t3.small', 'cache.t3.medium', 'cache.m5.large'],
      default: 'cache.t3.micro',
    },
    {
      name: 'num_cache_nodes',
      type: 'number',
      required: true,
      label: 'Number of Nodes',
      default: 1,
      validate: { min: 1, max: 6 },
    },
    {
      name: 'port',
      type: 'number',
      required: false,
      label: 'Port',
      default: 6379,
    },
  ],
  terraform: {
    resourceType: 'aws_elasticache_cluster',
    attributes: {
      cluster_id: prop('cluster_id'),
      engine: prop('engine'),
      engine_version: prop('engine_version'),
      node_type: prop('node_type'),
      num_cache_nodes: prop('num_cache_nodes'),
      port: prop('port'),
      security_group_ids: ref.rel('attached-to', 'id', true),
    },
  },
});
