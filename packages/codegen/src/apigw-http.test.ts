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

function helloApiDocument(): ArchvizDocument {
  return {
    ...createEmptyDocument('hello-api'),
    resources: [
      resource({
        id: 'role-1',
        type: 'aws/iam-role',
        name: 'hello-role',
        properties: {
          name: 'hello-lambda-role',
          assume_role_policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          }),
        },
      }),
      resource({
        id: 'lambda-1',
        type: 'aws/lambda-function',
        name: 'hello',
        properties: {
          function_name: 'hello',
          runtime: 'nodejs20.x',
          handler: 'index.handler',
          filename: 'function.zip',
        },
      }),
      resource({
        id: 'api-1',
        type: 'aws/api-gateway-http-api',
        name: 'hello-api',
        properties: {
          name: 'hello-api',
          protocol_type: 'HTTP',
        },
      }),
    ],
    relationships: [
      {
        id: 'r-assumes',
        relationship: 'assumes',
        sourceId: 'lambda-1',
        targetId: 'role-1',
      },
      {
        id: 'r-routes',
        relationship: 'routes-to',
        sourceId: 'api-1',
        targetId: 'lambda-1',
      },
    ],
  };
}

describe('API Gateway HTTP API → Lambda', () => {
  it('emits integration, route, stage, and lambda permission', () => {
    const hcl = generateMainTf(helloApiDocument(), registry);
    expect(hcl).toContain('resource "aws_apigatewayv2_api"');
    expect(hcl).toContain('resource "aws_apigatewayv2_integration"');
    expect(hcl).toContain('resource "aws_apigatewayv2_route"');
    expect(hcl).toContain('resource "aws_apigatewayv2_stage"');
    expect(hcl).toContain('resource "aws_lambda_permission"');
    expect(hcl).toContain('principal     = "apigateway.amazonaws.com"');
    expect(hcl).toContain('lambda:InvokeFunction');
  });
});
