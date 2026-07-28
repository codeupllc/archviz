import type { ArchvizDocument } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import type { HclBlock } from './ast.js';
import { traversal } from './ast.js';

/**
 * A handful of high-value default outputs so a freshly generated diagram is
 * immediately useful without hand-writing outputs.tf: VPC id, load balancer
 * DNS name, and database endpoints. Built from the same ref/traversal data
 * the resource blocks themselves use.
 */
export function buildDefaultOutputs(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  names: Map<string, string>,
): HclBlock[] {
  const outputs: HclBlock[] = [];

  const push = (outputName: string, resourceType: string, name: string, attr: string) => {
    outputs.push({
      blockType: 'output',
      labels: [outputName],
      attributes: [{ name: 'value', value: traversal(resourceType, name, attr) }],
      blocks: [],
    });
  };

  for (const resource of document.resources) {
    const name = names.get(resource.id);
    if (!name) continue;
    const def = registry.get(resource.type);
    if (!def) continue;

    switch (resource.type) {
      case 'aws/vpc':
        push(`${name}_vpc_id`, def.terraform.resourceType, name, 'id');
        break;
      case 'aws/alb':
        push(`${name}_alb_dns_name`, def.terraform.resourceType, name, 'dns_name');
        break;
      case 'aws/rds-instance':
        push(`${name}_rds_endpoint`, def.terraform.resourceType, name, 'endpoint');
        break;
      case 'aws/aurora-cluster':
        push(`${name}_cluster_endpoint`, def.terraform.resourceType, name, 'endpoint');
        break;
      case 'aws/ecr-repository':
        push(`${name}_repository_url`, def.terraform.resourceType, name, 'repository_url');
        break;
      case 'aws/ecs-cluster':
        push(`${name}_cluster_id`, def.terraform.resourceType, name, 'id');
        break;
      case 'aws/sqs-queue':
        push(`${name}_queue_url`, def.terraform.resourceType, name, 'url');
        break;
      case 'aws/sns-topic':
        push(`${name}_topic_arn`, def.terraform.resourceType, name, 'arn');
        break;
      default:
        break;
    }
  }

  return outputs;
}
