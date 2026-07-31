import { describe, expect, it } from 'vitest';
import {
  fallbackLocalstackEcrUri,
  normalizeAppBuildContext,
  parseEcrRepositoryNames,
  shouldBuildEcsImages,
  withMutableEcrTags,
} from './ecr-image.js';

describe('ecr-image helpers', () => {
  it('detects when ECS image build is needed', () => {
    expect(shouldBuildEcsImages(['aws/s3-bucket'])).toBe(false);
    expect(shouldBuildEcsImages(['aws/ecs-service', 'aws/ecr-repository'])).toBe(true);
  });

  it('parses ECR repository names from HCL', () => {
    const names = parseEcrRepositoryNames({
      'compute.tf': `
resource "aws_ecr_repository" "watch_app_ecr" {
  name                 = "app"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}
`,
    });
    expect(names).toEqual(['app']);
  });

  it('normalizes app/Dockerfile contexts from enterprise Generate', () => {
    const ctx = normalizeAppBuildContext({
      'app/Dockerfile': 'FROM scratch\n',
      'app/go.mod': 'module app\n',
      'app/cmd/server/main.go': 'package main\n',
      'terraform/compute.tf': 'skip me\n',
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.files.Dockerfile).toContain('FROM scratch');
    expect(ctx!.files['go.mod']).toContain('module app');
    expect(ctx!.files['cmd/server/main.go']).toContain('package main');
    expect(ctx!.files['terraform/compute.tf']).toBeUndefined();
  });

  it('rewrites IMMUTABLE ECR tags for LocalStack rebuilds', () => {
    const out = withMutableEcrTags({
      'compute.tf': 'image_tag_mutability = "IMMUTABLE"\n',
    });
    expect(out['compute.tf']).toContain('MUTABLE');
    expect(out['compute.tf']).not.toContain('IMMUTABLE');
  });

  it('builds a LocalStack ECR URI fallback', () => {
    expect(fallbackLocalstackEcrUri('app')).toBe(
      '000000000000.dkr.ecr.us-east-1.localhost.localstack.cloud:4566/app',
    );
  });
});
