import { defineResource, prop } from '@archviz/schema';

export const ssmParameter = defineResource({
  id: 'aws/ssm-parameter',
  provider: 'aws',
  display: {
    label: 'SSM Parameter',
    icon: 'parameter',
    category: 'security',
    kind: 'node',
    description: 'Systems Manager Parameter Store entry for config values or secrets',
  },
  capabilities: ['secret-value'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'parameter_name',
      type: 'string',
      required: true,
      label: 'Parameter Name',
      default: '/app/config',
    },
    {
      name: 'type',
      type: 'enum',
      required: true,
      label: 'Type',
      enumValues: ['String', 'StringList', 'SecureString'],
      default: 'String',
    },
    {
      // Terraform requires `value` on aws_ssm_parameter, so this is required
      // with a placeholder default rather than optional-and-silently-missing.
      name: 'value',
      type: 'string',
      required: true,
      default: 'placeholder',
      label: 'Value',
      description:
        'Plain literal value. For SecureString, promote this field to a variable (the "\u2192 var" toggle) instead of hardcoding a secret here.',
    },
  ],
  terraform: {
    resourceType: 'aws_ssm_parameter',
    attributes: {
      name: prop('parameter_name'),
      type: prop('type'),
      value: prop('value'),
    },
  },
});
