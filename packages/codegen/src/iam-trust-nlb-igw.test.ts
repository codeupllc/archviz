import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type ArchvizDocument, type ResourceInstance } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generateMainTf } from './index.js';

const registry = createAwsRegistry();

function resource(
  partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>,
): ResourceInstance {
  return { properties: {}, parentId: null, layout: { x: 0, y: 0 }, ...partial };
}

describe('IAM Role trust_principal presets', () => {
  it('emits lambda trust from the Trusted Service preset', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('iam-trust'),
      resources: [
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'fn-role',
          properties: { trust_principal: 'lambda' },
        }),
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_iam_role" "fn_role"');
    expect(hcl).toContain('lambda.amazonaws.com');
    expect(hcl).not.toContain('ec2.amazonaws.com');
  });

  it('keeps a custom assume_role_policy when Trusted Service is custom', () => {
    const custom = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { AWS: 'arn:aws:iam::123456789012:root' },
        },
      ],
    });
    const doc: ArchvizDocument = {
      ...createEmptyDocument('iam-custom'),
      resources: [
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'cross-account',
          properties: { trust_principal: 'custom', assume_role_policy: custom },
        }),
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('arn:aws:iam::123456789012:root');
  });
});

describe('Internet Gateway + NLB', () => {
  it('nests IGW in a VPC and emits aws_internet_gateway', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('igw'),
      resources: [
        resource({
          id: 'vpc-1',
          type: 'aws/vpc',
          name: 'main',
          properties: { cidr_block: '10.0.0.0/16' },
        }),
        resource({
          id: 'igw-1',
          type: 'aws/internet-gateway',
          name: 'gw',
          parentId: 'vpc-1',
          properties: {},
        }),
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_internet_gateway" "gw"');
    expect(hcl).toContain('vpc_id = aws_vpc.main.id');
  });

  it('emits a network load balancer with TCP listener', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('nlb'),
      resources: [
        resource({
          id: 'vpc-1',
          type: 'aws/vpc',
          name: 'main',
          properties: { cidr_block: '10.0.0.0/16' },
        }),
        resource({
          id: 'subnet-a',
          type: 'aws/subnet',
          name: 'a',
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.1.0/24' },
        }),
        resource({
          id: 'subnet-b',
          type: 'aws/subnet',
          name: 'b',
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.2.0/24' },
        }),
        resource({
          id: 'tg-1',
          type: 'aws/target-group',
          name: 'tcp',
          parentId: 'vpc-1',
          properties: { port: 443, protocol: 'TCP', target_type: 'instance' },
        }),
        resource({
          id: 'nlb-1',
          type: 'aws/nlb',
          name: 'edge',
          parentId: 'subnet-a',
          properties: { load_balancer_type: 'network', internal: false },
        }),
      ],
      relationships: [
        { id: 'r1', relationship: 'runs-in', sourceId: 'nlb-1', targetId: 'subnet-b' },
        { id: 'r2', relationship: 'routes-to', sourceId: 'nlb-1', targetId: 'tg-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('load_balancer_type = "network"');
    expect(hcl).toContain('resource "aws_lb_listener" "edge_to_tcp"');
    expect(hcl).toMatch(/protocol\s+=\s+"TCP"/);
  });
});
