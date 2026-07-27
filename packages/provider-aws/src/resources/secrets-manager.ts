import { defineResource, prop } from '@archviz/schema';

export const secretsManagerSecret = defineResource({
  id: 'aws/secrets-manager-secret',
  provider: 'aws',
  display: {
    label: 'Secrets Manager Secret',
    icon: 'secret',
    category: 'security',
    kind: 'node',
    description:
      'Securely stores a sensitive value. Connect it to a resource (e.g. an RDS password) instead of typing secrets into properties.',
  },
  capabilities: ['secret-value'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'secret_name',
      type: 'string',
      required: true,
      label: 'Secret Name',
      default: 'app/db-password',
    },
    {
      name: 'description',
      type: 'string',
      required: false,
      label: 'Description',
    },
    {
      name: 'source',
      type: 'enum',
      required: true,
      label: 'Value Source',
      enumValues: ['generated-password', 'variable'],
      default: 'generated-password',
      description:
        '"Generated" has Terraform create a random value (never written to disk, only to state). "Variable" reads a sensitive input variable supplied at apply time (terraform.tfvars or TF_VAR_...) — never hardcoded in the .tf files.',
    },
  ],
  terraform: {
    resourceType: 'aws_secretsmanager_secret',
    attributes: {
      name: prop('secret_name'),
      description: prop('description'),
    },
  },
});
