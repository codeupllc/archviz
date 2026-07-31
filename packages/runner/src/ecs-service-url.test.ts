import { describe, expect, it } from 'vitest';
import { parseDockerPorts, parseEcsClusterAndService } from './ecs-service-url.js';

describe('parseEcsClusterAndService', () => {
  it('extracts cluster name, service name, and containerPort from HCL', () => {
    const files = {
      'compute.tf': `
resource "aws_ecs_cluster" "app" {
  name = "watch-cluster"
}

resource "aws_ecs_service" "api" {
  name            = "watch-api"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
}

resource "aws_ecs_task_definition" "app" {
  family = "watch"
  container_definitions = jsonencode([{
    name  = "api"
    image = "nginx"
    portMappings = [{ containerPort = 8080, hostPort = 8080 }]
  }])
}
`,
    };

    expect(parseEcsClusterAndService(files)).toEqual({
      clusterName: 'watch-cluster',
      serviceName: 'watch-api',
      containerPort: 8080,
    });
  });

  it('defaults containerPort to 80 when missing', () => {
    const files = {
      'compute.tf': `
resource "aws_ecs_cluster" "c" {
  name = "c1"
}
`,
    };
    expect(parseEcsClusterAndService(files)).toEqual({
      clusterName: 'c1',
      serviceName: null,
      containerPort: 80,
    });
  });
});

describe('parseDockerPorts', () => {
  it('prefers the mapping that matches containerPort', () => {
    const blob = '0.0.0.0:45139->8080/tcp, 0.0.0.0:45140->90/tcp';
    expect(parseDockerPorts(blob, 8080)).toBe(45139);
  });

  it('falls back to the first published host port', () => {
    const blob = '0.0.0.0:32000->80/tcp';
    expect(parseDockerPorts(blob, 8080)).toBe(32000);
  });

  it('returns null when there are no port mappings', () => {
    expect(parseDockerPorts('', 80)).toBeNull();
    expect(parseDockerPorts('abc', 80)).toBeNull();
  });
});
