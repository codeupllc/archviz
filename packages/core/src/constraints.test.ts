import { describe, expect, it } from 'vitest';
import {
  defineResource,
  ResourceRegistry,
  prop,
  ref,
} from '@archviz/schema';
import {
  createEmptyDocument,
  createConstraintEngine,
  validate,
  type ArchvizDocument,
  type ResourceInstance,
} from './index.js';

function makeRegistry() {
  const vpc = defineResource({
    id: 'aws/vpc',
    provider: 'aws',
    display: { label: 'VPC', icon: 'vpc', category: 'networking', kind: 'container' },
    capabilities: [],
    nesting: { allowedParents: [] },
    connections: [],
    properties: [{ name: 'cidr_block', type: 'cidr', required: true }],
    terraform: { resourceType: 'aws_vpc', attributes: { cidr_block: prop('cidr_block') } },
  });

  const subnet = defineResource({
    id: 'aws/subnet',
    provider: 'aws',
    display: { label: 'Subnet', icon: 'subnet', category: 'networking', kind: 'container' },
    capabilities: [],
    nesting: { allowedParents: [{ type: 'aws/vpc', required: true }] },
    connections: [],
    properties: [{ name: 'cidr_block', type: 'cidr', required: true }],
    terraform: {
      resourceType: 'aws_subnet',
      attributes: { vpc_id: ref.parent('aws/vpc', 'id'), cidr_block: prop('cidr_block') },
    },
  });

  const nat = defineResource({
    id: 'aws/nat-gateway',
    provider: 'aws',
    display: { label: 'NAT Gateway', icon: 'nat', category: 'networking', kind: 'node' },
    capabilities: [],
    nesting: {
      allowedParents: [{ type: 'aws/subnet', required: true, maxPerParent: 1 }],
    },
    connections: [],
    properties: [],
    terraform: { resourceType: 'aws_nat_gateway', attributes: {} },
  });

  const sg = defineResource({
    id: 'aws/security-group',
    provider: 'aws',
    display: { label: 'Security Group', icon: 'sg', category: 'security', kind: 'node' },
    capabilities: [],
    nesting: { allowedParents: [{ type: 'aws/vpc', required: true }] },
    connections: [],
    properties: [],
    terraform: { resourceType: 'aws_security_group', attributes: {} },
  });

  const rds = defineResource({
    id: 'aws/rds-instance',
    provider: 'aws',
    display: { label: 'RDS', icon: 'rds', category: 'database', kind: 'node' },
    capabilities: ['network-service'],
    nesting: { allowedParents: [{ type: 'aws/subnet', required: true }] },
    connections: [],
    properties: [],
    terraform: { resourceType: 'aws_db_instance', attributes: {} },
  });

  const s3 = defineResource({
    id: 'aws/s3-bucket',
    provider: 'aws',
    display: { label: 'S3', icon: 's3', category: 'storage', kind: 'node' },
    capabilities: [],
    nesting: { allowedParents: [] },
    connections: [],
    properties: [],
    terraform: { resourceType: 'aws_s3_bucket', attributes: {} },
  });

  const ec2 = defineResource({
    id: 'aws/ec2-instance',
    provider: 'aws',
    display: { label: 'EC2', icon: 'ec2', category: 'compute', kind: 'node' },
    capabilities: ['compute'],
    nesting: { allowedParents: [{ type: 'aws/subnet', required: true }] },
    connections: [
      {
        relationship: 'attached-to',
        targets: [{ type: 'aws/security-group' }],
        cardinality: { maxOutgoing: 2 },
        materialize: { strategy: 'attribute', attribute: 'vpc_security_group_ids' },
      },
      {
        relationship: 'connects-to',
        targets: [{ capability: 'network-service' }],
        materialize: { strategy: 'sg-rule-pair' },
      },
    ],
    properties: [
      {
        name: 'ami',
        type: 'string',
        required: true,
        validate: { pattern: '^ami-' },
      },
    ],
    terraform: { resourceType: 'aws_instance', attributes: {} },
  });

  const registry = new ResourceRegistry();
  registry.registerAll([vpc, subnet, nat, sg, rds, s3, ec2]);
  return registry;
}

function res(
  id: string,
  type: string,
  opts: Partial<ResourceInstance> = {},
): ResourceInstance {
  return {
    id,
    type,
    name: id,
    properties: {},
    parentId: null,
    layout: { x: 0, y: 0 },
    ...opts,
  };
}

