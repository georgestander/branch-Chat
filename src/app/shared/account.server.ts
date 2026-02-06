import type { AppContext } from "@/app/context";
import {
  AccountClientError,
  type AccountQuotaSnapshot,
  type PassReservationResult,
} from "@/lib/durable-objects/Account";

export class DemoQuotaExceededError extends Error {
  constructor() {
    super(
      "Demo pass limit reached (10/10). Add your own API key to continue.",
    );
    this.name = "DemoQuotaExceededError";
  }
}

function getClient(ctx: AppContext) {
  return ctx.getAccount();
}

export async function getAccountQuotaSnapshot(
  ctx: AppContext,
): Promise<AccountQuotaSnapshot> {
  return getClient(ctx).getSnapshot();
}

export async function reserveDemoPass(
  ctx: AppContext,
  input: {
    reservationId: string;
    conversationId?: string;
    branchId?: string;
  },
): Promise<PassReservationResult> {
  try {
    return await getClient(ctx).reservePass({
      reservationId: input.reservationId,
      count: 1,
      conversationId: input.conversationId,
      branchId: input.branchId,
    });
  } catch (error) {
    if (error instanceof AccountClientError && error.status === 409) {
      throw new DemoQuotaExceededError();
    }
    throw error;
  }
}

export async function commitDemoPass(
  ctx: AppContext,
  input: { reservationId: string },
): Promise<AccountQuotaSnapshot> {
  return getClient(ctx).commitPass(input);
}

export async function releaseDemoPass(
  ctx: AppContext,
  input: { reservationId: string },
): Promise<AccountQuotaSnapshot> {
  return getClient(ctx).releasePass(input);
}
