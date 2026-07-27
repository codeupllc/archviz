import { defineResource, prop } from '@archviz/schema';

export const ecrRepository = defineResource({
  id: 'aws/ecr-repository',
  provider: 'aws',
  display: {
    label: 'ECR Repository',
    icon: 'ecr',
    category: 'compute',
    kind: 'node',
    description: 'Private Docker image registry. Build/push happens in your CI pipeline — this just holds the images.',
  },
  capabilities: ['image-registry'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'repository_name',
      type: 'string',
      required: true,
      label: 'Repository Name',
      default: 'app',
    },
    {
      name: 'image_tag_mutability',
      type: 'enum',
      required: false,
      label: 'Tag Mutability',
      enumValues: ['IMMUTABLE', 'MUTABLE'],
      default: 'IMMUTABLE',
    },
    {
      name: 'scan_on_push',
      type: 'boolean',
      required: false,
      label: 'Scan on Push',
      default: true,
    },
  ],
  terraform: {
    resourceType: 'aws_ecr_repository',
    attributes: {
      name: prop('repository_name'),
      image_tag_mutability: prop('image_tag_mutability'),
    },
    blocks: [
      {
        blockType: 'image_scanning_configuration',
        attributes: { scan_on_push: prop('scan_on_push') },
      },
    ],
  },
});