describe('constraint engine', () => {
  const registry = makeRegistry();
  const engine = createConstraintEngine(registry);

  it('rejects subnet without VPC parent', () => {
    const doc = createEmptyDocument();
    const result = engine.canNest('aws/subnet', null, null, doc);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('parent-required');
  });

  it('allows subnet inside VPC', () => {
    const doc = createEmptyDocument();
    expect(engine.canNest('aws/subnet', 'aws/vpc', 'vpc-1', doc).ok).toBe(true);
  });

  it('enforces maxPerParent nesting cardinality', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('vpc-1', 'aws/vpc'),
        res('subnet-1', 'aws/subnet', { parentId: 'vpc-1' }),
        res('nat-1', 'aws/nat-gateway', { parentId: 'subnet-1' }),
      ],
    };
    const result = engine.canNest('aws/nat-gateway', 'aws/subnet', 'subnet-1', doc);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('nesting-cardinality');
  });

  it('allows EC2 connects-to RDS via capability', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('vpc-1', 'aws/vpc'),
        res('subnet-1', 'aws/subnet', { parentId: 'vpc-1' }),
        res('ec2-1', 'aws/ec2-instance', { parentId: 'subnet-1' }),
        res('rds-1', 'aws/rds-instance', { parentId: 'subnet-1' }),
      ],
    };
    expect(engine.canConnect('ec2-1', 'rds-1', 'connects-to', doc).ok).toBe(true);
  });

  it('rejects EC2 connects-to S3 (no network-service capability)', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('ec2-1', 'aws/ec2-instance'),
        res('s3-1', 'aws/s3-bucket'),
      ],
    };
    const result = engine.canConnect('ec2-1', 's3-1', 'connects-to', doc);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('invalid-connection');
  });

  it('enforces outgoing connection cardinality', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('ec2-1', 'aws/ec2-instance'),
        res('sg-1', 'aws/security-group'),
        res('sg-2', 'aws/security-group'),
        res('sg-3', 'aws/security-group'),
      ],
      relationships: [
        { id: 'r1', relationship: 'attached-to', sourceId: 'ec2-1', targetId: 'sg-1' },
        { id: 'r2', relationship: 'attached-to', sourceId: 'ec2-1', targetId: 'sg-2' },
      ],
    };
    const result = engine.canConnect('ec2-1', 'sg-3', 'attached-to', doc);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('outgoing-cardinality');
  });

  it('validTargetsFor returns only legal targets', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('ec2-1', 'aws/ec2-instance'),
        res('rds-1', 'aws/rds-instance'),
        res('s3-1', 'aws/s3-bucket'),
        res('sg-1', 'aws/security-group'),
      ],
    };
    const targets = engine.validTargetsFor('ec2-1', undefined, doc);
    const ids = targets.map((t) => t.resourceId).sort();
    expect(ids).toEqual(['rds-1', 'sg-1']);
  });

  it('validate reports semantic required-property errors', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('vpc-1', 'aws/vpc', { properties: { cidr_block: '10.0.0.0/16' } }),
        res('subnet-1', 'aws/subnet', {
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.1.0/24' },
        }),
        res('ec2-1', 'aws/ec2-instance', {
          parentId: 'subnet-1',
          properties: {},
        }),
      ],
    };
    const result = validate(doc, registry);
    expect(result.ok).toBe(false);
    const ami = result.diagnostics.find((d) => d.property === 'ami');
    expect(ami?.tier).toBe('semantic');
    expect(ami?.code).toBe('required-property');
  });

  it('validate accepts a well-formed graph', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument(),
      resources: [
        res('vpc-1', 'aws/vpc', { properties: { cidr_block: '10.0.0.0/16' } }),
        res('subnet-1', 'aws/subnet', {
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.1.0/24' },
        }),
        res('ec2-1', 'aws/ec2-instance', {
          parentId: 'subnet-1',
          properties: { ami: 'ami-12345678' },
        }),
        res('rds-1', 'aws/rds-instance', { parentId: 'subnet-1' }),
      ],
      relationships: [
        { id: 'r1', relationship: 'connects-to', sourceId: 'ec2-1', targetId: 'rds-1' },
      ],
    };
    const result = validate(doc, registry);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
