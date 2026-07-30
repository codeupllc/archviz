import type {
  ArchvizDocument,
  RelationshipInstance,
  ResourceInstance,
} from '@archviz/core';

export interface DiagramPatch {
  upsertResources?: ResourceInstance[];
  removeResourceIds?: string[];
  upsertRelationships?: RelationshipInstance[];
  removeRelationshipIds?: string[];
  meta?: Partial<ArchvizDocument['meta']>;
}

export interface DiagramRecord {
  projectId: string;
  document: ArchvizDocument;
  revision: number;
  /** Optional display / on-disk hints for tool responses. */
  projectPath?: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  revision: number;
  slug?: string;
}

/**
 * Persistence for Archviz documents. OSS defaults to the filesystem;
 * Enterprise supplies an HTTP adapter against its API — same MCP tools.
 */
export interface DiagramStore {
  list(): Promise<ProjectSummary[]>;
  get(projectId: string): Promise<DiagramRecord | null>;
  apply(opts: {
    projectId: string;
    document?: ArchvizDocument;
    patch?: DiagramPatch;
  }): Promise<DiagramRecord>;
}

export interface CoreToolDeps {
  store: DiagramStore;
  /** When set, generate_terraform writes .tf files here (relative paths ok). */
  defaultOutDir?: string;
}
