/** AWS Architecture Icons–inspired category colors. */
export const CATEGORY_COLORS: Record<string, string> = {
  networking: '#8C4FFF',
  compute: '#ED7100',
  database: '#C925D1',
  storage: '#7AA116',
  security: '#DD344C',
  integration: '#E7157B',
  management: '#E7157B',
};

/** Fallback text glyphs keyed by display.icon, used if no vector icon exists. */
export const ICON_LABELS: Record<string, string> = {
  vpc: 'VPC',
  subnet: 'SUB',
  ec2: 'EC2',
  rds: 'RDS',
  aurora: 'AUR',
  elasticache: 'EC',
  s3: 'S3',
  alb: 'ALB',
  'target-group': 'TG',
  sg: 'SG',
  lambda: 'λ',
  dynamodb: 'DDB',
  'iam-role': 'IAM',
  ecr: 'ECR',
  ecs: 'ECS',
  secret: 'SEC',
  parameter: 'SSM',
};
