import { defineResource, prop, ref } from '@archviz/schema';

export const auroraCluster = defineResource({
  id: 'aws/aurora-cluster',
  provider: 'aws',
  display: {
    label: 'Aurora Cluster',
    icon: 'aurora',
    category: 'database',
    kind: 'container',
    description: 'Managed Aurora database cluster (MySQL/PostgreSQL-compatible); holds one or more cluster instances',
  },
  capabilities: ['network-service', 'database'],
  nesting: {
    allowedParents: [{ type: 'aws/vpc', required: true }],
  },
  connections: [
    {
      relationship: 'attached-to',
      targets: [{ type: 'aws/security-group' }],
      cardinality: { maxOutgoing: 5 },
      materialize: { strategy: 'attribute', attribute: 'vpc_security_group_ids' },
      label: 'Security Group',
    },
    {
      relationship: 'uses-secret',
      targets: [{ capability: 'secret-value' }],
      cardinality: { maxOutgoing: 1 },
      materialize: { strategy: 'secret-value-ref', attribute: 'master_password' },
      label: 'Password from Secret',
    },
  ],
  properties: [
    {
      name: 'engine',
      type: 'enum',
      required: true,
      label: 'Engine',
      enumValues: ['aurora-postgresql', 'aurora-mysql'],
      default: 'aurora-postgresql',
    },
    {
      name: 'engine_version',
      type: 'string',
      required: false,
      label: 'Engine Version',
    },
    {
      name: 'database_name',
      type: 'string',
      required: false,
      label: 'Database Name',
    },
    {
      name: 'master_username',
      type: 'string',
      required: true,
      label: 'Master Username',
      default: 'admin',
    },
    {
      name: 'master_password',
      type: 'string',
      required: true,
      label: 'Master Password',
      default: 'changeme',
    },
    {
      name: 'backup_retention_period',
      type: 'number',
      required: false,
      label: 'Backup Retention (days)',
      default: 7,
      validate: { min: 1, max: 35 },
    },
    {
      name: 'skip_final_snapshot',
      type: 'boolean',
      required: false,
      default: true,
      label: 'Skip Final Snapshot',
    },
  ],
  terraform: {
    resourceType: 'aws_rds_cluster',
    attributes: {
      engine: prop('engine'),
      engine_version: prop('engine_version'),
      database_name: prop('database_name'),
      master_username: prop('master_username'),
      master_password: prop('master_password'),
      backup_retention_period: prop('backup_retention_period'),
      skip_final_snapshot: prop('skip_final_snapshot'),
      vpc_security_group_ids: ref.rel('attached-to', 'id', true),
    },
  },
});

export const auroraClusterInstance = defineResource({
  id: 'aws/aurora-cluster-instance',
  provider: 'aws',
  display: {
    label: 'Aurora Instance',
    icon: 'aurora',
    category: 'database',
    kind: 'node',
    description: 'A single writer/reader instance within an Aurora Cluster',
  },
  capabilities: ['compute'],
  nesting: {
    allowedParents: [{ type: 'aws/aurora-cluster', required: true }],
  },
  connections: [],
  properties: [
    {
      name: 'instance_class',
      type: 'enum',
      required: true,
      label: 'Instance Class',
      enumValues: ['db.t4g.medium', 'db.t3.medium', 'db.r6g.large', 'db.r6g.xlarge'],
      default: 'db.t4g.medium',
    },
    {
      name: 'publicly_accessible',
      type: 'boolean',
      required: false,
      default: false,
      label: 'Publicly Accessible',
    },
  ],
  terraform: {
    resourceType: 'aws_rds_cluster_instance',
    attributes: {
      cluster_identifier: ref.parent('aws/aurora-cluster', 'id'),
      engine: ref.parent('aws/aurora-cluster', 'engine'),
      instance_class: prop('instance_class'),
      publicly_accessible: prop('publicly_accessible'),
    },
  },
});
