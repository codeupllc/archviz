import { defineResource, prop } from '@archviz/schema';

export const s3Bucket = defineResource({
  id: 'aws/s3-bucket',
  provider: 'aws',
  display: {
    label: 'S3 Bucket',
    icon: 's3',
    category: 'storage',
    kind: 'node',
    description: 'Object storage bucket',
  },
  capabilities: ['storage'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'bucket',
      type: 'string',
      required: false,
      label: 'Bucket Name',
      description: 'Leave empty to let Terraform generate a name',
    },
    {
      name: 'force_destroy',
      type: 'boolean',
      required: false,
      default: false,
      label: 'Force Destroy',
    },
  ],
  terraform: {
    resourceType: 'aws_s3_bucket',
    attributes: {
      bucket: prop('bucket'),
      force_destroy: prop('force_destroy'),
    },
  },
});
