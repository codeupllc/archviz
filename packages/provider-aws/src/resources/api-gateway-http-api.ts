import { defineResource, prop } from '@archviz/schema';

export const apiGatewayHttpApi = defineResource({
  id: 'aws/api-gateway-http-api',
  provider: 'aws',
  display: {
    label: 'API Gateway HTTP API',
    icon: 'api-gateway',
    category: 'networking',
    kind: 'node',
    description: 'HTTP API for Lambda',
  },
  capabilities: ['api-gateway'],
  nesting: {
    // API Gateway HTTP API is not nested in any other resources
    allowedParents: [],
  },
  connections: [
    {
      // API Gateway HTTP API routes traffic to Lambda functions via integration
      relationship: 'routes-to',
      targets: [{ type: 'aws/lambda-function' }],
      cardinality: { maxOutgoing: null },
      materialize: { strategy: 'apigw-http-route' },
      label: 'Routes to',
    },
  ],
  properties: [
    {
      name: 'name',
      type: 'string',
      required: true,
      default: 'my-http-api',
      label: 'API Name',
    },
    {
      name: 'protocol_type',
      type: 'enum',
      required: true,
      enumValues: ['HTTP'],
      default: 'HTTP',
      label: 'Protocol Type',
    },
    {
      name: 'description',
      type: 'string',
      required: false,
      label: 'Description',
    },
  ],
  terraform: {
    resourceType: 'aws_apigatewayv2_api',
    attributes: {
      name: prop('name'),
      protocol_type: prop('protocol_type'),
      description: prop('description'),
    },
  },
});
