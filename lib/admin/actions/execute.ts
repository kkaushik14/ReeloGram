import mongoose from "mongoose";
import { createHash } from "node:crypto";
import AdminCommand from "../../../models/AdminCommand.ts";
import { connectToDatabase } from "../../db.ts";
import { withPublicDataMutation } from "../../cache/public-data.ts";
import { AdminRequestError, adminNotFound } from "../config.ts";
import type { VerifiedAdminRequest } from "../signature.ts";
import { actionDigest, type ActionInput } from "./input.ts";

type Receipt = {
  _id: string;
  projectId: string;
  commandId: string;
  digest: string;
  action: string;
  target: string;
  actor: string;
  credentialId: string;
  reason: string;
  authorizedAt: Date;
  expectedRevision: number;
  status: "succeeded" | "rejected";
  code: string;
  changed: boolean;
  before?: boolean;
  after?: boolean;
  revision?: number;
  completedAt: Date;
};
const commandKey = (project: string, id: string) =>
  createHash("sha256").update(`${project}:${id}`).digest("hex");
export function commandResult(r: Receipt) {
  return {
    commandId: r.commandId,
    action: r.action,
    target: r.target,
    status: r.status,
    code: r.code,
    changed: r.changed,
    revision: r.revision ?? null,
    completedAt: r.completedAt.toISOString(),
  };
}
function matching(r: Receipt, digest: string) {
  if (r.digest !== digest)
    throw new AdminRequestError(
      409,
      "Command ID already belongs to a different request.",
    );
  return commandResult(r);
}
export async function readCommand(projectId: string, commandId: string) {
  const c = await connectToDatabase();
  const receipt = await c
    .db!.collection<Receipt>("admincommands")
    .findOne(
      { _id: commandKey(projectId, commandId), projectId },
      { maxTimeMS: 3000 },
    );
  if (!receipt) adminNotFound();
  return commandResult(receipt);
}
export async function executeAction(
  input: ActionInput,
  identity: VerifiedAdminRequest,
) {
  const c = await connectToDatabase();
  await AdminCommand.init();
  const receipts = c.db!.collection<Receipt>("admincommands");
  const _id = commandKey(identity.projectId, input.commandId),
    digest = actionDigest(input);
  const existing = await receipts.findOne({ _id }, { maxTimeMS: 3000 });
  if (existing) return matching(existing, digest);
  const run = async () => {
    const session = await c.startSession();
    try {
      return await session.withTransaction(
        async () => {
          const options = { session, maxTimeMS: 5000 };
          const duplicate = await receipts.findOne({ _id }, options);
          if (duplicate) return matching(duplicate, digest);
          const account = input.action.startsWith("accounts.");
          const records = c.db!.collection<{
            _id: mongoose.Types.ObjectId;
            suspended?: boolean;
            hidden?: boolean;
            deletionPending?: boolean;
            moderationRevision?: number;
          }>(account ? "users" : "videos");
          const target = new mongoose.Types.ObjectId(input.target);
          const record = await records.findOne(
            { _id: target },
            {
              ...options,
              projection: {
                _id: 1,
                suspended: 1,
                hidden: 1,
                deletionPending: 1,
                moderationRevision: 1,
              },
            },
          );
          const field = account ? "suspended" : "hidden";
          const desired =
            input.action === "accounts.suspend" ||
            input.action === "videos.hide";
          const revision = record?.moderationRevision ?? 0;
          const code = !record
            ? "target-not-found"
            : !Number.isSafeInteger(revision) ||
                revision < 0 ||
                revision !== input.expectedRevision
              ? "stale-revision"
              : !account && record.deletionPending
                ? "deletion-in-progress"
                : "applied";
          const changed =
            code === "applied" && (record![field] === true) !== desired;
          if (changed) {
            const result = await records.updateOne(
              { _id: target },
              {
                $set: { [field]: desired, updatedAt: new Date() },
                $inc: {
                  moderationRevision: 1,
                  ...(account ? { sessionVersion: 1 } : {}),
                },
                ...(account
                  ? { $unset: { signInGrant: "", passwordReset: "" } }
                  : {}),
              },
              options,
            );
            if (result.matchedCount !== 1)
              throw Error("Target changed during moderation");
          }
          const receipt: Receipt = {
            _id,
            projectId: identity.projectId,
            commandId: input.commandId,
            digest,
            action: input.action,
            target: input.target,
            actor: input.actor,
            credentialId: identity.keyId,
            reason: input.reason,
            authorizedAt: new Date(input.authorizedAt * 1000),
            expectedRevision: input.expectedRevision,
            status: code === "applied" ? "succeeded" : "rejected",
            code: code === "applied" && !changed ? "already-in-state" : code,
            changed,
            ...(record
              ? {
                  before: record[field] === true,
                  after: changed ? desired : record[field] === true,
                  revision: revision + (changed ? 1 : 0),
                }
              : {}),
            completedAt: new Date(),
          };
          // Audit and state commit together. An audit failure rolls back the change.
          await receipts.insertOne(receipt, options);
          return commandResult(receipt);
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          maxCommitTimeMS: 5000,
          timeoutMS: 20000,
        },
      );
    } catch (error) {
      // Concurrent identical commands may race at the unique key. Never reapply.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        const receipt = await receipts.findOne({ _id }, { maxTimeMS: 3000 });
        if (receipt) return matching(receipt, digest);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  };
  return input.action.startsWith("videos.")
    ? withPublicDataMutation(run)
    : run();
}
