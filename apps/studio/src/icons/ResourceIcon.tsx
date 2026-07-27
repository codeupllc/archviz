/**
 * Small flat-style vector glyphs, one per `display.icon` key. Rendered in
 * white on the resource's category color so nodes read as icons rather than
 * text abbreviations. Not official AWS Architecture Icons — simplified
 * shapes that evoke the same conventions (cylinder = database, shield =
 * security, etc.) without redistributing trademarked artwork.
 */
import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Vpc(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="4.5" cy="5.5" r="1.8" />
      <circle cx="19.5" cy="5.5" r="1.8" />
      <circle cx="4.5" cy="18.5" r="1.8" />
      <circle cx="19.5" cy="18.5" r="1.8" />
      <path d="M6 6.8 10.3 10.3M17.7 10.3 18 6.8M6 17.2l4.3-3.5M18 17.2l-4.3-3.5" />
    </svg>
  );
}

function Subnet(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M12 3.5v17M3.5 12h17" />
    </svg>
  );
}

function Ec2(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="5" width="16" height="14" rx="1.6" />
      <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" />
    </svg>
  );
}

function DbCylinder(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </svg>
  );
}

function AuroraCluster(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <ellipse cx="9" cy="6.5" rx="5.5" ry="2.2" />
      <path d="M3.5 6.5v10c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2v-10" />
      <path d="M3.5 11.5c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" />
      <circle cx="18" cy="16" r="3.6" />
      <path d="M18 14.2v1.8l1.3 1.3" />
    </svg>
  );
}

function Cache(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
      <path d="M13 4.3 9.6 12h3l-1 6.5 6-9h-3.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Bucket(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <path d="M5 4h14l-1.6 15.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8Z" />
      <path d="M4 4h16M9 8.5l.6 8M15 8.5l-.6 8" />
    </svg>
  );
}

function LoadBalancer(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <circle cx="5" cy="12" r="2.3" />
      <circle cx="19" cy="5" r="2.3" />
      <circle cx="19" cy="12" r="2.3" />
      <circle cx="19" cy="19" r="2.3" />
      <path d="M7.2 12H12M12 12 16.8 5.9M12 12h4.8M12 12 16.8 18.1" />
    </svg>
  );
}

function TargetGroup(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Shield(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 19 6v6c0 4.4-3 7.7-7 8.5-4-.8-7-4.1-7-8.5V6Z" />
      <path d="M9 12.2l2 2 4-4.4" />
    </svg>
  );
}

function Lambda(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <path d="M8 4.5 10.6 4.5 16.5 19.5M13.6 4.5l-2 5.1M6 19.5 10.9 8" />
    </svg>
  );
}

function DynamoTable(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 20.5 7.5 12 12 3.5 7.5Z" />
      <path d="M3.5 7.5v9L12 21l8.5-4.5v-9" />
      <path d="M12 12v9" />
    </svg>
  );
}

function IamRole(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <circle cx="8.5" cy="8.5" r="3.6" />
      <path d="M13.6 11.6 20.5 18.5M16.6 14.6 18.6 12.6M18.6 16.6 20.6 14.6" />
      <path d="M3.5 20c.6-2.8 2.6-4.4 5-4.4s4.4 1.6 5 4.4" />
    </svg>
  );
}

function Container(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="6" width="17" height="12" rx="1.4" />
      <path d="M3.5 10.5h17M8 6v4M13 6v4M16.5 6v4" />
    </svg>
  );
}

function Registry(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <rect x="4.5" y="3.5" width="12" height="6" rx="1.2" />
      <rect x="7.5" y="9.5" width="12" height="6" rx="1.2" />
      <rect x="4.5" y="15.5" width="12" height="5" rx="1.2" />
    </svg>
  );
}

function Secret(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <circle cx="8.5" cy="9" r="4" />
      <circle cx="8.5" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <path d="M11.8 12.3 19 19.5M15.3 15.8l2-2M17.6 18.1l2-2" />
    </svg>
  );
}

function Parameter(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h4l2-5 4 10 2-5h4" />
    </svg>
  );
}

function Sqs(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="5.5" height="14" rx="1.2" />
      <rect x="9.25" y="5" width="5.5" height="14" rx="1.2" />
      <rect x="15" y="5" width="5.5" height="14" rx="1.2" />
      <path d="M6.25 9h0.01M6.25 12h0.01M6.25 15h0.01M12 9h0.01M12 12h0.01M12 15h0.01M17.75 9h0.01M17.75 12h0.01M17.75 15h0.01" />
    </svg>
  );
}

function Generic(props: IconProps): ReactElement {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

const ICONS: Record<string, (props: IconProps) => ReactElement> = {
  vpc: Vpc,
  subnet: Subnet,
  ec2: Ec2,
  rds: DbCylinder,
  aurora: AuroraCluster,
  elasticache: Cache,
  s3: Bucket,
  alb: LoadBalancer,
  'target-group': TargetGroup,
  sg: Shield,
  lambda: Lambda,
  dynamodb: DynamoTable,
  'iam-role': IamRole,
  ecs: Container,
  ecr: Registry,
  secret: Secret,
  parameter: Parameter,
  sqs: Sqs,
};

export function ResourceIcon({ icon, ...props }: { icon: string } & IconProps): ReactElement {
  const Cmp = ICONS[icon] ?? Generic;
  return <Cmp {...props} />;
}
