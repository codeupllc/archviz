import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type ArchvizDocument } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generate, generateMainTf, allocateNames, sanitizeIdentifier, printHcl } from './index.js';

describe('names', () => {
  it('sanitizes identifiers', () => {
    expect(sanitizeIdentifier('Web Server 1')).toBe('web_server_1');
    expect(sanitizeIdentifier('123abc')).toBe('r_123abc');
  });

  it('allocates unique stable names', () => {
    const names = allocateNames([
      { id: 'b', name: 'web' },
      { id: 'a', name: 'web' },
    ]);
    expect(names.get('a')).toBe('web');
    expect(names.get('b')).toBe('web_2');
  });
});

describe('codegen vpc/subnet/ec2', () => {
  const registry = createAwsRegistry();

  function sampleDoc(): ArchvizDocument {
    return {
      ...createEmptyDocument('demo'),
      resources: [
        {
          id: 'vpc-1',
          type: 'aws/vpc',
          name: 'main',
          properties: {
            cidr_block: '10.0.0.0/16',
            enable_dns_hostnames: true,
            enable_dns_support: true,
          },
          parentId: null,
          layout: { x: 0, y: 0, width: 500, height: 400 },
        },
        {
          id: 'subnet-1',
          type: 'aws/subnet',
          name: 'public-a',
          properties: {
            cidr_block: '10.0.1.0/24',
            map_public_ip_on_launch: true,
          },
          parentId: 'vpc-1',
          layout: { x: 20, y: 40, width: 300, height: 200 },
        },
        {
          id: 'ec2-1',
          type: 'aws/ec2-instance',
          name: 'web-server',
          properties: {
            ami: 'ami-0c55b159cbfafe1f0',
            instance_type: 't3.micro',
          },
          parentId: 'subnet-1',
          layout: { x: 40, y: 60 },
        },
      ],
      relationships: [],
    };
  }

  it('generates readable HCL with parent refs', () => {
    const hcl = generateMainTf(sampleDoc(), registry);
    expect(hcl).toContain('resource "aws_vpc" "main"');
    expect(hcl).toContain('resource "aws_subnet" "public_a"');
    expect(hcl).toContain('resource "aws_instance" "web_server"');
    expect(hcl).toContain('vpc_id');
    expect(hcl).toContain('aws_vpc.main.id');
    expect(hcl).toContain('subnet_id');
    expect(hcl).toContain('aws_subnet.public_a.id');
    expect(hcl).toContain('cidr_block');
    expect(hcl).toMatch(/provider "aws"/);
  });

  it('orders VPC before subnet before instance', () => {
    const hcl = generateMainTf(sampleDoc(), registry);
    const vpcIdx = hcl.indexOf('resource "aws_vpc"');
    const subnetIdx = hcl.indexOf('resource "aws_subnet"');
    const ec2Idx = hcl.indexOf('resource "aws_instance"');
    expect(vpcIdx).toBeGreaterThan(-1);
    expect(subnetIdx).toBeGreaterThan(vpcIdx);
    expect(ec2Idx).toBeGreaterThan(subnetIdx);
  });

  it('blocks export when structural/semantic errors exist', () => {
    const doc = sampleDoc();
    doc.resources[2]!.properties = {}; // missing ami / instance_type
    const result = generate(doc, registry);
    expect(result.blocked).toBe(true);
    expect(result.files['main.tf']).toContain('# ERROR:');
  });

  it('generates Aurora cluster + instance and ElastiCache with cluster_id', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('demo2'),
      resources: [
        {
          id: 'vpc-1',
          type: 'aws/vpc',
          name: 'main',
          properties: { cidr_block: '10.0.0.0/16' },
          parentId: null,
          layout: { x: 0, y: 0, width: 600, height: 500 },
        },
        {
          id: 'subnet-1',
          type: 'aws/subnet',
          name: 'private-a',
          properties: { cidr_block: '10.0.2.0/24' },
          parentId: 'vpc-1',
          layout: { x: 20, y: 40, width: 300, height: 200 },
        },
        {
          id: 'aurora-1',
          type: 'aws/aurora-cluster',
          name: 'primary',
          properties: {
            engine: 'aurora-postgresql',
            master_username: 'admin',
            master_password: 'changeme12345',
            skip_final_snapshot: true,
          },
          parentId: 'vpc-1',
          layout: { x: 340, y: 40, width: 220, height: 160 },
        },
        {
          id: 'aurora-instance-1',
          type: 'aws/aurora-cluster-instance',
          name: 'writer',
          properties: { instance_class: 'db.t4g.medium' },
          parentId: 'aurora-1',
          layout: { x: 10, y: 40 },
        },
        {
          id: 'cache-1',
          type: 'aws/elasticache-cluster',
          name: 'sessions',
          properties: {
            cluster_id: 'sessions-cache',
            engine: 'redis',
            node_type: 'cache.t3.micro',
            num_cache_nodes: 1,
          },
          parentId: 'subnet-1',
          layout: { x: 40, y: 60 },
        },
      ],
      relationships: [],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_rds_cluster" "primary"');
    expect(hcl).toContain('resource "aws_rds_cluster_instance" "writer"');
    expect(hcl).toContain('cluster_identifier');
    expect(hcl).toContain('aws_rds_cluster.primary.id');
    expect(hcl).toContain('aws_rds_cluster.primary.engine');
    expect(hcl).toContain('resource "aws_elasticache_cluster" "sessions"');
    expect(hcl).toContain('cluster_id');
    expect(hcl).toContain('sessions-cache');

    const result = generate(doc, registry);
    expect(result.blocked).toBe(false);
  });

  it('golden: printer formatting', () => {
    const hcl = printHcl([
      {
        blockType: 'resource',
        labels: ['aws_vpc', 'main'],
        attributes: [
          { name: 'cidr_block', value: { kind: 'string', value: '10.0.0.0/16' } },
          { name: 'enable_dns_support', value: { kind: 'boolean', value: true } },
        ],
        blocks: [],
      },
    ]);
    expect(hcl).toBe(
      [
        'resource "aws_vpc" "main" {',
        '  cidr_block         = "10.0.0.0/16"',
        '  enable_dns_support = true',
        '}',
        '',
      ].join('\n'),
    );
  });
});
