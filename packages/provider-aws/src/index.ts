import { ResourceRegistry, type ResourceDefinition } from '@archviz/schema';
import {
  vpc,
  subnet,
  ec2Instance,
  securityGroup,
  rdsInstance,
  auroraCluster,
  auroraClusterInstance,
  elastiCacheCluster,
  s3Bucket,
  alb,
  targetGroup,
  lambdaFunction,
  dynamodbTable,
  iamRole,
  ecrRepository,
  ecsCluster,
  ecsTaskDefinition,
  ecsService,
  secretsManagerSecret,
  ssmParameter,
} from './resources/index.js';

export const awsResources: ResourceDefinition[] = [
  vpc,
  subnet,
  ec2Instance,
  securityGroup,
  rdsInstance,
  auroraCluster,
  auroraClusterInstance,
  elastiCacheCluster,
  s3Bucket,
  alb,
  targetGroup,
  lambdaFunction,
  dynamodbTable,
  iamRole,
  ecrRepository,
  ecsCluster,
  ecsTaskDefinition,
  ecsService,
  secretsManagerSecret,
  ssmParameter,
];

export function createAwsRegistry(): ResourceRegistry {
  const registry = new ResourceRegistry();
  registry.registerAll(awsResources);
  return registry;
}

export {
  vpc,
  subnet,
  ec2Instance,
  securityGroup,
  rdsInstance,
  auroraCluster,
  auroraClusterInstance,
  elastiCacheCluster,
  s3Bucket,
  alb,
  targetGroup,
  lambdaFunction,
  dynamodbTable,
  iamRole,
  ecrRepository,
  ecsCluster,
  ecsTaskDefinition,
  ecsService,
  secretsManagerSecret,
  ssmParameter,
};
export { CATEGORY_COLORS, ICON_LABELS } from './icons.js';
