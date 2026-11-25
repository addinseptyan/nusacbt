"use server";

import {
  executeDevCascadeDelete,
  inspectDevCascadeDependencies,
  type ExecuteCascadeResult,
  type InspectCascadeResult,
} from "@/lib/dev-cascade-delete-service";

export async function inspectDevCascadeAction(
  entityType: unknown,
  entityId: unknown,
): Promise<InspectCascadeResult> {
  return inspectDevCascadeDependencies(entityType, entityId);
}

export async function executeDevCascadeAction(
  entityType: unknown,
  entityId: unknown,
  confirmPhrase: unknown,
): Promise<ExecuteCascadeResult> {
  return executeDevCascadeDelete(entityType, entityId, confirmPhrase);
}
