import { describe, expect, it } from 'vitest';
import {
  defineResource,
  ResourceRegistry,
  prop,
  ref,
  definitionsToJsonString,
  definitionsFromJsonString,
} from './index.js';

const vpc = defineResource({
  id: 'aws/vpc',
  provider: 'aws',
  display: { label: 'VPC', icon: 'vpc', category: 'networking', kind: 'container' },
  capabilities: ['network-boundary'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [{ name: 'cidr_block', type: 'cidr', required: true }],
  terraform: {
    resourceType: 'aws_vpc',
    attributes: { cidr_block: prop('cidr_block') },
  },
});

const subnet = defineResource({
  id: 'aws/subnet',
  provider: 'aws',
  display: { label: 'Subnet', icon: 'subnet', category: 'networking', kind: 'container' },
  capabilities: ['network-boundary'],
  nesting: { allowedParents: [{ type: 'aws/vpc', required: true }] },
  connections: [],
  properties: [{ name: 'cidr_block', type: 'cidr', required: true }],
  terraform: {
    resourceType: 'aws_subnet',
    attributes: {
      vpc_id: ref.parent('aws/vpc', 'id'),
      cidr_block: prop('cidr_block'),
    },
  },
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

const ec2 = defineResource({
  id: 'aws/ec2-instance',
  provider: 'aws',
  display: { label: 'EC2', icon: 'ec2', category: 'compute', kind: 'node' },
  capabilities: ['compute', 'network-client'],
  nesting: { allowedParents: [{ type: 'aws/subnet', required: true }] },
  connections: [
    {
      relationship: 'connects-to',
      targets: [{ capability: 'network-service' }],
      materialize: { strategy: 'sg-rule-pair' },
    },
  ],
  properties: [],
  terraform: { resourceType: 'aws_instance', attributes: {} },
});

describe('defineResource', () => {
  it('rejects invalid ids', () => {
    expect(() =>
      defineResource({
        id: 'bad',
        provider: 'aws',
        display: { label: 'X', icon: 'x', category: 'compute', kind: 'node' },
        capabilities: [],
        nesting: { allowedParents: [] },
        connections: [],
        properties: [],
        terraform: { resourceType: 'x', attributes: {} },
      }),
    ).toThrow(/provider\/name/);
  });
});

describe('ResourceRegistry', () => {
  const registry = new ResourceRegistry();
  registry.registerAll([vpc, subnet, rds, ec2]);

  it('indexes by id and capability', () => {
    expect(registry.require('aws/vpc').display.label).toBe('VPC');
    expect(registry.typesWithCapability('network-service')).toEqual(['aws/rds-instance']);
  });

  it('derives allowed children from nesting rules', () => {
    expect(registry.allowedChildren('aws/vpc')).toEqual(['aws/subnet']);
    expect(registry.canNestType('aws/subnet', 'aws/vpc')).toBe(true);
    expect(registry.canNestType('aws/ec2-instance', 'aws/vpc')).toBe(false);
  });

  it('matches connections via capability', () => {
    const rule = registry.findConnectionRule(
      'aws/ec2-instance',
      'connects-to',
      'aws/rds-instance',
    );
    expect(rule?.materialize.strategy).toBe('sg-rule-pair');
    expect(registry.possibleRelationships('aws/ec2-instance', 'aws/vpc')).toEqual([]);
  });

  it('round-trips through JSON', () => {
    const json = definitionsToJsonString(registry.all());
    const restored = ResourceRegistry.fromJSON(definitionsFromJsonString(json));
    expect(restored.get('aws/subnet')?.terraform.attributes['vpc_id']).toEqual({
      kind: 'parent',
      type: 'aws/vpc',
      attr: 'id',
    });
  });
});
