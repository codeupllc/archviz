import { z } from 'zod';

export const resourceSchema = z
  .object({
    id: z.string(),
    type: z.string().describe('Archviz type id, e.g. aws/vpc, aws/ecs-service'),
    name: z.string(),
    properties: z.record(z.string(), z.unknown()).optional().default({}),
    parentId: z.string().nullable().optional(),
    layout: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  })
  .passthrough();

export const relationshipSchema = z
  .object({
    id: z.string(),
    relationship: z.string(),
    sourceId: z.string(),
    targetId: z.string(),
  })
  .passthrough();

export const documentSchema = z
  .object({
    version: z.literal(1),
    meta: z.object({
      name: z.string(),
      provider: z.string().default('aws'),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    }),
    resources: z.array(resourceSchema),
    relationships: z.array(relationshipSchema),
  })
  .passthrough();

export const patchSchema = z.object({
  upsertResources: z.array(resourceSchema).optional(),
  removeResourceIds: z.array(z.string()).optional(),
  upsertRelationships: z.array(relationshipSchema).optional(),
  removeRelationshipIds: z.array(z.string()).optional(),
  meta: z
    .object({
      name: z.string().optional(),
      provider: z.string().optional(),
    })
    .optional(),
});
