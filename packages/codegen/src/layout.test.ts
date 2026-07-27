import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type ArchvizDocument, type ResourceInstance } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generate, buildDirectoryExport } from './index.js';

const registry = createAwsRegistry();

function resource(partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>): ResourceInstance {
  return {
    properties: {},
    parentId: null,
    layout: { x: 0, y: 0 },
    ...partial,
  };
}

function fullStackDoc(): ArchvizDocument {
  return {
    ...createEmptyDocument('full-stack'),
    resources: [
      resource({ id: 'vpc-1', type: 'aws/vpc', name: 'vpc', properties: { cidr_block: '10.0.0.0/16' } }),
      resource({
        id: 'subnet-1',
        type: 'aws/subnet',
        name: 'subnet',
        parentId: 'vpc-1',
        properties: { cidr_block: '10.0.1.0/24' },
      }),
      resource({
        id: 'sg-1',
        type: 'aws/security-group',
        name: 'sg',
        parentId: 'vpc-1',
        properties: { description: 'app sg' },
      }),
      resource({
        id: 'ec2-1',
        type: 'aws/ec2-instance',
        name: 'web',
        parentId: 'subnet-1',
        properties: { ami: 'ami-0c55b159cbfafe1f0', instance_type: 't3.micro' },
      }),
      resource({
        id: 'rds-1',
        type: 'aws/rds-instance',
        name: 'db',
        parentId: 'subnet-1',
        properties: {
          engine: 'postgres',
          instance_class: 'db.t3.micro',
          allocated_storage: 20,
          username: 'admin',
          password: 'changeme',
        },
      }),
      resource({ id: 's3-1', type: 'aws/s3-bucket', name: 'assets', properties: { bucket: 'my-assets' } }),
    ],
    relationships: [],
  };
}

describe('by-category multi-file layout', () => {
  it('buckets resources into network/compute/database/storage/security files', () => {
    const result = generate(fullStackDoc(), registry, { layout: 'by-category' });
    expect(result.blocked).toBe(false);
    expect(Object.keys(result.files).sort()).toEqual([
      'compute.tf',
      'database.tf',
      'network.tf',
      'outputs.tf',
      'providers.tf',
      'security.tf',
      'storage.tf',
      'versions.tf',
    ]);

    expect(result.files['network.tf']).toContain('resource "aws_vpc" "vpc"');
    expect(result.files['network.tf']).toContain('resource "aws_subnet" "subnet"');
    expect(result.files['compute.tf']).toContain('resource "aws_instance" "web"');
    expect(result.files['database.tf']).toContain('resource "aws_db_instance" "db"');
    expect(result.files['storage.tf']).toContain('resource "aws_s3_bucket" "assets"');
    expect(result.files['security.tf']).toContain('resource "aws_security_group" "sg"');
    expect(result.files['versions.tf']).toContain('hashicorp/aws');
    expect(result.files['providers.tf']).toContain('provider "aws"');
    expect(result.files['outputs.tf']).toContain('output "vpc_vpc_id"');
    expect(result.files['outputs.tf']).toContain('output "db_rds_endpoint"');
    // No cross-file leakage
    expect(result.files['compute.tf']).not.toContain('aws_db_instance');
    expect(result.files['network.tf']).not.toContain('aws_instance');
  });

  it('single-file layout still produces exactly main.tf', () => {
    const result = generate(fullStackDoc(), registry, { layout: 'single-file' });
    expect(Object.keys(result.files)).toEqual(['main.tf']);
    expect(result.files['main.tf']).toContain('resource "aws_vpc" "vpc"');
    expect(result.files['main.tf']).toContain('resource "aws_instance" "web"');
  });

  it('variables.tf only appears when there are promoted/secret variables', () => {
    const withoutVars = generate(fullStackDoc(), registry, { layout: 'by-category' });
    expect(withoutVars.files['variables.tf']).toBeUndefined();

    const doc = fullStackDoc();
    doc.resources[0]!.variableBindings = { cidr_block: 'vpc_cidr' };
    const withVars = generate(doc, registry, { layout: 'by-category' });
    expect(withVars.files['variables.tf']).toContain('variable "vpc_cidr"');
  });
});

describe('multi-service directory export', () => {
  function crossGroupDoc(): ArchvizDocument {
    const doc = fullStackDoc();
    doc.resources[0]!.serviceGroup = 'network'; // vpc
    doc.resources[1]!.serviceGroup = 'network'; // subnet
    doc.resources[2]!.serviceGroup = 'network'; // sg
    doc.resources[3]!.serviceGroup = 'api'; // ec2 — nested inside "network" subnet but owned by "api"
    doc.resources[4]!.serviceGroup = 'api'; // rds
    doc.resources[5]!.serviceGroup = null as unknown as string; // s3 -> defaults to "shared"
    return doc;
  }

  it('partitions output into one directory per service group', () => {
    const result = buildDirectoryExport(crossGroupDoc(), registry);
    expect(result.blocked).toBe(false);

    const paths = Object.keys(result.files);
    expect(paths).toContain('network/network.tf');
    expect(paths).toContain('api/compute.tf');
    expect(paths).toContain('api/database.tf');
    expect(paths).toContain('shared/storage.tf');
    expect(paths).toContain('README.md');

    expect(result.files['network/network.tf']).toContain('resource "aws_vpc" "vpc"');
    expect(result.files['api/compute.tf']).toContain('resource "aws_instance" "web"');
    expect(result.files['api/compute.tf']).not.toContain('aws_vpc');
  });

  it('rewrites a cross-group reference into a terraform_remote_state lookup', () => {
    const result = buildDirectoryExport(crossGroupDoc(), registry);

    // EC2 (group "api") is nested inside Subnet (group "network") — its
    // subnet_id can't be a same-state traversal anymore.
    expect(result.files['api/compute.tf']).toContain('data.terraform_remote_state.network.outputs.subnet_id');
    expect(result.files['api/compute.tf']).not.toMatch(/subnet_id\s+= aws_subnet/);

    // The "network" group exposes that value via an output...
    expect(result.files['network/outputs.tf']).toContain('output "subnet_id"');
    expect(result.files['network/outputs.tf']).toContain('aws_subnet.subnet.id');

    // ...and the "api" group gets a remote_state.tf stub to read it from.
    expect(result.files['api/remote_state.tf']).toContain('data "terraform_remote_state" "network"');
    expect(result.files['api/remote_state.tf']).toContain('TODO');
  });

  it('each service group gets its own versions.tf/providers.tf', () => {
    const result = buildDirectoryExport(crossGroupDoc(), registry);
    for (const group of ['network', 'api', 'shared']) {
      expect(result.files[`${group}/versions.tf`]).toContain('hashicorp/aws');
      expect(result.files[`${group}/providers.tf`]).toContain('provider "aws"');
    }
  });

  it('README documents naming convention and cross-service wiring', () => {
    const result = buildDirectoryExport(crossGroupDoc(), registry);
    expect(result.files['README.md']).toContain('network/');
    expect(result.files['README.md']).toContain('api/');
    expect(result.files['README.md']).toContain('shared/');
    expect(result.files['README.md']).toContain('terraform_remote_state');
  });
});
