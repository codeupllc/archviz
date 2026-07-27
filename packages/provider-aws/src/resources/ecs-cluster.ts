import { defineResource, prop, literal } from '@archviz/schema';

export const ecsCluster = defineResource({
  id: 'aws/ecs-cluster',
  provider: 'aws',
  display: {
    label: 'ECS Cluster',
    icon: 'ecs',
    category: 'compute',
    kind: 'container',
    description: 'Logical grouping for ECS services and tasks (Fargate or EC2)',
  },
  capabilities: ['compute-cluster'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'cluster_name',
      type: 'string',
      required: true,
      label: 'Cluster Name',
      default: 'app-cluster',
    },
    {
      name: 'container_insights',
      type: 'enum',
      required: false,
      label: 'Container Insights',
      enumValues: ['enabled', 'disabled'],
      default: 'disabled',
    },
  ],
  terraform: {
    resourceType: 'aws_ecs_cluster',
    attributes: {
      name: prop('cluster_name'),
    },
    blocks: [
      {
        blockType: 'setting',
        attributes: {
          name: literal('containerInsights'),
          value: prop('container_insights'),
        },
      },
    ],
  },
});
