import { describe, expect, it } from 'vitest';
import {
  buildLocalstackProviderHcl,
  stripAwsProviderBlocks,
  withLocalstackProvider,
} from './localstack-provider.js';

describe('localstack provider HCL', () => {
  it('emits dummy creds, skip flags, and endpoints', () => {
    const hcl = buildLocalstackProviderHcl('eu-west-1', 'http://127.0.0.1:4566');
    expect(hcl).toContain('region                      = "eu-west-1"');
    expect(hcl).toContain('access_key                  = "test"');
    expect(hcl).toContain('skip_credentials_validation = true');
    expect(hcl).toContain('s3_use_path_style           = true');
    expect(hcl).toContain('lambda = "http://127.0.0.1:4566"');
    expect(hcl).toContain('dynamodb = "http://127.0.0.1:4566"');
  });

  it('strips nested provider aws blocks from HCL', () => {
    const input = `terraform {}

provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "b" {
  bucket = "x"
}
`;
    const stripped = stripAwsProviderBlocks(input);
    expect(stripped).not.toContain('provider "aws"');
    expect(stripped).toContain('resource "aws_s3_bucket" "b"');
  });

  it('replaces providers.tf and strips inline providers', () => {
    const files = withLocalstackProvider({
      'providers.tf': 'provider "aws" {\n  region = "us-east-1"\n}\n',
      'main.tf': 'provider "aws" {\n  region = "us-west-2"\n}\n\nresource "aws_sqs_queue" "q" {}\n',
    });
    expect(files['providers.tf']).toContain('skip_metadata_api_check');
    expect(files['main.tf']).not.toContain('provider "aws"');
    expect(files['main.tf']).toContain('aws_sqs_queue');
  });
});
