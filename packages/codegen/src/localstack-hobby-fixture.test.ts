import { describe, expect, it } from 'vitest';
import { checkLocalstackHobbyCompatibility, createAwsRegistry } from '@archviz/provider-aws';
import { generate, buildLocalstackHobbyDocument } from './index.js';

describe('LocalStack Hobby fixture', () => {
  it('is Hobby-compatible and generates unblocked Terraform', () => {
    const doc = buildLocalstackHobbyDocument();
    const types = doc.resources.map((r) => r.type);
    expect(checkLocalstackHobbyCompatibility(types).ok).toBe(true);

    const result = generate(doc, createAwsRegistry(), { layout: 'by-category' });
    expect(result.blocked).toBe(false);
    expect(result.files['providers.tf']).toContain('provider "aws"');
    expect(Object.values(result.files).join('\n')).toMatch(/aws_lambda_function/);
    expect(Object.values(result.files).join('\n')).toMatch(/aws_dynamodb_table/);
  });
});
